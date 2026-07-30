import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type initSqlJs from 'sql.js'
import { buildCliEnv } from './cli-env'
import { assertCliLaunchAllowed } from './cli-launch-safety'
import { defaultWorkspaceForCli } from './launch-cwd'
import { getSql, readSqliteSnapshot } from './sqlite'
import { cliStateRoots, hermesHomeDir } from './config-paths'
import { decodeProcessOutput, spawnProcess } from './process'
import { loadConfig } from './store'
import type {
  CliId,
  SessionDeleteResult,
  SessionInfo,
  Transcript,
  TranscriptMessage,
  TranscriptPart,
  TranscriptRole
} from '@shared/types'

const CODEX_THREAD_LIST_LIMIT = 500
const CODEX_THREAD_LIST_TIMEOUT_MS = 1800
const CODEX_LIST_SCAN_BYTES = 2 * 1024 * 1024
const SESSION_DELETE_TIMEOUT_MS = 15_000

interface FileRef {
  full: string
  id: string
  mtimeMs: number
}

interface CodexAppServerClient {
  proc: ChildProcess
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, any>>
  notify(method: string, params?: Record<string, unknown>): void
  close(): void
}

function hermesDbPath(): string {
  return join(hermesHomeDir(), 'state.db')
}

function opencodeDbPath(): string {
  return join(opencodeBaseDir(), 'opencode.db')
}

function opencodeBaseDir(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'opencode')
}

function opencodeStorageDir(): string {
  return join(opencodeBaseDir(), 'storage')
}

/** Deduplicate sessions by id, keeping the most recently updated copy. */
function mergeById(sessions: SessionInfo[]): SessionInfo[] {
  const byId = new Map<string, SessionInfo>()
  for (const s of sessions) {
    const existing = byId.get(s.id)
    if (!existing || s.updatedAt > existing.updatedAt) byId.set(s.id, s)
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
  )
}

function isPathInside(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

function isSafeSessionPath(file: string, root: string): boolean {
  return normalize(file).endsWith('.jsonl') && isPathInside(file, root)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function runCaptured(
  file: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; cwd?: string } = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawnProcess(file, args, {
      env: options.env,
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      proc.kill()
      finish(null, `Timed out after ${options.timeoutMs ?? SESSION_DELETE_TIMEOUT_MS}ms`)
    }, options.timeoutMs ?? SESSION_DELETE_TIMEOUT_MS)

    const finish = (code: number | null, extraError = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr: [stderr, extraError].filter(Boolean).join('\n') })
    }

    proc.stdout?.on('data', (chunk) => {
      stdout += decodeProcessOutput(chunk)
    })
    proc.stderr?.on('data', (chunk) => {
      stderr += decodeProcessOutput(chunk)
    })
    proc.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    proc.once('exit', (code) => finish(code))
  })
}

function recentJsonl(refs: FileRef[]): FileRef[] {
  return refs.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function readLines(file: string): unknown[] {
  const out: unknown[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* skip partial/corrupt line */
    }
  }
  return out
}

function* readJsonlPrefix(file: string, maxBytes: number): Generator<unknown> {
  const fd = openSync(file, 'r')
  const decoder = new StringDecoder('utf8')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let remaining = maxBytes
  let pending = ''

  try {
    while (remaining > 0) {
      const bytesRead = readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null)
      if (bytesRead === 0) break
      remaining -= bytesRead
      pending += decoder.write(buffer.subarray(0, bytesRead))

      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (!line) continue
        try {
          yield JSON.parse(line)
        } catch {
          /* skip corrupt lines */
        }
      }
    }

    pending += decoder.end()
    if (pending && remaining > 0) {
      try {
        yield JSON.parse(pending)
      } catch {
        /* skip a partial/corrupt final line */
      }
    }
  } finally {
    closeSync(fd)
  }
}

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function displayTitle(text: string | null | undefined, fallback: string): string {
  const cleaned = text ? compactText(text) : ''
  return (cleaned || fallback).slice(0, 80)
}

function displayTitleCandidate(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined
  const cleaned = compactText(text)
  if (!cleaned || ['auto', 'none', 'null', 'undefined'].includes(cleaned.toLowerCase()))
    return undefined
  if (cleaned.startsWith('<environment_context>') || isCodexBackgroundHelperText(cleaned))
    return undefined
  return cleaned
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined
}

function readString(record: Record<string, any> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    const text = content.trim()
    return text || undefined
  }
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    const b = asRecord(block)
    if (!b) continue
    for (const key of ['text', 'value', 'content']) {
      const text = b[key]
      if (typeof text === 'string' && text.trim()) {
        parts.push(text.trim())
        break
      }
    }
  }
  return parts.length ? parts.join('\n\n') : undefined
}

function valueContainsKeyRecursive(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => valueContainsKeyRecursive(item, key))
  const record = asRecord(value)
  if (!record) return false
  return Object.entries(record).some(([k, v]) => k === key || valueContainsKeyRecursive(v, key))
}

function valueContainsStringRecursive(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle)
  if (Array.isArray(value)) return value.some((item) => valueContainsStringRecursive(item, needle))
  const record = asRecord(value)
  if (!record) return false
  return Object.values(record).some((item) => valueContainsStringRecursive(item, needle))
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

function unwrapTaggedText(text: string, tag: string): string | undefined {
  const trimmed = text.trim()
  const open = `<${tag}>`
  if (!trimmed.startsWith(open)) return undefined
  const close = `</${tag}>`
  return (
    trimmed.endsWith(close) ? trimmed.slice(open.length, -close.length) : trimmed.slice(open.length)
  ).trim()
}

function sanitizeClaudeLocalControlText(text: string): string {
  let cleaned = text.trim()
  for (const tag of [
    'command-name',
    'command-message',
    'command-args',
    'local-command-stdout',
    'local-command-stderr',
    'local-command-caveat'
  ]) {
    const unwrapped = unwrapTaggedText(cleaned, tag)
    if (unwrapped != null) {
      cleaned = unwrapped
      break
    }
  }
  return stripAnsi(cleaned).trim()
}

function isCodexCommandToken(token: string): boolean {
  const command =
    token
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .split(/[\\/]/)
      .pop() ?? token
  return ['codex', 'codex.exe', 'codex.cmd', 'codex.bat'].includes(command)
}

function isCodexAppServerText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === 'app-server' || trimmed.includes('developer_instructions=')) return true
  const [command, subcommand] = trimmed.split(/\s+/, 2)
  return !!command && !!subcommand && isCodexCommandToken(command) && subcommand === 'app-server'
}

function contentContainsCodexAppServerControlPlane(content: unknown): boolean {
  if (typeof content === 'string') return isCodexAppServerText(content)
  if (!Array.isArray(content)) return false
  return content.some((block) => {
    const text = asRecord(block)?.text
    return typeof text === 'string' && isCodexAppServerText(text)
  })
}

function isGuiControlPlaneClientInfo(value: unknown): boolean {
  const clientInfo = asRecord(asRecord(value)?.clientInfo)
  if (!clientInfo) return false
  return ['name', 'title'].some((key) => {
    const text = clientInfo[key]
    return typeof text === 'string' && ['ccgui', 'codex-tui'].includes(text.toLowerCase())
  })
}

function hasExperimentalApiCapability(value: unknown): boolean {
  return asRecord(asRecord(value)?.capabilities)?.experimentalApi === true
}

function isClaudeControlPlaneEntry(entry: Record<string, any>): boolean {
  const method = typeof entry.method === 'string' ? entry.method : asRecord(entry.message)?.method
  if (method === 'initialize') return true

  const params = entry.params ?? entry.payload ?? asRecord(entry.message)?.params
  if (isGuiControlPlaneClientInfo(params) && hasExperimentalApiCapability(params)) return true

  if (
    valueContainsKeyRecursive(entry, 'developer_instructions') ||
    valueContainsStringRecursive(entry, 'developer_instructions=')
  ) {
    return true
  }

  return contentContainsCodexAppServerControlPlane(asRecord(entry.message)?.content)
}

const CLAUDE_INTERNAL_ENTRY_TYPES = new Set([
  'permission-mode',
  'file-history-snapshot',
  'last-prompt',
  'queue-operation',
  'attachment',
  'mcp_instructions_delta',
  'skill_listing',
  'stop_hook_summary',
  'turn_duration',
  'local_command'
])

function hasClaudeInternalMarker(value: Record<string, any> | undefined): boolean {
  if (!value) return false
  return ['type', 'subtype', 'event', 'kind'].some((key) => {
    const marker = value[key]
    return typeof marker === 'string' && CLAUDE_INTERNAL_ENTRY_TYPES.has(marker.trim())
  })
}

function isInternalOnlyClaudeEntry(entry: Record<string, any>): boolean {
  if (hasClaudeInternalMarker(entry)) return true
  if (entry.type === 'system' && entry.subtype === 'local_command') return true
  const message = asRecord(entry.message)
  if (!message) return false
  if (message.type === 'system' && message.subtype === 'local_command') return true
  return hasClaudeInternalMarker(message)
}

function hasSyntheticContinuationTypeMarker(value: Record<string, any> | undefined): boolean {
  if (!value) return false
  return ['type', 'subtype', 'event', 'kind'].some((key) => {
    const marker = value[key]
    return (
      typeof marker === 'string' &&
      [
        'summary',
        'synthetic_summary',
        'synthetic-runtime',
        'synthetic_runtime',
        'continuation_summary',
        'compaction_summary',
        'resume_summary'
      ].includes(marker.trim())
    )
  })
}

function isSyntheticContinuationSummary(
  entry: Record<string, any>,
  message: Record<string, any>,
  text: string
): boolean {
  const trimmed = text.trim()
  if (
    !trimmed.startsWith(
      'This session is being continued from a previous conversation that ran out of context.'
    ) ||
    !trimmed.includes('Summary:') ||
    !trimmed.includes('Primary Request and Intent')
  ) {
    return false
  }
  const hasProvenance =
    entry.isMeta === true ||
    message.isMeta === true ||
    entry.isSynthetic === true ||
    message.isSynthetic === true ||
    entry.isVisibleInTranscriptOnly === true ||
    message.isVisibleInTranscriptOnly === true ||
    entry.isCompactSummary === true ||
    message.isCompactSummary === true ||
    entry.model === '<synthetic>' ||
    message.model === '<synthetic>' ||
    hasSyntheticContinuationTypeMarker(entry) ||
    hasSyntheticContinuationTypeMarker(message)
  return message.role === 'user' && hasProvenance
}

function classifyClaudeEntry(entry: Record<string, any>): 'normal' | 'control' | 'hidden' {
  if (isClaudeControlPlaneEntry(entry) || isInternalOnlyClaudeEntry(entry)) return 'hidden'
  const message = asRecord(entry.message)
  const text = extractTextFromContent(message?.content)
  if (!message || !text) return 'normal'
  const trimmed = text.trim()
  const sanitized = sanitizeClaudeLocalControlText(trimmed)
  if (!sanitized) return 'hidden'
  if (
    sanitized === 'No response requested.' &&
    ((message.role === 'assistant' && message.model === '<synthetic>') ||
      entry.model === '<synthetic>')
  ) {
    return 'hidden'
  }
  if (isSyntheticContinuationSummary(entry, message, trimmed)) return 'hidden'
  if (trimmed === '[Request interrupted by user]') return 'control'
  if (
    trimmed.startsWith('<command-name>') ||
    trimmed.startsWith('<command-message>') ||
    trimmed.startsWith('<command-args>') ||
    trimmed.startsWith('<local-command-caveat>') ||
    trimmed.startsWith('<local-command-stdout>') ||
    trimmed.startsWith('<local-command-stderr>')
  ) {
    return 'hidden'
  }
  if (
    sanitized.includes(
      'Caveat: The messages below were generated by the user while running local commands'
    ) ||
    sanitized.includes('Warmup')
  ) {
    return 'hidden'
  }
  return 'normal'
}

function claudeMessageRole(entry: Record<string, any>): TranscriptRole | null {
  const role = asRecord(entry.message)?.role ?? entry.type
  if (role === 'assistant' || role === 'user' || role === 'system') return role
  return null
}

function isClaudeMetaEntry(entry: Record<string, any>): boolean {
  return entry.isMeta === true || asRecord(entry.message)?.isMeta === true
}

function extractClaudeCwd(entry: Record<string, any>): string | undefined {
  const payload = asRecord(entry.payload)
  const message = asRecord(entry.message)
  const payloadSessionMeta = asRecord(payload?.sessionMeta) ?? asRecord(payload?.session_meta)
  const messageSessionMeta = asRecord(message?.sessionMeta) ?? asRecord(message?.session_meta)
  const keys = ['cwd', 'currentWorkingDirectory', 'workspacePath', 'workspace_path']
  return (
    readString(entry, keys) ??
    readString(payload, keys) ??
    readString(payloadSessionMeta, keys) ??
    readString(message, keys) ??
    readString(messageSessionMeta, keys)
  )
}

function extractClaudeUserTitle(entry: Record<string, any>): string | undefined {
  const text = extractTextFromContent(asRecord(entry.message)?.content)
  const cleaned = text ? stripCmd(text) : ''
  return cleaned ? compactText(cleaned) : undefined
}

const CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES = [
  'Generate a concise title for a coding chat thread from the first user message.',
  'You create concise run metadata for a coding task.',
  'You are generating OpenSpec project context.',
  '## Memory Writing Agent: Phase 2',
  'Memory Writing Agent: Phase 2'
]

function isCodexBackgroundHelperText(value: string): boolean {
  const preview = value.trim()
  if (!preview) return false
  if (CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES.some((prefix) => preview.startsWith(prefix)))
    return true
  const lower = preview.toLowerCase()
  const memoryHeader =
    lower.startsWith('## memory writing agent:') || lower.startsWith('memory writing agent:')
  return memoryHeader && (lower.includes('consolidation') || lower.includes('phase 2'))
}

function extractCodexMessageText(payload: Record<string, any>): string | undefined {
  const contentText = extractTextFromContent(payload.content)
  if (contentText) return contentText
  return readString(payload, ['text', 'message'])
}

function extractCodexSessionId(value: Record<string, any>): string | undefined {
  const payload = asRecord(value.payload)
  const context = asRecord(payload?.context)
  const turnContext = asRecord(payload?.turnContext) ?? asRecord(payload?.turn_context)
  const sessionMeta =
    asRecord(value.session_meta) ??
    asRecord(value.sessionMeta) ??
    asRecord(payload?.session_meta) ??
    asRecord(payload?.sessionMeta) ??
    asRecord(context?.session_meta) ??
    asRecord(context?.sessionMeta) ??
    turnContext
  const fromMeta = readString(sessionMeta, ['session_id', 'sessionId', 'id'])
  if (fromMeta) return fromMeta
  if (value.type === 'session_meta' || value.type === 'turn_context') {
    return (
      readString(value, ['session_id', 'sessionId', 'id']) ??
      readString(payload, ['session_id', 'sessionId', 'id'])
    )
  }
  return undefined
}

function extractCodexCwd(value: Record<string, any>): string | undefined {
  const payload = asRecord(value.payload)
  const context = asRecord(payload?.context)
  const turnContext = asRecord(payload?.turnContext) ?? asRecord(payload?.turn_context)
  const sessionMeta =
    asRecord(value.session_meta) ??
    asRecord(value.sessionMeta) ??
    asRecord(payload?.session_meta) ??
    asRecord(payload?.sessionMeta) ??
    asRecord(context?.session_meta) ??
    asRecord(context?.sessionMeta) ??
    context ??
    turnContext
  return (
    readString(value, ['cwd', 'currentWorkingDirectory', 'workspacePath', 'workspace_path']) ??
    readString(payload, ['cwd', 'currentWorkingDirectory', 'workspacePath', 'workspace_path']) ??
    readString(context, ['cwd', 'currentWorkingDirectory', 'workspacePath', 'workspace_path']) ??
    readString(turnContext, [
      'cwd',
      'currentWorkingDirectory',
      'workspacePath',
      'workspace_path'
    ]) ??
    readString(sessionMeta, ['cwd', 'currentWorkingDirectory', 'workspacePath', 'workspace_path'])
  )
}

function codexSessionIdFromPath(file: string): string {
  const name = basename(file).replace(/\.jsonl$/, '')
  return name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] ?? name
}

function findCodexSessionFiles(id: string): string[] {
  const roots = codexSessionRoots()
  const candidates: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.jsonl')) candidates.push(full)
    }
  }
  try {
    for (const root of roots) {
      if (existsSync(root)) walk(root)
    }
  } catch {
    return []
  }
  const refs = recentJsonl(
    candidates.map((full) => {
      try {
        return { full, id: '', mtimeMs: statSync(full).mtimeMs }
      } catch {
        return { full, id: '', mtimeMs: 0 }
      }
    })
  )
  const direct = refs.filter((file) => codexSessionIdFromPath(file.full) === id)
  if (direct.length > 0) return direct.map((file) => file.full)

  const matches: FileRef[] = []
  for (const file of refs) {
    for (const rec of readLines(file.full)) {
      const entry = asRecord(rec)
      if (entry && extractCodexSessionId(entry) === id) {
        matches.push(file)
        break
      }
    }
  }
  return matches.map((file) => file.full)
}

function findCodexSessionFile(id: string): string | null {
  return findCodexSessionFiles(id)[0] ?? null
}

function codexSessionRoots(): string[] {
  return cliStateRoots('codex').flatMap((root) => [
    join(root, 'sessions'),
    join(root, 'archived_sessions')
  ])
}

function codexSessionNames(): Map<string, string> {
  const byId = new Map<string, { name: string; mtimeMs: number }>()
  for (const root of cliStateRoots('codex')) {
    const file = join(root, 'session_index.jsonl')
    let fileMtime: number
    try {
      fileMtime = statSync(file).mtimeMs
    } catch {
      continue
    }
    for (const value of readLines(file)) {
      const entry = asRecord(value)
      const id = displayTitleCandidate(entry?.id)
      const name = displayTitleCandidate(entry?.thread_name ?? entry?.threadName)
      if (!id || !name) continue
      const existing = byId.get(id)
      if (!existing || fileMtime > existing.mtimeMs) {
        byId.set(id, { name, mtimeMs: fileMtime })
      }
    }
  }
  return new Map([...byId.entries()].map(([id, v]) => [id, v.name]))
}

function createCodexAppServerClient(): CodexAppServerClient {
  const install = loadConfig().install.codex
  if (!install.installed || !install.binPath) throw new Error('Codex is not installed')
  assertCliLaunchAllowed('codex', install)

  const proc = spawnProcess(install.binPath, ['app-server', '--stdio'], {
    cwd: defaultWorkspaceForCli('codex'),
    env: buildCliEnv('codex') as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'ignore']
  })
  let nextId = 1
  let buf = ''
  const pending = new Map<
    number,
    { resolve: (value: Record<string, any>) => void; reject: (error: Error) => void }
  >()

  const failAll = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }

  proc.on('error', (error) => failAll(error))
  proc.on('exit', () => failAll(new Error('codex app-server exited')))
  proc.stdout!.setEncoding('utf8')
  proc.stdout!.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let msg: Record<string, any>
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      const id = normalizeRequestId(msg.id)
      if (id == null) continue
      const entry = pending.get(id)
      if (!entry) continue
      pending.delete(id)
      if (msg.error) entry.reject(new Error(String(msg.error?.message ?? msg.error)))
      else entry.resolve(msg)
    }
  })

  const writeJson = (value: Record<string, unknown>) => {
    proc.stdin!.write(`${JSON.stringify(value)}\n`)
  }

  return {
    proc,
    request(method, params = {}) {
      const id = nextId++
      writeJson({ id, method, params })
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    notify(method, params = {}) {
      writeJson({ method, params })
    },
    close() {
      failAll(new Error('codex app-server closed'))
      try {
        proc.kill()
      } catch {
        /* already closed */
      }
    }
  }
}

function normalizeRequestId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

async function listCodexLive(): Promise<SessionInfo[]> {
  const client = createCodexAppServerClient()
  try {
    await withTimeout(
      client.request('initialize', {
        clientInfo: { name: 'agent-launcher', title: 'agent-launcher', version: '0.1.0' },
        capabilities: { experimentalApi: true }
      }),
      CODEX_THREAD_LIST_TIMEOUT_MS,
      'codex initialize'
    )
    client.notify('initialized')
    const response = await withTimeout(
      client.request('thread/list', { cursor: null, limit: CODEX_THREAD_LIST_LIMIT }),
      CODEX_THREAD_LIST_TIMEOUT_MS,
      'codex thread/list'
    )
    const data = asRecord(response.result)?.data
    if (!Array.isArray(data)) return []
    return data
      .map((entry) => codexThreadEntryToSessionInfo(asRecord(entry)))
      .filter((entry): entry is SessionInfo => Boolean(entry))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    client.close()
  }
}

function codexThreadEntryToSessionInfo(entry: Record<string, any> | undefined): SessionInfo | null {
  if (!entry) return null
  const id = displayTitleCandidate(entry.sessionId) ?? displayTitleCandidate(entry.id)
  if (!id) return null
  const title =
    displayTitleCandidate(entry.name) ??
    displayTitleCandidate(entry.title) ??
    displayTitleCandidate(entry.preview)
  if (!title) return null
  const ts = normalizeTs(entry.updatedAt ?? entry.updated_at ?? entry.createdAt ?? entry.created_at)
  return {
    id,
    cliId: 'codex',
    name: displayTitle(title, 'Codex session'),
    updatedAt: ts ?? Date.now(),
    cwd: typeof entry.cwd === 'string' && entry.cwd.trim() ? entry.cwd : undefined
  }
}

function mergeCodexSessions(live: SessionInfo[], local: SessionInfo[]): SessionInfo[] {
  const byId = new Map<string, SessionInfo>()
  for (const entry of live) byId.set(entry.id, entry)
  for (const entry of local) {
    const existing = byId.get(entry.id)
    if (existing) {
      byId.set(entry.id, {
        ...existing,
        updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
        cwd: existing.cwd || entry.cwd
      })
    } else {
      byId.set(entry.id, entry)
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Claude: <cfg>/projects/<encoded-cwd>/<uuid>.jsonl, title from the first real user turn. */
function listClaude(): SessionInfo[] {
  const roots = cliStateRoots('claude-code').map((root) => join(root, 'projects'))
  const refs: FileRef[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const proj of readdirSync(root)) {
      const dir = join(root, proj)
      let files: string[]
      try {
        files = readdirSync(dir)
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.endsWith('.jsonl') || f.startsWith('agent-')) continue
        const full = join(dir, f)
        try {
          refs.push({ full, id: f.replace(/\.jsonl$/, ''), mtimeMs: statSync(full).mtimeMs })
        } catch {
          /* ignore */
        }
      }
    }
  }
  const out: SessionInfo[] = []
  for (const ref of recentJsonl(refs)) {
    let aiTitle: string | null = null
    let customTitle: string | null = null
    let lastPrompt: string | null = null
    let summary: string | null = null
    let cwd: string | undefined
    let firstUser: string | null = null
    let latestTs: number | undefined
    let messageCount = 0
    for (const rec of readLines(ref.full)) {
      const o = asRecord(rec)
      if (!o) continue
      if (o.type === 'ai-title' && o.aiTitle) aiTitle = displayTitleCandidate(o.aiTitle) ?? aiTitle
      else if (o.type === 'last-prompt')
        lastPrompt = displayTitleCandidate(stripCmd(String(o.lastPrompt ?? ''))) ?? lastPrompt
      else if (o.type === 'summary') summary = displayTitleCandidate(o.summary) ?? summary
      if (typeof o.customTitle === 'string' && o.customTitle)
        customTitle = displayTitleCandidate(o.customTitle) ?? customTitle

      const classification = classifyClaudeEntry(o)
      if (classification === 'hidden') continue
      const ts = recordTs(o)
      if (ts) latestTs = latestTs ? Math.max(latestTs, ts) : ts
      if (!cwd) cwd = extractClaudeCwd(o)

      const role = claudeMessageRole(o)
      if (
        (role === 'user' || role === 'assistant') &&
        classification === 'normal' &&
        !isClaudeMetaEntry(o)
      ) {
        messageCount += 1
      }
      if (!firstUser && role === 'user' && classification === 'normal' && !isClaudeMetaEntry(o)) {
        firstUser = extractClaudeUserTitle(o) ?? null
      }
    }
    if (messageCount < 1) continue
    out.push({
      id: ref.id,
      cliId: 'claude-code' as CliId,
      name: displayTitle(
        customTitle || aiTitle || lastPrompt || summary || firstUser,
        'Claude session'
      ),
      updatedAt: latestTs ?? ref.mtimeMs,
      cwd
    })
  }
  return mergeById(out)
}

/** Codex: <cfg>/sessions/YYYY/MM/DD/rollout-*-<uuid>.jsonl, meta in first line. */
function listCodex(): SessionInfo[] {
  const roots = codexSessionRoots()
  const indexedNames = codexSessionNames()
  const refs: FileRef[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        try {
          refs.push({ full, id: '', mtimeMs: statSync(full).mtimeMs })
        } catch {
          /* ignore */
        }
      }
    }
  }
  try {
    for (const root of roots) {
      if (existsSync(root)) walk(root)
    }
  } catch {
    return []
  }
  const out: SessionInfo[] = []
  for (const ref of recentJsonl(refs)) {
    let sessionId = codexSessionIdFromPath(ref.full)
    let name: string | null = null
    let responseItemName: string | null = null
    let cwd: string | undefined
    let sawSessionSignal = false
    for (const rec of readJsonlPrefix(ref.full, CODEX_LIST_SCAN_BYTES)) {
      const o = asRecord(rec)
      if (!o) continue
      const detectedId = extractCodexSessionId(o)
      if (detectedId) sessionId = detectedId
      if (!cwd) cwd = extractCodexCwd(o)

      const indexedName = indexedNames.get(sessionId)
      if (indexedName && cwd) {
        name = indexedName
        sawSessionSignal = true
        break
      }

      const p = asRecord(o.payload) ?? {}
      if (o.type === 'session_meta' || o.type === 'turn_context') sawSessionSignal = true
      if (
        o.type === 'event_msg' &&
        ['user_message', 'userMessage'].includes(String(p.type)) &&
        p.message
      ) {
        sawSessionSignal = true
        const text = String(p.message).trim()
        if (!name && text && !isCodexBackgroundHelperText(text)) name = text
      }
      if (o.type === 'response_item' && p.type === 'message' && p.role === 'user') {
        sawSessionSignal = true
        const text = extractCodexMessageText(p)
        if (
          text &&
          !text.startsWith('<environment_context>') &&
          !isCodexBackgroundHelperText(text)
        ) {
          responseItemName ??= text
        }
      }
      if ((name || responseItemName) && cwd) break
    }
    const title = indexedNames.get(sessionId) || name || responseItemName
    if (!sawSessionSignal && !title) continue
    if (title && isCodexBackgroundHelperText(title)) continue
    out.push({
      id: sessionId,
      cliId: 'codex' as CliId,
      name: displayTitle(title, 'Codex session'),
      updatedAt: ref.mtimeMs,
      cwd
    })
  }
  return mergeById(out)
}

/** Pi: JSONL session files under <cfg>/sessions (organized by working dir). */
function listPi(): SessionInfo[] {
  const roots = cliStateRoots('pi').map((root) => join(root, 'sessions'))
  const refs: FileRef[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.jsonl'))
        try {
          refs.push({ full, id: e.name.replace(/\.jsonl$/, ''), mtimeMs: statSync(full).mtimeMs })
        } catch {
          /* ignore */
        }
    }
  }
  try {
    for (const root of roots) {
      if (existsSync(root)) walk(root)
    }
  } catch {
    return []
  }
  const bySessionId = new Map<string, SessionInfo>()
  for (const ref of recentJsonl(refs)) {
    let isSession = false
    let sessionId = ref.id
    let name: string | null = null
    let cwd: string | undefined
    let firstUser: string | null = null
    for (const rec of readLines(ref.full)) {
      const o = rec as Record<string, any>
      // Session header: {type:"session", id, cwd, name?}
      if (o.type === 'session') {
        isSession = true
        if (typeof o.id === 'string' && o.id.trim()) sessionId = o.id.trim()
        if (typeof o.cwd === 'string') cwd = o.cwd
        if (o.name) name = o.name
      }
      // First user message: {type:"message", message:{role:"user", content:[{type:"text",text}]}}
      if (!firstUser && o.type === 'message' && o.message?.role === 'user') {
        const c = o.message.content
        firstUser =
          typeof c === 'string'
            ? c
            : Array.isArray(c)
              ? (c.find((x) => x.type === 'text')?.text ?? null)
              : null
      }
    }
    if (!isSession) continue
    // Use the full file path as the id — pi resolves `--session <path>` directly.
    const info: SessionInfo = {
      id: ref.full,
      cliId: 'pi',
      name: (name || firstUser || 'Pi session').trim().slice(0, 80),
      updatedAt: ref.mtimeMs,
      cwd
    }
    const existing = bySessionId.get(sessionId)
    if (!existing || info.updatedAt > existing.updatedAt) bySessionId.set(sessionId, info)
  }
  return [...bySessionId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function collectJsonFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) collectJsonFiles(full, out)
      else if (entry.name.endsWith('.json')) out.push(full)
    }
  } catch {
    /* ignore unreadable dirs */
  }
}

function listOpencodeJson(): SessionInfo[] {
  const storage = opencodeStorageDir()
  const sessionRoot = join(storage, 'session')
  const files: string[] = []
  collectJsonFiles(sessionRoot, files)
  const out: SessionInfo[] = []
  for (const file of files) {
    try {
      const value = asRecord(JSON.parse(readFileSync(file, 'utf8')))
      const id = readString(value, ['id'])
      if (!id) continue
      const directory = readString(value, ['directory'])
      const title = displayTitleCandidate(value?.title)
      const time = asRecord(value?.time)
      const updatedAt =
        normalizeTs(time?.updated) ?? normalizeTs(time?.created) ?? statSync(file).mtimeMs
      out.push({
        id,
        cliId: 'opencode',
        name: displayTitle(
          title || (directory ? basename(directory) : undefined),
          'OpenCode session'
        ),
        updatedAt,
        cwd: directory
      })
    } catch {
      /* skip bad legacy session files */
    }
  }
  return out
}

async function listOpencodeSqlite(): Promise<SessionInfo[]> {
  const dbPath = opencodeDbPath()
  if (!existsSync(dbPath)) return []
  const SQL = await getSql()
  const db = new SQL.Database(readSqliteSnapshot(dbPath))
  try {
    const res = db.exec(
      'SELECT id, title, directory, time_updated FROM session ORDER BY time_updated DESC'
    )
    if (!res.length) return []
    return res[0].values.map((row) => {
      const [id, title, directory, updated] = row as [string, string, string, number]
      const ms = Number(updated) || 0
      return {
        id: String(id),
        cliId: 'opencode' as CliId,
        name: (title || 'Untitled session').toString().slice(0, 80),
        updatedAt: ms > 0 && ms < 1e12 ? ms * 1000 : ms, // tolerate seconds vs ms
        cwd: typeof directory === 'string' ? directory : undefined
      }
    })
  } finally {
    db.close()
  }
}

async function listOpencode(): Promise<SessionInfo[]> {
  const sqlite = await listOpencodeSqlite()
  const byId = new Map<string, SessionInfo>()
  for (const entry of sqlite) byId.set(entry.id, entry)
  for (const entry of listOpencodeJson()) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry)
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function listHermesJson(): SessionInfo[] {
  const root = join(hermesHomeDir(), 'sessions')
  if (!existsSync(root)) return []
  const files: string[] = []
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || (!entry.name.endsWith('.jsonl') && !entry.name.endsWith('.json')))
        continue
      files.push(join(root, entry.name))
    }
  } catch {
    return []
  }

  const out: SessionInfo[] = []
  for (const file of files) {
    let id = basename(file).replace(/\.(jsonl|json)$/i, '')
    let title: string | undefined
    let cwd: string | undefined
    let firstUser: string | undefined
    let latestTs: number | undefined
    try {
      for (const rec of readLines(file)) {
        const value = asRecord(rec)
        if (!value) continue
        const ts = normalizeTs(value.timestamp ?? value.ts)
        if (ts) latestTs = latestTs ? Math.max(latestTs, ts) : ts
        const type = readString(value, ['type'])
        if (type === 'session' || type === 'init') {
          id = readString(value, ['id', 'sessionId']) ?? id
          title ??= displayTitleCandidate(value.title)
          cwd ??= readString(value, ['cwd', 'directory'])
        }
        if (!firstUser) {
          const message = asRecord(value.message)
          const role = readString(value, ['role']) ?? readString(message, ['role'])
          if (role === 'user') {
            const text =
              extractTextFromContent(value.content) ?? extractTextFromContent(message?.content)
            if (text?.trim()) firstUser = compactText(text)
          }
        }
      }
      out.push({
        id,
        cliId: 'hermes',
        name: displayTitle(title || firstUser, 'Hermes session'),
        updatedAt: latestTs ?? statSync(file).mtimeMs,
        cwd
      })
    } catch {
      /* skip bad Hermes session files */
    }
  }
  return mergeById(out)
}

async function listHermesSqlite(): Promise<SessionInfo[]> {
  const dbPath = hermesDbPath()
  if (!existsSync(dbPath)) return []
  const SQL = await getSql()
  const db = new SQL.Database(readSqliteSnapshot(dbPath))
  try {
    const columns = tableColumns(db, 'sessions')
    if (!columns.length) return []
    const titleColumn = columns.includes('title')
      ? 'title'
      : columns.includes('name')
        ? 'name'
        : null
    const cwdColumn = columns.includes('cwd')
      ? 'cwd'
      : columns.includes('directory')
        ? 'directory'
        : null
    const updatedColumn = columns.includes('updated_at')
      ? 'updated_at'
      : columns.includes('ended_at')
        ? 'ended_at'
        : columns.includes('started_at')
          ? 'started_at'
          : columns.includes('created_at')
            ? 'created_at'
            : null
    const select = [
      'id',
      titleColumn ? `${quoteSqlIdentifier(titleColumn)} AS title` : "'' AS title",
      cwdColumn ? `${quoteSqlIdentifier(cwdColumn)} AS cwd` : "'' AS cwd",
      updatedColumn ? `${quoteSqlIdentifier(updatedColumn)} AS updated` : '0 AS updated'
    ].join(', ')
    const order = updatedColumn ? ` ORDER BY ${quoteSqlIdentifier(updatedColumn)} DESC` : ''
    const res = db.exec(`SELECT ${select} FROM sessions${order}`)
    if (!res.length) return []
    return res[0].values.map((row) => {
      const [id, title, cwd, updated] = row as [string, string, string, number | string]
      const ts = normalizeTs(updated) ?? Date.now()
      return {
        id: String(id),
        cliId: 'hermes' as CliId,
        name: (String(title || '') || 'Hermes session').slice(0, 80),
        updatedAt: ts,
        cwd: typeof cwd === 'string' && cwd ? cwd : undefined
      }
    })
  } finally {
    db.close()
  }
}

async function listHermes(): Promise<SessionInfo[]> {
  const sqlite = await listHermesSqlite()
  const byId = new Map<string, SessionInfo>()
  for (const entry of sqlite) byId.set(entry.id, entry)
  for (const entry of listHermesJson()) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry)
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Gemini: each project's tmp/<hash>/chats/session-<ts>-<uuid8>.jsonl is
 * gemini-cli's ChatRecordingService log — a session-header line
 * ({sessionId, startTime, lastUpdated, kind}) followed by
 * `{"$set": {"messages": [...], "lastUpdated": ...}}` patch lines.
 *
 * This used to read the separate, lighter tmp/<hash>/logs.json (a plain
 * {sessionId, messageId, timestamp, message} array covering only the user
 * side). That sessionId lives in an unrelated id-space from what gemini-cli's
 * own `--resume` actually looks up — confirmed by reproducing a real
 * "Error resuming session: Invalid session identifier" against a real
 * install, where gemini-cli names this exact chats/ directory as where it
 * searched. Reading the chats/ header directly instead means the id we hand
 * back to resumeArgs is the one `--resume` actually recognizes.
 *
 * Message accumulation across multiple $set lines is handled by de-duping on
 * message id (Map preserves insertion order) rather than assuming
 * replace-whole-array vs. append-only $set semantics — only a
 * single-message (session just started, no reply yet) example was available
 * to verify directly, so this is deliberately tolerant of either shape.
 *
 * The ignored-content/resumability rules below (isGeminiIgnoredUserContent,
 * isGeminiResumableMessage) and the assistant message type ("gemini", not
 * "assistant"/"model") are copied from gemini-cli's own bundled source
 * (isIgnoredUserContent/isResumableMessageRecord/SessionSelector in its
 * packages/core dist) — read directly since gemini-cli is open source,
 * rather than inferred from example data. gemini-cli's own `--list-sessions`
 * / `--resume` hide any session with no resumable message (e.g. one that
 * only ever got the auto-injected context message and no real reply), so
 * listGemini() applies the same filter — otherwise this list would offer a
 * session that gemini-cli's own `--resume` would then refuse. */
function isGeminiIgnoredUserContent(trimmedContent: string): boolean {
  return (
    trimmedContent.length === 0 ||
    trimmedContent.startsWith('/') ||
    trimmedContent.startsWith('?') ||
    trimmedContent.startsWith('<session_context>') ||
    trimmedContent.startsWith('<hook_context>')
  )
}

function isGeminiResumableMessage(message: Record<string, any>): boolean {
  const text = extractTextFromContent(message.content)?.trim() ?? ''
  if (message.type === 'user') return !isGeminiIgnoredUserContent(text)
  if (message.type === 'gemini') {
    return (
      text.length > 0 || (message.toolCalls?.length ?? 0) > 0 || (message.thoughts?.length ?? 0) > 0
    )
  }
  return false
}
function parseGeminiChatFile(
  file: string
):
  | { sessionId: string; startTime: number; updatedAt: number; messages: Record<string, any>[] }
  | undefined {
  const lines = readLines(file)
  const header = asRecord(lines[0])
  if (!header || typeof header.sessionId !== 'string') return undefined
  const sessionId = header.sessionId
  const startTime = normalizeTs(header.startTime) ?? normalizeTs(header.lastUpdated) ?? 0
  let updatedAt = Math.max(startTime, normalizeTs(header.lastUpdated) ?? 0)
  const messagesById = new Map<string, Record<string, any>>()
  for (const raw of lines.slice(1)) {
    const patch = asRecord(asRecord(raw)?.$set)
    if (!patch) continue
    updatedAt = Math.max(updatedAt, normalizeTs(patch.lastUpdated) ?? 0)
    for (const m of Array.isArray(patch.messages) ? patch.messages : []) {
      const message = asRecord(m)
      if (message && typeof message.id === 'string') messagesById.set(message.id, message)
    }
  }
  if (updatedAt <= 0) {
    try {
      updatedAt = statSync(file).mtimeMs
    } catch {
      updatedAt = Date.now()
    }
  }
  return {
    sessionId,
    startTime: startTime || updatedAt,
    updatedAt,
    messages: [...messagesById.values()]
  }
}

function collectGeminiChatFiles(): string[] {
  const out: string[] = []
  for (const stateRoot of cliStateRoots('gemini')) {
    const root = join(stateRoot, 'tmp')
    if (!existsSync(root)) continue
    try {
      for (const projectDir of readdirSync(root, { withFileTypes: true })) {
        if (!projectDir.isDirectory()) continue
        const chatsDir = join(root, projectDir.name, 'chats')
        try {
          for (const entry of readdirSync(chatsDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.jsonl'))
              out.push(join(chatsDir, entry.name))
          }
        } catch {
          /* no chats/ dir for this project — nothing to add */
        }
      }
    } catch {
      /* ignore unreadable tmp root */
    }
  }
  return out
}

/** The plain-text cwd gemini-cli itself wrote for this project — sibling to
 * chats/, one level up from the session file. */
function readGeminiProjectRoot(chatFile: string): string | undefined {
  try {
    const cwd = readFileSync(join(chatFile, '..', '..', '.project_root'), 'utf8').trim()
    return cwd || undefined
  } catch {
    return undefined
  }
}

/** First real user-typed message — skips gemini-cli's own auto-injected
 * wrappers and slash/`?` commands via the same isGeminiIgnoredUserContent
 * rule it uses itself. */
function firstGeminiUserMessage(messages: Record<string, any>[]): string | undefined {
  for (const message of messages) {
    if (message.type !== 'user') continue
    const text = extractTextFromContent(message.content)?.trim()
    if (text && !isGeminiIgnoredUserContent(text)) return text
  }
  return undefined
}

function listGemini(): SessionInfo[] {
  const out: SessionInfo[] = []
  for (const file of collectGeminiChatFiles()) {
    const parsed = parseGeminiChatFile(file)
    if (!parsed || !parsed.messages.some(isGeminiResumableMessage)) continue
    out.push({
      id: parsed.sessionId,
      cliId: 'gemini',
      name: displayTitle(firstGeminiUserMessage(parsed.messages), 'Gemini session'),
      updatedAt: parsed.updatedAt,
      cwd: readGeminiProjectRoot(file)
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

function deleteClaudeSession(id: string): SessionDeleteResult {
  const roots = cliStateRoots('claude-code').map((root) => join(root, 'projects'))
  if (roots.every((root) => !existsSync(root))) {
    return { ok: true, cliId: 'claude-code', id, deletedCount: 0, missing: true }
  }

  const matches: Array<{ file: string; projectDir: string; root: string }> = []
  for (const r of roots) {
    if (!existsSync(r)) continue
    for (const proj of readdirSync(r)) {
      const dir = join(r, proj)
      const candidate = join(dir, `${id}.jsonl`)
      if (existsSync(candidate)) {
        matches.push({ file: candidate, projectDir: dir, root: r })
      }
    }
  }
  if (matches.length === 0) {
    return { ok: true, cliId: 'claude-code', id, deletedCount: 0, missing: true }
  }
  if (matches.some(({ file, root }) => !isSafeSessionPath(file, root))) {
    return { ok: false, cliId: 'claude-code', id, deletedCount: 0, error: 'Invalid session path' }
  }

  try {
    let deletedCount = 0
    for (const { file, projectDir, root } of matches) {
      try {
        unlinkSync(file)
        deletedCount += 1
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
      for (const name of readdirSync(projectDir)) {
        if (!name.startsWith(`agent-${id}`) || !name.endsWith('.jsonl')) continue
        const agentFile = join(projectDir, name)
        if (!isSafeSessionPath(agentFile, root)) continue
        try {
          unlinkSync(agentFile)
          deletedCount += 1
        } catch (error) {
          if (!isMissingFileError(error)) throw error
        }
      }
    }
    return { ok: true, cliId: 'claude-code', id, deletedCount }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { ok: true, cliId: 'claude-code', id, deletedCount: 0, missing: true }
    }
    return { ok: false, cliId: 'claude-code', id, deletedCount: 0, error: String(error) }
  }
}

function deleteCodexSession(id: string): SessionDeleteResult {
  const files = findCodexSessionFiles(id)
  if (files.length === 0) return { ok: true, cliId: 'codex', id, deletedCount: 0, missing: true }
  if (files.some((file) => !codexSessionRoots().some((root) => isSafeSessionPath(file, root)))) {
    return { ok: false, cliId: 'codex', id, deletedCount: 0, error: 'Invalid session path' }
  }

  try {
    let deletedCount = 0
    for (const file of files) {
      try {
        unlinkSync(file)
        deletedCount += 1
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
    }
    return { ok: true, cliId: 'codex', id, deletedCount }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { ok: true, cliId: 'codex', id, deletedCount: 0, missing: true }
    }
    return { ok: false, cliId: 'codex', id, deletedCount: 0, error: String(error) }
  }
}

function deletePiSession(id: string): SessionDeleteResult {
  const roots = cliStateRoots('pi').map((root) => join(root, 'sessions'))
  if (!existsSync(id)) return { ok: true, cliId: 'pi', id, deletedCount: 0, missing: true }
  if (!roots.some((root) => isSafeSessionPath(id, root))) {
    return { ok: false, cliId: 'pi', id, deletedCount: 0, error: 'Invalid session path' }
  }

  try {
    let logicalId: string | null = null
    for (const value of readLines(id)) {
      const entry = asRecord(value)
      if (entry?.type === 'session' && typeof entry.id === 'string' && entry.id.trim()) {
        logicalId = entry.id.trim()
        break
      }
    }

    const files = [id]
    if (logicalId) {
      const candidates: string[] = []
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else if (entry.name.endsWith('.jsonl') && full !== id) candidates.push(full)
        }
      }
      for (const root of roots) {
        if (existsSync(root)) walk(root)
      }
      for (const candidate of candidates) {
        const sameSession = readLines(candidate).some((value) => {
          const entry = asRecord(value)
          return entry?.type === 'session' && entry.id === logicalId
        })
        if (sameSession) files.push(candidate)
      }
    }

    let deletedCount = 0
    for (const file of files) {
      if (!roots.some((root) => isSafeSessionPath(file, root))) continue
      try {
        unlinkSync(file)
        deletedCount += 1
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
    }
    return { ok: true, cliId: 'pi', id, deletedCount }
  } catch (error) {
    if (isMissingFileError(error))
      return { ok: true, cliId: 'pi', id, deletedCount: 0, missing: true }
    return { ok: false, cliId: 'pi', id, deletedCount: 0, error: String(error) }
  }
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function tableColumns(db: initSqlJs.Database, table: string): string[] {
  const stmt = db.prepare(`PRAGMA table_info(${quoteSqlIdentifier(table)})`)
  try {
    const columns: string[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as { name?: unknown }
      if (typeof row.name === 'string') columns.push(row.name)
    }
    return columns
  } finally {
    stmt.free()
  }
}

function compactProcessError(result: {
  code: number | null
  stdout: string
  stderr: string
}): string {
  const text = (result.stderr || result.stdout || `exit code ${result.code ?? 'unknown'}`).trim()
  return text.length > 1200 ? `…${text.slice(-1200)}` : text
}

async function readHermesDeleteTarget(
  dbPath: string,
  id: string
): Promise<{ exists: boolean; deletedCount: number }> {
  const SQL = await getSql()
  const db = new SQL.Database(readSqliteSnapshot(dbPath))
  try {
    const sessionRows = db.exec('SELECT id FROM sessions WHERE id = $sid LIMIT 1', { $sid: id })
    if (!sessionRows.length || sessionRows[0].values.length === 0) {
      return { exists: false, deletedCount: 0 }
    }
    const messageRows = db.exec('SELECT COUNT(*) FROM messages WHERE session_id = $sid', {
      $sid: id
    })
    const messageCount = Number(messageRows[0]?.values[0]?.[0] ?? 0)
    return { exists: true, deletedCount: messageCount + 1 }
  } finally {
    db.close()
  }
}

async function deleteHermesWithCli(id: string): Promise<string | null> {
  const install = loadConfig().install.hermes
  if (!install.installed || !install.binPath || !existsSync(install.binPath)) {
    return 'Hermes command not found; cannot invoke the official sessions delete command'
  }

  const result = await runCaptured(install.binPath, ['sessions', 'delete', '--yes', id], {
    env: buildCliEnv('hermes'),
    timeoutMs: SESSION_DELETE_TIMEOUT_MS
  })
  return result.code === 0 ? null : compactProcessError(result)
}

function sqlite3Command(): string {
  if (process.platform === 'darwin' && existsSync('/usr/bin/sqlite3')) return '/usr/bin/sqlite3'
  return process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3'
}

async function deleteHermesWithSystemSqlite(dbPath: string, id: string): Promise<string | null> {
  const sid = quoteSqlString(id)
  const sql = [
    'PRAGMA busy_timeout = 5000;',
    'BEGIN IMMEDIATE;',
    `UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id = ${sid};`,
    `DELETE FROM messages WHERE session_id = ${sid};`,
    `DELETE FROM sessions WHERE id = ${sid};`,
    'COMMIT;'
  ].join('\n')
  const result = await runCaptured(sqlite3Command(), [dbPath, sql], {
    timeoutMs: SESSION_DELETE_TIMEOUT_MS
  })
  return result.code === 0 ? null : compactProcessError(result)
}

async function deleteOpencodeSession(id: string): Promise<SessionDeleteResult> {
  const dbPath = opencodeDbPath()
  if (!existsSync(dbPath))
    return { ok: true, cliId: 'opencode', id, deletedCount: 0, missing: true }

  const SQL = await getSql()
  const db = new SQL.Database(readFileSync(dbPath))
  try {
    const sessionRows = db.exec('SELECT id FROM session WHERE id = $sid LIMIT 1', { $sid: id })
    if (!sessionRows.length || sessionRows[0].values.length === 0) {
      return { ok: true, cliId: 'opencode', id, deletedCount: 0, missing: true }
    }

    const tableRows = db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    const deleteOrder = (table: string): number => {
      if (table === 'session') return 30
      if (table === 'message') return 20
      if (table === 'part') return 10
      return 0
    }
    const tables = (tableRows[0]?.values.map((row) => String(row[0])) ?? []).sort(
      (a, b) => deleteOrder(a) - deleteOrder(b)
    )
    let deletedCount = 0

    for (const table of tables) {
      const columns = tableColumns(db, table)
      const targetColumn =
        table === 'session' && columns.includes('id')
          ? 'id'
          : columns.includes('session_id')
            ? 'session_id'
            : columns.includes('sessionID')
              ? 'sessionID'
              : null
      if (!targetColumn) continue
      db.run(
        `DELETE FROM ${quoteSqlIdentifier(table)} WHERE ${quoteSqlIdentifier(targetColumn)} = $sid`,
        { $sid: id }
      )
      deletedCount += db.getRowsModified()
    }

    writeFileSync(dbPath, Buffer.from(db.export()))
    return { ok: true, cliId: 'opencode', id, deletedCount }
  } catch (error) {
    return { ok: false, cliId: 'opencode', id, deletedCount: 0, error: String(error) }
  } finally {
    db.close()
  }
}

async function deleteHermesSession(id: string): Promise<SessionDeleteResult> {
  const dbPath = hermesDbPath()
  if (!existsSync(dbPath)) return { ok: true, cliId: 'hermes', id, deletedCount: 0, missing: true }

  try {
    const target = await readHermesDeleteTarget(dbPath, id)
    if (!target.exists) {
      return { ok: true, cliId: 'hermes', id, deletedCount: 0, missing: true }
    }

    try {
      const cliError = await deleteHermesWithCli(id)
      if (!cliError) return { ok: true, cliId: 'hermes', id, deletedCount: target.deletedCount }

      const sqliteError = await deleteHermesWithSystemSqlite(dbPath, id)
      if (!sqliteError) return { ok: true, cliId: 'hermes', id, deletedCount: target.deletedCount }

      return {
        ok: false,
        cliId: 'hermes',
        id,
        deletedCount: 0,
        error: `Official Hermes deletion failed: ${cliError}; system SQLite deletion failed: ${sqliteError}`
      }
    } catch (error) {
      const sqliteError = await deleteHermesWithSystemSqlite(dbPath, id).catch((sqliteFailure) =>
        sqliteFailure instanceof Error ? sqliteFailure.message : String(sqliteFailure)
      )
      if (!sqliteError) return { ok: true, cliId: 'hermes', id, deletedCount: target.deletedCount }
      return {
        ok: false,
        cliId: 'hermes',
        id,
        deletedCount: 0,
        error: `Hermes deletion failed: ${error instanceof Error ? error.message : String(error)}; system SQLite deletion failed: ${sqliteError}`
      }
    }
  } catch (error) {
    return { ok: false, cliId: 'hermes', id, deletedCount: 0, error: String(error) }
  }
}

/** Gemini has no direct "delete this session file" flow of its own — its
 * `--delete-session <index>` takes a 1-based position within the target
 * project's resumable sessions ordered by startTime ascending, exactly the
 * ordering SessionSelector.listSessions()/getSessionFiles() compute
 * internally (see the comment above parseGeminiChatFile) — so the index is
 * computed here rather than by shelling out to `--list-sessions` first. */
async function deleteGeminiSession(id: string): Promise<SessionDeleteResult> {
  const files = collectGeminiChatFiles()
  const targetFile = files.find((file) => parseGeminiChatFile(file)?.sessionId === id)
  if (!targetFile) return { ok: true, cliId: 'gemini', id, deletedCount: 0, missing: true }

  const projectChatsDir = dirname(targetFile)
  const projectSessions = files
    .filter((file) => dirname(file) === projectChatsDir)
    .map((file) => parseGeminiChatFile(file))
    .filter(
      (parsed): parsed is NonNullable<typeof parsed> =>
        !!parsed && parsed.messages.some(isGeminiResumableMessage)
    )
    .sort((a, b) => a.startTime - b.startTime)
  const index = projectSessions.findIndex((s) => s.sessionId === id)
  // Not in the resumable set — listGemini() never would have surfaced it
  // for the user to click delete on in the first place.
  if (index === -1) return { ok: true, cliId: 'gemini', id, deletedCount: 0, missing: true }

  const install = loadConfig().install.gemini
  if (!install.installed || !install.binPath || !existsSync(install.binPath)) {
    return {
      ok: false,
      cliId: 'gemini',
      id,
      deletedCount: 0,
      error: 'Gemini CLI command not found; cannot invoke the official session delete'
    }
  }

  const result = await runCaptured(install.binPath, ['--delete-session', String(index + 1)], {
    env: buildCliEnv('gemini'),
    cwd: readGeminiProjectRoot(targetFile) ?? homedir(),
    timeoutMs: SESSION_DELETE_TIMEOUT_MS
  })
  return result.code === 0
    ? { ok: true, cliId: 'gemini', id, deletedCount: 1 }
    : { ok: false, cliId: 'gemini', id, deletedCount: 0, error: compactProcessError(result) }
}

export async function deleteSession(cliId: CliId, id: string): Promise<SessionDeleteResult> {
  const sessionId = id.trim()
  if (!sessionId) return { ok: false, cliId, id, deletedCount: 0, error: 'Session ID is required' }

  try {
    if (cliId === 'claude-code') return deleteClaudeSession(sessionId)
    if (cliId === 'codex') return deleteCodexSession(sessionId)
    if (cliId === 'pi') return deletePiSession(sessionId)
    if (cliId === 'opencode') return await deleteOpencodeSession(sessionId)
    if (cliId === 'hermes') return await deleteHermesSession(sessionId)
    if (cliId === 'gemini') return await deleteGeminiSession(sessionId)
    return {
      ok: false,
      cliId,
      id: sessionId,
      deletedCount: 0,
      error: 'Session deletion is not supported for this CLI'
    }
  } catch (error) {
    return { ok: false, cliId, id: sessionId, deletedCount: 0, error: String(error) }
  }
}

export async function listSessions(cliId: CliId): Promise<SessionInfo[]> {
  try {
    if (cliId === 'claude-code') return listClaude()
    if (cliId === 'codex') {
      const local = mergeCodexSessions([], listCodex())
      if (local.length > 0) return local
      try {
        return await listCodexLive()
      } catch {
        return local
      }
    }
    if (cliId === 'pi') return listPi()
    if (cliId === 'opencode') return await listOpencode()
    if (cliId === 'hermes') return await listHermes()
    if (cliId === 'gemini') return listGemini()
    return []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Transcript reading: normalize each CLI's stored conversation into a common
// read-only model so the renderer can show it without launching the CLI.
// ---------------------------------------------------------------------------

const MAX_MSG = 800 // cap very long conversations

function normalizeTs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function recordTs(o: Record<string, any>): number | undefined {
  const p = o.payload && typeof o.payload === 'object' ? o.payload : undefined
  const m = o.message && typeof o.message === 'object' ? o.message : undefined
  for (const v of [
    o.timestamp,
    o.created_at,
    o.createdAt,
    o.time,
    o.time_created,
    o.timeCreated,
    o.ts,
    p?.timestamp,
    p?.created_at,
    p?.createdAt,
    p?.time,
    p?.time_created,
    p?.timeCreated,
    p?.ts,
    m?.timestamp,
    m?.created_at,
    m?.createdAt,
    m?.time,
    m?.time_created,
    m?.timeCreated,
    m?.ts
  ]) {
    const ts = normalizeTs(v)
    if (ts) return ts
  }
  return undefined
}

/** Append a part, merging into the previous message when the role matches. */
function pushPart(
  msgs: TranscriptMessage[],
  role: TranscriptRole,
  part: TranscriptPart,
  ts?: number
): void {
  if (part.kind !== 'tool' && !part.text?.trim()) return
  const last = msgs[msgs.length - 1]
  if (last && last.role === role) {
    last.parts.push(part)
    if (!last.ts && ts) last.ts = ts
  } else {
    msgs.push({ role, parts: [part], ts })
  }
}

function stringifyToolPayload(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value.trim() || undefined
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractToolResultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return stringifyToolPayload(content)
  const out: string[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      if (item.trim()) out.push(item.trim())
      continue
    }
    const record = asRecord(item)
    if (!record) continue
    const text = readString(record, ['text', 'content', 'value'])
    if (text) out.push(text)
  }
  return out.length ? out.join('\n\n') : undefined
}

function attachToolResult(
  msgs: TranscriptMessage[],
  id: string | undefined,
  result: string | undefined,
  isError?: boolean,
  status?: TranscriptPart['status']
): boolean {
  if (!id || (!result && !status && isError == null)) return false
  for (let mi = msgs.length - 1; mi >= 0; mi--) {
    const parts = msgs[mi].parts
    for (let pi = parts.length - 1; pi >= 0; pi--) {
      const part = parts[pi]
      if (part.kind === 'tool' && part.id === id) {
        parts[pi] = {
          ...part,
          result: result ?? part.result,
          isError: isError ?? part.isError,
          status: status ?? (isError ? 'error' : 'completed')
        }
        return true
      }
    }
  }
  return false
}

function safeJson(s: unknown): unknown {
  if (typeof s !== 'string') return s
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

function decodeHermesContent(content: unknown): unknown {
  if (typeof content !== 'string') return content
  const marker = 'json:'
  const markerIndex = content.indexOf(marker)
  if (markerIndex < 0 || markerIndex > 6) return content
  try {
    return JSON.parse(content.slice(markerIndex + marker.length))
  } catch {
    return content
  }
}

function decodeSqliteText(content: unknown, hexContent: unknown): unknown {
  if (typeof content === 'string' && content.length > 0) return content
  if (typeof hexContent !== 'string' || !hexContent) return content
  try {
    return Buffer.from(hexContent, 'hex').toString('utf8')
  } catch {
    return content
  }
}

function selectColumn(columns: string[], name: string, fallback = 'NULL'): string {
  return columns.includes(name) ? quoteSqlIdentifier(name) : fallback
}

/** Pick a one-line summary of a tool's input/args for compact display. */
function toolDetail(input: unknown): string | undefined {
  if (input == null) return undefined
  if (typeof input === 'string') return input.slice(0, 140)
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>
    for (const k of [
      'file_path',
      'filePath',
      'filepath',
      'path',
      'command',
      'cmd',
      'pattern',
      'url',
      'query',
      'prompt',
      'description'
    ]) {
      if (typeof o[k] === 'string') return (o[k] as string).slice(0, 140)
    }
    try {
      return JSON.stringify(o).slice(0, 140)
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Strip Claude's slash-command / system-reminder wrappers from user text. */
function stripCmd(s: string): string {
  return s
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-[\s\S]*?>[\s\S]*?<\/local-command-[\s\S]*?>/g, '')
    .trim()
}

function done(
  cliId: CliId,
  id: string,
  messages: TranscriptMessage[],
  truncated = false,
  fallbackTs?: number
): Transcript {
  return {
    cliId,
    id,
    messages: fallbackTs ? messages.map((m) => (m.ts ? m : { ...m, ts: fallbackTs })) : messages,
    truncated
  }
}

/** Claude: locate <id>.jsonl across projects/*, map message.content blocks. */
function claudeTranscript(id: string): Transcript {
  const roots = cliStateRoots('claude-code').map((root) => join(root, 'projects'))
  const matches: FileRef[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const proj of readdirSync(root)) {
      const candidate = join(root, proj, `${id}.jsonl`)
      if (existsSync(candidate)) {
        try {
          matches.push({ full: candidate, id, mtimeMs: statSync(candidate).mtimeMs })
        } catch {
          /* ignore unreadable session files */
        }
      }
    }
  }
  const file = recentJsonl(matches)[0]?.full ?? null
  const msgs: TranscriptMessage[] = []
  if (!file) return done('claude-code', id, msgs)
  const fallbackTs = statSync(file).mtimeMs
  for (const rec of readLines(file)) {
    const o = asRecord(rec)
    if (!o || classifyClaudeEntry(o) === 'hidden' || isClaudeMetaEntry(o)) continue
    const role = claudeMessageRole(o)
    if (role !== 'user' && role !== 'assistant') continue
    const ts = recordTs(o)
    const content = o.message?.content
    if (typeof content === 'string') {
      pushPart(msgs, role, { kind: 'text', text: stripCmd(content) }, ts)
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (!asRecord(b)) continue
        if (b.type === 'text')
          pushPart(
            msgs,
            role,
            { kind: 'text', text: role === 'user' ? stripCmd(b.text) : b.text },
            ts
          )
        else if (b.type === 'thinking' || b.type === 'reasoning')
          pushPart(msgs, role, { kind: 'thinking', text: b.thinking ?? b.text }, ts)
        else if (b.type === 'tool_use')
          pushPart(
            msgs,
            role,
            {
              kind: 'tool',
              tool: b.name,
              detail: toolDetail(b.input),
              input: stringifyToolPayload(b.input),
              id: typeof b.id === 'string' ? b.id : undefined,
              status: 'completed'
            },
            ts
          )
        else if (b.type === 'tool_result') {
          const result = extractToolResultText(b.content)
          const toolId = typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined
          if (!attachToolResult(msgs, toolId, result, b.is_error === true)) {
            pushPart(
              msgs,
              'assistant',
              {
                kind: 'tool',
                tool: 'tool',
                result,
                isError: b.is_error === true,
                status: b.is_error === true ? 'error' : 'completed',
                id: toolId
              },
              ts
            )
          }
        } else if (b.type === 'image') pushPart(msgs, role, { kind: 'text', text: '[image]' }, ts)
      }
    }
    if (msgs.length >= MAX_MSG) return done('claude-code', id, msgs, true, fallbackTs)
  }
  return done('claude-code', id, msgs, false, fallbackTs)
}

/** Codex: find rollout file containing the uuid; map events + response items. */
function codexTranscript(id: string): Transcript {
  const file = findCodexSessionFile(id)
  const msgs: TranscriptMessage[] = []
  if (!file) return done('codex', id, msgs)
  const fallbackTs = statSync(file).mtimeMs
  for (const rec of readLines(file)) {
    const o = asRecord(rec)
    if (!o) continue
    const ts = recordTs(o)
    const p = asRecord(o.payload) ?? {}
    if (o.type === 'event_msg' && p.type === 'user_message' && p.message) {
      const text = String(p.message)
      if (!isCodexBackgroundHelperText(text)) pushPart(msgs, 'user', { kind: 'text', text }, ts)
    } else if (o.type === 'response_item' && p.type === 'message') {
      const role: TranscriptRole | null =
        p.role === 'user'
          ? 'user'
          : p.role === 'assistant'
            ? 'assistant'
            : p.role === 'system'
              ? 'system'
              : null
      const text = extractCodexMessageText(p)
      if (
        role &&
        text &&
        !text.startsWith('<environment_context>') &&
        !isCodexBackgroundHelperText(text)
      ) {
        pushPart(msgs, role, { kind: 'text', text }, ts)
      }
    } else if (o.type === 'response_item' && p.type === 'reasoning') {
      const txt = Array.isArray(p.summary)
        ? p.summary
            .map((s: any) => (typeof s === 'string' ? s : s?.text))
            .filter(Boolean)
            .join('\n')
        : typeof p.summary === 'string'
          ? p.summary
          : Array.isArray(p.content)
            ? p.content
                .map((c: any) => c?.text)
                .filter(Boolean)
                .join('\n')
            : ''
      pushPart(msgs, 'assistant', { kind: 'thinking', text: txt }, ts)
    } else if (
      o.type === 'response_item' &&
      (p.type === 'function_call' || p.type === 'custom_tool_call')
    ) {
      const callId = readString(p, ['call_id', 'callId', 'id'])
      pushPart(
        msgs,
        'assistant',
        {
          kind: 'tool',
          tool: p.name || 'tool',
          detail: toolDetail(safeJson(p.arguments ?? p.input)),
          input: stringifyToolPayload(safeJson(p.arguments ?? p.input)),
          id: callId,
          status: p.status === 'failed' ? 'error' : 'running'
        },
        ts
      )
    } else if (
      o.type === 'response_item' &&
      (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')
    ) {
      const callId = readString(p, ['call_id', 'callId', 'id'])
      const result = extractToolResultText(p.output ?? p.content)
      if (!attachToolResult(msgs, callId, result, p.status === 'failed')) {
        pushPart(
          msgs,
          'assistant',
          {
            kind: 'tool',
            tool: 'tool',
            result,
            isError: p.status === 'failed',
            status: p.status === 'failed' ? 'error' : 'completed',
            id: callId
          },
          ts
        )
      }
    } else if (o.type === 'response_item' && p.type === 'web_search_call') {
      const action = asRecord(p.action)
      pushPart(
        msgs,
        'assistant',
        {
          kind: 'tool',
          tool: 'web_search',
          detail: toolDetail(action ?? p),
          input: stringifyToolPayload(action ?? p),
          id: readString(p, ['call_id', 'callId', 'id']),
          status: p.status === 'failed' ? 'error' : 'completed',
          isError: p.status === 'failed'
        },
        ts
      )
    }
    if (msgs.length >= MAX_MSG) return done('codex', id, msgs, true, fallbackTs)
  }
  return done('codex', id, msgs, false, fallbackTs)
}

/** Pi: id is the file path; map message records (text + tool, defensive). */
function piTranscript(file: string): Transcript {
  const msgs: TranscriptMessage[] = []
  if (!existsSync(file)) return done('pi', file, msgs)
  const fallbackTs = statSync(file).mtimeMs
  for (const rec of readLines(file)) {
    const o = rec as Record<string, any>
    if (o.type !== 'message' || !o.message) continue
    const ts = recordTs(o)
    const r = o.message.role
    const role: TranscriptRole = r === 'assistant' ? 'assistant' : r === 'user' ? 'user' : 'system'
    const c = o.message.content
    if (typeof c === 'string') {
      pushPart(msgs, role, { kind: 'text', text: c }, ts)
    } else if (Array.isArray(c)) {
      for (const b of c) {
        if (b.type === 'text') pushPart(msgs, role, { kind: 'text', text: b.text }, ts)
        else if (b.type === 'thinking' || b.type === 'reasoning')
          pushPart(msgs, role, { kind: 'thinking', text: b.text ?? b.thinking }, ts)
        else if (b.type === 'tool_use' || b.type === 'tool_call')
          pushPart(
            msgs,
            role,
            {
              kind: 'tool',
              tool: b.name ?? b.tool ?? 'tool',
              detail: toolDetail(b.input ?? b.arguments),
              input: stringifyToolPayload(b.input ?? b.arguments),
              id:
                typeof b.id === 'string'
                  ? b.id
                  : typeof b.tool_use_id === 'string'
                    ? b.tool_use_id
                    : undefined,
              status: 'completed'
            },
            ts
          )
        else if (b.type === 'tool_result') {
          const toolId =
            typeof b.tool_use_id === 'string'
              ? b.tool_use_id
              : typeof b.id === 'string'
                ? b.id
                : undefined
          const result = extractToolResultText(b.content ?? b.output ?? b.result)
          if (!attachToolResult(msgs, toolId, result, b.is_error === true)) {
            pushPart(
              msgs,
              role,
              {
                kind: 'tool',
                tool: b.name ?? b.tool ?? 'tool',
                result,
                isError: b.is_error === true,
                status: b.is_error === true ? 'error' : 'completed',
                id: toolId
              },
              ts
            )
          }
        }
      }
    }
    if (msgs.length >= MAX_MSG) return done('pi', file, msgs, true, fallbackTs)
  }
  return done('pi', file, msgs, false, fallbackTs)
}

/** opencode: join message + part (data JSON) by session_id, ordered by time. */
async function opencodeTranscript(id: string): Promise<Transcript> {
  const dbPath = opencodeDbPath()
  const msgs: TranscriptMessage[] = []
  if (!existsSync(dbPath)) return done('opencode', id, msgs)
  const SQL = await getSql()
  const db = new SQL.Database(readSqliteSnapshot(dbPath))
  let fallbackTs: number | undefined
  try {
    const sstmt = db.prepare('SELECT time_updated FROM session WHERE id = $sid LIMIT 1')
    sstmt.bind({ $sid: id })
    if (sstmt.step()) {
      const row = sstmt.getAsObject() as { time_updated?: number | string }
      fallbackTs = normalizeTs(row.time_updated)
    }
    sstmt.free()

    const roleById = new Map<string, TranscriptRole>()
    const tsById = new Map<string, number>()
    const order: string[] = []
    const mstmt = db.prepare(
      'SELECT id, data, time_created FROM message WHERE session_id = $sid ORDER BY time_created'
    )
    mstmt.bind({ $sid: id })
    while (mstmt.step()) {
      const row = mstmt.getAsObject() as {
        id: string
        data: string
        time_created?: number | string
      }
      let role: TranscriptRole = 'assistant'
      try {
        const d = JSON.parse(row.data)
        role = d.role === 'user' ? 'user' : d.role === 'assistant' ? 'assistant' : 'system'
      } catch {
        /* keep default */
      }
      const mid = String(row.id)
      roleById.set(mid, role)
      const ts = normalizeTs(row.time_created)
      if (ts) tsById.set(mid, ts)
      order.push(mid)
    }
    mstmt.free()

    const partsByMsg = new Map<string, TranscriptPart[]>()
    const pstmt = db.prepare(
      'SELECT message_id, data FROM part WHERE session_id = $sid ORDER BY time_created'
    )
    pstmt.bind({ $sid: id })
    while (pstmt.step()) {
      const row = pstmt.getAsObject() as { message_id: string; data: string }
      let part: TranscriptPart | null = null
      try {
        const d = JSON.parse(row.data)
        if (d.type === 'text' && d.text) part = { kind: 'text', text: d.text }
        else if (d.type === 'reasoning' && d.text) part = { kind: 'thinking', text: d.text }
        else if (d.type === 'tool')
          part = {
            kind: 'tool',
            tool: d.tool || 'tool',
            detail:
              toolDetail(d.state?.input) ??
              (typeof d.state?.title === 'string' ? d.state.title : undefined),
            input: stringifyToolPayload(d.state?.input),
            result: extractToolResultText(d.state?.output ?? d.state?.result),
            isError: d.state?.status === 'error' || d.state?.status === 'failed',
            status:
              d.state?.status === 'completed'
                ? 'completed'
                : d.state?.status === 'error' || d.state?.status === 'failed'
                  ? 'error'
                  : 'running',
            id:
              typeof d.callID === 'string'
                ? d.callID
                : typeof d.callId === 'string'
                  ? d.callId
                  : undefined
          }
      } catch {
        /* skip bad part */
      }
      if (!part) continue
      const arr = partsByMsg.get(String(row.message_id)) ?? []
      arr.push(part)
      partsByMsg.set(String(row.message_id), arr)
    }
    pstmt.free()

    for (const mid of order) {
      const role = roleById.get(mid) ?? 'assistant'
      for (const part of partsByMsg.get(mid) ?? []) pushPart(msgs, role, part, tsById.get(mid))
      if (msgs.length >= MAX_MSG) return done('opencode', id, msgs, true, fallbackTs)
    }
  } finally {
    db.close()
  }
  return done('opencode', id, msgs, false, fallbackTs)
}

async function hermesTranscript(id: string): Promise<Transcript> {
  const dbPath = hermesDbPath()
  const msgs: TranscriptMessage[] = []
  if (!existsSync(dbPath)) return done('hermes', id, msgs)
  const SQL = await getSql()
  const db = new SQL.Database(readSqliteSnapshot(dbPath))
  let fallbackTs: number | undefined
  try {
    const sstmt = db.prepare('SELECT started_at, ended_at FROM sessions WHERE id = $sid LIMIT 1')
    sstmt.bind({ $sid: id })
    if (sstmt.step()) {
      const row = sstmt.getAsObject() as {
        started_at?: number | string
        ended_at?: number | string
      }
      fallbackTs = normalizeTs(row.ended_at) ?? normalizeTs(row.started_at)
    }
    sstmt.free()

    const messageColumns = tableColumns(db, 'messages')
    if (!messageColumns.length || !messageColumns.includes('session_id'))
      return done('hermes', id, msgs, false, fallbackTs)
    const activeFilter = messageColumns.includes('active') ? ' AND active = 1' : ''
    const orderColumn = messageColumns.includes('id')
      ? 'id'
      : messageColumns.includes('timestamp')
        ? 'timestamp'
        : 'rowid'
    const contentExpr = messageColumns.includes('content')
      ? 'content, hex(content) AS content_hex'
      : 'NULL AS content, NULL AS content_hex'
    const mstmt = db.prepare(
      [
        'SELECT',
        [
          selectColumn(messageColumns, 'role', "'assistant'"),
          contentExpr,
          `${selectColumn(messageColumns, 'tool_call_id')} AS tool_call_id`,
          `${selectColumn(messageColumns, 'tool_calls')} AS tool_calls`,
          `${selectColumn(messageColumns, 'tool_name')} AS tool_name`,
          `${selectColumn(messageColumns, 'timestamp')} AS timestamp`,
          `${selectColumn(messageColumns, 'reasoning')} AS reasoning`,
          `${selectColumn(messageColumns, 'reasoning_content')} AS reasoning_content`,
          `${selectColumn(messageColumns, 'reasoning_details')} AS reasoning_details`
        ].join(', '),
        `FROM messages WHERE session_id = $sid${activeFilter} ORDER BY ${quoteSqlIdentifier(orderColumn)}`
      ].join(' ')
    )
    mstmt.bind({ $sid: id })
    while (mstmt.step()) {
      const row = mstmt.getAsObject() as Record<string, any>
      const role: TranscriptRole =
        row.role === 'assistant' ? 'assistant' : row.role === 'user' ? 'user' : 'system'
      const ts = normalizeTs(row.timestamp)
      const content = decodeHermesContent(decodeSqliteText(row.content, row.content_hex))
      if (typeof content === 'string') {
        pushPart(msgs, role, { kind: 'text', text: content }, ts)
      } else if (Array.isArray(content)) {
        for (const item of content) {
          const record = asRecord(item)
          if (!record) continue
          if (record.type === 'text' && typeof record.text === 'string') {
            pushPart(msgs, role, { kind: 'text', text: record.text }, ts)
          } else if (record.type === 'image_url') {
            pushPart(msgs, role, { kind: 'text', text: '[image]' }, ts)
          } else {
            pushPart(msgs, role, { kind: 'text', text: stringifyToolPayload(record) }, ts)
          }
        }
      } else if (content != null) {
        pushPart(msgs, role, { kind: 'text', text: stringifyToolPayload(content) }, ts)
      }

      const reasoning = extractToolResultText(
        row.reasoning_content ?? row.reasoning ?? safeJson(row.reasoning_details)
      )
      if (reasoning && role === 'assistant')
        pushPart(msgs, role, { kind: 'thinking', text: reasoning }, ts)

      const toolCalls = safeJson(row.tool_calls)
      if (Array.isArray(toolCalls)) {
        for (const call of toolCalls) {
          const record = asRecord(call)
          if (!record) continue
          const fn = asRecord(record.function)
          const name =
            readString(record, ['name']) ?? readString(fn, ['name']) ?? row.tool_name ?? 'tool'
          const input = safeJson(fn?.arguments ?? record.arguments ?? record.input)
          pushPart(
            msgs,
            'assistant',
            {
              kind: 'tool',
              tool: name,
              detail: toolDetail(input),
              input: stringifyToolPayload(input),
              id:
                readString(record, ['id', 'call_id', 'callId']) ??
                (typeof row.tool_call_id === 'string' ? row.tool_call_id : undefined),
              status: 'completed'
            },
            ts
          )
        }
      } else if (row.tool_name || row.tool_call_id) {
        pushPart(
          msgs,
          role,
          {
            kind: 'tool',
            tool: row.tool_name || 'tool',
            result: typeof content === 'string' ? content : stringifyToolPayload(content),
            id: typeof row.tool_call_id === 'string' ? row.tool_call_id : undefined,
            status: 'completed'
          },
          ts
        )
      }
      if (msgs.length >= MAX_MSG) return done('hermes', id, msgs, true, fallbackTs)
    }
    mstmt.free()
  } finally {
    db.close()
  }
  return done('hermes', id, msgs, false, fallbackTs)
}

/** Gemini: reads the same chats/*.jsonl this CLI's session id now comes from
 * (see listGemini/parseGeminiChatFile) instead of the old one-sided
 * logs.json, so this is two-sided where the previous version only ever had
 * the user's half. Role mapping (`type: "gemini"` → assistant) and the
 * info/error/warning skip come from gemini-cli's own
 * convertSessionToClientHistory, read directly from its bundled source. */
function geminiTranscript(id: string): Transcript {
  for (const file of collectGeminiChatFiles()) {
    const parsed = parseGeminiChatFile(file)
    if (!parsed || parsed.sessionId !== id) continue
    const msgs: TranscriptMessage[] = []
    for (const message of parsed.messages) {
      if (message.type === 'info' || message.type === 'error' || message.type === 'warning')
        continue
      const text = extractTextFromContent(message.content)?.trim()
      if (!text) continue
      if (message.type === 'user' && isGeminiIgnoredUserContent(text)) continue
      const role: TranscriptRole = message.type === 'gemini' ? 'assistant' : 'user'
      pushPart(msgs, role, { kind: 'text', text }, normalizeTs(message.timestamp))
    }
    return done('gemini', id, msgs, false, parsed.updatedAt)
  }
  return done('gemini', id, [])
}

/** Read a session's conversation as a normalized, read-only transcript. */
export async function readTranscript(cliId: CliId, id: string): Promise<Transcript> {
  try {
    if (cliId === 'claude-code') return claudeTranscript(id)
    if (cliId === 'codex') return codexTranscript(id)
    if (cliId === 'pi') return piTranscript(id)
    if (cliId === 'opencode') return await opencodeTranscript(id)
    if (cliId === 'hermes') return await hermesTranscript(id)
    if (cliId === 'gemini') return geminiTranscript(id)
  } catch {
    /* fall through to empty transcript */
  }
  return done(cliId, id, [])
}

/** Args to resume a given session, or null if the CLI can't resume by id. */
export function resumeArgs(cliId: CliId, id: string): string[] | null {
  if (cliId === 'claude-code') return ['--resume', id]
  if (cliId === 'codex') return ['resume', id]
  if (cliId === 'opencode') return ['--session', id]
  if (cliId === 'pi') return ['--session', id]
  if (cliId === 'hermes') return ['--resume', id]
  // Cross-project resume-by-id only landed in newer gemini-cli releases;
  // older pinned installs resolve `--resume <uuid>` within the launch cwd's
  // project only, so resuming a session listed from a different project can
  // fail there even though the id is otherwise valid.
  if (cliId === 'gemini') return ['--resume', id]
  return null
}
