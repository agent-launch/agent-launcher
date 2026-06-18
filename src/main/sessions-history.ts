import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { buildCliEnv } from './cli-env'
import { spawnProcess } from './process'
import { paths } from './sandbox'
import { getInstallSource, loadConfig } from './store'
import type {
  CliId,
  SessionDeleteResult,
  SessionInfo,
  Transcript,
  TranscriptMessage,
  TranscriptPart,
  TranscriptRole
} from '@shared/types'

const MAX_LIST = 50 // only parse the most-recently-touched files
const CODEX_THREAD_LIST_TIMEOUT_MS = 1800

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

function cliStateRoot(cliId: CliId): string {
  if (getInstallSource(cliId) !== 'system') return paths.cliConfig(cliId)
  if (cliId === 'claude-code') return join(homedir(), '.claude')
  if (cliId === 'codex') return join(homedir(), '.codex')
  if (cliId === 'pi') return join(homedir(), '.pi', 'agent')
  return paths.cliConfig(cliId)
}

function opencodeDbPath(): string {
  if (getInstallSource('opencode') !== 'system') {
    return join(paths.cliConfig('opencode'), 'xdg-data', 'opencode', 'opencode.db')
  }
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'opencode', 'opencode.db')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
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

function recentJsonl(refs: FileRef[]): FileRef[] {
  return refs.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_LIST)
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
  if (!cleaned || ['auto', 'none', 'null', 'undefined'].includes(cleaned.toLowerCase())) return undefined
  if (cleaned.startsWith('<environment_context>') || isCodexBackgroundHelperText(cleaned)) return undefined
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
  return (trimmed.endsWith(close) ? trimmed.slice(open.length, -close.length) : trimmed.slice(open.length)).trim()
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
  const command = token.trim().replace(/^['"]|['"]$/g, '').split(/[\\/]/).pop() ?? token
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

function isSyntheticContinuationSummary(entry: Record<string, any>, message: Record<string, any>, text: string): boolean {
  const trimmed = text.trim()
  if (
    !trimmed.startsWith('This session is being continued from a previous conversation that ran out of context.') ||
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
    ((message.role === 'assistant' && message.model === '<synthetic>') || entry.model === '<synthetic>')
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
    sanitized.includes('Caveat: The messages below were generated by the user while running local commands') ||
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
  if (CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES.some((prefix) => preview.startsWith(prefix))) return true
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
    return readString(value, ['session_id', 'sessionId', 'id']) ?? readString(payload, ['session_id', 'sessionId', 'id'])
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
    readString(turnContext, ['cwd', 'currentWorkingDirectory', 'workspacePath', 'workspace_path']) ??
    readString(sessionMeta, ['cwd', 'currentWorkingDirectory', 'workspacePath', 'workspace_path'])
  )
}

function codexSessionIdFromPath(file: string): string {
  const name = basename(file).replace(/\.jsonl$/, '')
  return name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] ?? name
}

function findCodexSessionFile(id: string): string | null {
  const root = join(cliStateRoot('codex'), 'sessions')
  if (!existsSync(root)) return null
  const candidates: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.jsonl')) candidates.push(full)
    }
  }
  try {
    walk(root)
  } catch {
    return null
  }
  const direct = candidates.find((file) => basename(file).includes(id))
  if (direct) return direct
  for (const file of recentJsonl(
    candidates.map((full) => {
      try {
        return { full, id: '', mtimeMs: statSync(full).mtimeMs }
      } catch {
        return { full, id: '', mtimeMs: 0 }
      }
    })
  )) {
    for (const rec of readLines(file.full)) {
      const o = asRecord(rec)
      if (o && extractCodexSessionId(o) === id) return file.full
    }
  }
  return null
}

function createCodexAppServerClient(): CodexAppServerClient {
  const install = loadConfig().install.codex
  if (!install.installed || !install.binPath) throw new Error('Codex 尚未安装')

  const proc = spawnProcess(install.binPath, ['app-server', '--stdio'], {
    cwd: homedir(),
    env: buildCliEnv('codex') as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'ignore']
  })
  let nextId = 1
  let buf = ''
  const pending = new Map<number, { resolve: (value: Record<string, any>) => void; reject: (error: Error) => void }>()

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
      client.request('thread/list', { cursor: null, limit: MAX_LIST }),
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
    name: displayTitle(title, 'Codex 会话'),
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
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LIST)
}

/** Claude: <cfg>/projects/<encoded-cwd>/<uuid>.jsonl, title from the first real user turn. */
function listClaude(): SessionInfo[] {
  const root = join(cliStateRoot('claude-code'), 'projects')
  if (!existsSync(root)) return []
  const refs: FileRef[] = []
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
      else if (o.type === 'last-prompt') lastPrompt = displayTitleCandidate(stripCmd(String(o.lastPrompt ?? ''))) ?? lastPrompt
      else if (o.type === 'summary') summary = displayTitleCandidate(o.summary) ?? summary
      if (typeof o.customTitle === 'string' && o.customTitle) customTitle = displayTitleCandidate(o.customTitle) ?? customTitle

      const classification = classifyClaudeEntry(o)
      if (classification === 'hidden') continue
      const ts = recordTs(o)
      if (ts) latestTs = latestTs ? Math.max(latestTs, ts) : ts
      if (!cwd) cwd = extractClaudeCwd(o)

      const role = claudeMessageRole(o)
      if ((role === 'user' || role === 'assistant') && classification === 'normal' && !isClaudeMetaEntry(o)) {
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
      name: displayTitle(customTitle || aiTitle || lastPrompt || summary || firstUser, 'Claude 会话'),
      updatedAt: latestTs ?? ref.mtimeMs,
      cwd
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Codex: <cfg>/sessions/YYYY/MM/DD/rollout-*-<uuid>.jsonl, meta in first line. */
function listCodex(): SessionInfo[] {
  const root = join(cliStateRoot('codex'), 'sessions')
  if (!existsSync(root)) return []
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
    walk(root)
  } catch {
    return []
  }
  const out: SessionInfo[] = []
  for (const ref of recentJsonl(refs)) {
    const lines = readLines(ref.full)
    let sessionId = codexSessionIdFromPath(ref.full)
    let name: string | null = null
    let responseItemName: string | null = null
    let cwd: string | undefined
    let latestTs: number | undefined
    let sawSessionSignal = false
    for (const rec of lines) {
      const o = asRecord(rec)
      if (!o) continue
      const ts = recordTs(o)
      if (ts) latestTs = latestTs ? Math.max(latestTs, ts) : ts
      const detectedId = extractCodexSessionId(o)
      if (detectedId) sessionId = detectedId
      if (!cwd) cwd = extractCodexCwd(o)

      const p = asRecord(o.payload) ?? {}
      if (o.type === 'session_meta' || o.type === 'turn_context') sawSessionSignal = true
      if (o.type === 'event_msg' && ['user_message', 'userMessage'].includes(String(p.type)) && p.message) {
        sawSessionSignal = true
        const text = String(p.message).trim()
        if (!name && text && !isCodexBackgroundHelperText(text)) name = text
      }
      if (o.type === 'response_item' && p.type === 'message' && p.role === 'user') {
        sawSessionSignal = true
        const text = extractCodexMessageText(p)
        if (text && !text.startsWith('<environment_context>') && !isCodexBackgroundHelperText(text)) {
          responseItemName ??= text
        }
      }
    }
    const title = name || responseItemName
    if (!sawSessionSignal && !title) continue
    if (title && isCodexBackgroundHelperText(title)) continue
    out.push({
      id: sessionId,
      cliId: 'codex' as CliId,
      name: displayTitle(title, 'Codex 会话'),
      updatedAt: latestTs ?? ref.mtimeMs,
      cwd
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Pi: JSONL session files under <cfg>/sessions (organized by working dir). */
function listPi(): SessionInfo[] {
  const root = join(cliStateRoot('pi'), 'sessions')
  if (!existsSync(root)) return []
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
    walk(root)
  } catch {
    return []
  }
  const out: SessionInfo[] = []
  for (const ref of recentJsonl(refs)) {
    let isSession = false
    let name: string | null = null
    let cwd: string | undefined
    let firstUser: string | null = null
    for (const rec of readLines(ref.full)) {
      const o = rec as Record<string, any>
      // Session header: {type:"session", id, cwd, name?}
      if (o.type === 'session') {
        isSession = true
        if (typeof o.cwd === 'string') cwd = o.cwd
        if (o.name) name = o.name
      }
      // First user message: {type:"message", message:{role:"user", content:[{type:"text",text}]}}
      if (!firstUser && o.type === 'message' && o.message?.role === 'user') {
        const c = o.message.content
        firstUser =
          typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x) => x.type === 'text')?.text ?? null) : null
      }
    }
    if (!isSession) continue
    // Use the full file path as the id — pi resolves `--session <path>` directly.
    out.push({
      id: ref.full,
      cliId: 'pi',
      name: (name || firstUser || 'Pi 会话').trim().slice(0, 80),
      updatedAt: ref.mtimeMs,
      cwd
    })
  }
  return out
}

/** opencode stores sessions in a SQLite DB — read the `session` table directly. */
let sqlPromise: Promise<SqlJsStatic> | null = null
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
  }
  return sqlPromise
}

async function listOpencode(): Promise<SessionInfo[]> {
  const dbPath = opencodeDbPath()
  if (!existsSync(dbPath)) return []
  const SQL = await getSql()
  const db = new SQL.Database(readFileSync(dbPath))
  try {
    const res = db.exec(
      'SELECT id, title, directory, time_updated FROM session ORDER BY time_updated DESC LIMIT 50'
    )
    if (!res.length) return []
    return res[0].values.map((row) => {
      const [id, title, directory, updated] = row as [string, string, string, number]
      const ms = Number(updated) || 0
      return {
        id: String(id),
        cliId: 'opencode' as CliId,
        name: (title || '未命名会话').toString().slice(0, 80),
        updatedAt: ms > 0 && ms < 1e12 ? ms * 1000 : ms, // tolerate seconds vs ms
        cwd: typeof directory === 'string' ? directory : undefined
      }
    })
  } finally {
    db.close()
  }
}

function deleteClaudeSession(id: string): SessionDeleteResult {
  const root = join(cliStateRoot('claude-code'), 'projects')
  if (!existsSync(root)) return { ok: true, cliId: 'claude-code', id, deletedCount: 0, missing: true }

  let file: string | null = null
  let projectDir: string | null = null
  for (const proj of readdirSync(root)) {
    const dir = join(root, proj)
    const candidate = join(dir, `${id}.jsonl`)
    if (existsSync(candidate)) {
      file = candidate
      projectDir = dir
      break
    }
  }
  if (!file) return { ok: true, cliId: 'claude-code', id, deletedCount: 0, missing: true }
  if (!isSafeSessionPath(file, root)) {
    return { ok: false, cliId: 'claude-code', id, deletedCount: 0, error: '非法会话路径' }
  }

  try {
    let deletedCount = 0
    unlinkSync(file)
    deletedCount += 1
    if (projectDir) {
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
  const root = join(cliStateRoot('codex'), 'sessions')
  const file = findCodexSessionFile(id)
  if (!file) return { ok: true, cliId: 'codex', id, deletedCount: 0, missing: true }
  if (!isSafeSessionPath(file, root)) {
    return { ok: false, cliId: 'codex', id, deletedCount: 0, error: '非法会话路径' }
  }

  try {
    unlinkSync(file)
    return { ok: true, cliId: 'codex', id, deletedCount: 1 }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { ok: true, cliId: 'codex', id, deletedCount: 0, missing: true }
    }
    return { ok: false, cliId: 'codex', id, deletedCount: 0, error: String(error) }
  }
}

function deletePiSession(id: string): SessionDeleteResult {
  const root = join(cliStateRoot('pi'), 'sessions')
  if (!existsSync(id)) return { ok: true, cliId: 'pi', id, deletedCount: 0, missing: true }
  if (!isSafeSessionPath(id, root)) {
    return { ok: false, cliId: 'pi', id, deletedCount: 0, error: '非法会话路径' }
  }

  try {
    unlinkSync(id)
    return { ok: true, cliId: 'pi', id, deletedCount: 1 }
  } catch (error) {
    if (isMissingFileError(error)) return { ok: true, cliId: 'pi', id, deletedCount: 0, missing: true }
    return { ok: false, cliId: 'pi', id, deletedCount: 0, error: String(error) }
  }
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
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

async function deleteOpencodeSession(id: string): Promise<SessionDeleteResult> {
  const dbPath = opencodeDbPath()
  if (!existsSync(dbPath)) return { ok: true, cliId: 'opencode', id, deletedCount: 0, missing: true }

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

export async function deleteSession(cliId: CliId, id: string): Promise<SessionDeleteResult> {
  const sessionId = id.trim()
  if (!sessionId) return { ok: false, cliId, id, deletedCount: 0, error: '会话 ID 不能为空' }

  try {
    if (cliId === 'claude-code') return deleteClaudeSession(sessionId)
    if (cliId === 'codex') return deleteCodexSession(sessionId)
    if (cliId === 'pi') return deletePiSession(sessionId)
    if (cliId === 'opencode') return await deleteOpencodeSession(sessionId)
    return { ok: false, cliId, id: sessionId, deletedCount: 0, error: '不支持删除这个 CLI 的会话' }
  } catch (error) {
    return { ok: false, cliId, id: sessionId, deletedCount: 0, error: String(error) }
  }
}

export async function listSessions(cliId: CliId): Promise<SessionInfo[]> {
  try {
    if (cliId === 'claude-code') return listClaude()
    if (cliId === 'codex') {
      const local = listCodex()
      try {
        return mergeCodexSessions(await listCodexLive(), local)
      } catch {
        return local
      }
    }
    if (cliId === 'pi') return listPi()
    if (cliId === 'opencode') return await listOpencode()
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
function pushPart(msgs: TranscriptMessage[], role: TranscriptRole, part: TranscriptPart, ts?: number): void {
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

/** Pick a one-line summary of a tool's input/args for compact display. */
function toolDetail(input: unknown): string | undefined {
  if (input == null) return undefined
  if (typeof input === 'string') return input.slice(0, 140)
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>
    for (const k of ['file_path', 'filePath', 'filepath', 'path', 'command', 'cmd', 'pattern', 'url', 'query', 'prompt', 'description']) {
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
  const root = join(cliStateRoot('claude-code'), 'projects')
  let file: string | null = null
  if (existsSync(root)) {
    for (const proj of readdirSync(root)) {
      const candidate = join(root, proj, `${id}.jsonl`)
      if (existsSync(candidate)) {
        file = candidate
        break
      }
    }
  }
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
        if (b.type === 'text') pushPart(msgs, role, { kind: 'text', text: role === 'user' ? stripCmd(b.text) : b.text }, ts)
        else if (b.type === 'thinking' || b.type === 'reasoning')
          pushPart(msgs, role, { kind: 'thinking', text: b.thinking ?? b.text }, ts)
        else if (b.type === 'tool_use')
          pushPart(msgs, role, {
            kind: 'tool',
            tool: b.name,
            detail: toolDetail(b.input),
            input: stringifyToolPayload(b.input),
            id: typeof b.id === 'string' ? b.id : undefined,
            status: 'completed'
          }, ts)
        else if (b.type === 'tool_result') {
          const result = extractToolResultText(b.content)
          const toolId = typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined
          if (!attachToolResult(msgs, toolId, result, b.is_error === true)) {
            pushPart(msgs, 'assistant', {
              kind: 'tool',
              tool: 'tool',
              result,
              isError: b.is_error === true,
              status: b.is_error === true ? 'error' : 'completed',
              id: toolId
            }, ts)
          }
        }
        else if (b.type === 'image') pushPart(msgs, role, { kind: 'text', text: '[image]' }, ts)
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
        p.role === 'user' ? 'user' : p.role === 'assistant' ? 'assistant' : p.role === 'system' ? 'system' : null
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
        ? p.summary.map((s: any) => (typeof s === 'string' ? s : s?.text)).filter(Boolean).join('\n')
        : typeof p.summary === 'string'
          ? p.summary
          : Array.isArray(p.content)
            ? p.content.map((c: any) => c?.text).filter(Boolean).join('\n')
            : ''
      pushPart(msgs, 'assistant', { kind: 'thinking', text: txt }, ts)
    } else if (o.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
      const callId = readString(p, ['call_id', 'callId', 'id'])
      pushPart(msgs, 'assistant', {
        kind: 'tool',
        tool: p.name || 'tool',
        detail: toolDetail(safeJson(p.arguments ?? p.input)),
        input: stringifyToolPayload(safeJson(p.arguments ?? p.input)),
        id: callId,
        status: p.status === 'failed' ? 'error' : 'running'
      }, ts)
    } else if (o.type === 'response_item' && (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')) {
      const callId = readString(p, ['call_id', 'callId', 'id'])
      const result = extractToolResultText(p.output ?? p.content)
      if (!attachToolResult(msgs, callId, result, p.status === 'failed')) {
        pushPart(msgs, 'assistant', {
          kind: 'tool',
          tool: 'tool',
          result,
          isError: p.status === 'failed',
          status: p.status === 'failed' ? 'error' : 'completed',
          id: callId
        }, ts)
      }
    } else if (o.type === 'response_item' && p.type === 'web_search_call') {
      const action = asRecord(p.action)
      pushPart(msgs, 'assistant', {
        kind: 'tool',
        tool: 'web_search',
        detail: toolDetail(action ?? p),
        input: stringifyToolPayload(action ?? p),
        id: readString(p, ['call_id', 'callId', 'id']),
        status: p.status === 'failed' ? 'error' : 'completed',
        isError: p.status === 'failed'
      }, ts)
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
          pushPart(msgs, role, {
            kind: 'tool',
            tool: b.name ?? b.tool ?? 'tool',
            detail: toolDetail(b.input ?? b.arguments),
            input: stringifyToolPayload(b.input ?? b.arguments),
            id: typeof b.id === 'string' ? b.id : typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined,
            status: 'completed'
          }, ts)
        else if (b.type === 'tool_result') {
          const toolId = typeof b.tool_use_id === 'string' ? b.tool_use_id : typeof b.id === 'string' ? b.id : undefined
          const result = extractToolResultText(b.content ?? b.output ?? b.result)
          if (!attachToolResult(msgs, toolId, result, b.is_error === true)) {
            pushPart(msgs, role, {
              kind: 'tool',
              tool: b.name ?? b.tool ?? 'tool',
              result,
              isError: b.is_error === true,
              status: b.is_error === true ? 'error' : 'completed',
              id: toolId
            }, ts)
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
  const db = new SQL.Database(readFileSync(dbPath))
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
    const mstmt = db.prepare('SELECT id, data, time_created FROM message WHERE session_id = $sid ORDER BY time_created')
    mstmt.bind({ $sid: id })
    while (mstmt.step()) {
      const row = mstmt.getAsObject() as { id: string; data: string; time_created?: number | string }
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
    const pstmt = db.prepare('SELECT message_id, data FROM part WHERE session_id = $sid ORDER BY time_created')
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
            detail: toolDetail(d.state?.input) ?? (typeof d.state?.title === 'string' ? d.state.title : undefined),
            input: stringifyToolPayload(d.state?.input),
            result: extractToolResultText(d.state?.output ?? d.state?.result),
            isError: d.state?.status === 'error' || d.state?.status === 'failed',
            status: d.state?.status === 'completed'
              ? 'completed'
              : d.state?.status === 'error' || d.state?.status === 'failed'
                ? 'error'
                : 'running',
            id: typeof d.callID === 'string' ? d.callID : typeof d.callId === 'string' ? d.callId : undefined
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

/** Read a session's conversation as a normalized, read-only transcript. */
export async function readTranscript(cliId: CliId, id: string): Promise<Transcript> {
  try {
    if (cliId === 'claude-code') return claudeTranscript(id)
    if (cliId === 'codex') return codexTranscript(id)
    if (cliId === 'pi') return piTranscript(id)
    if (cliId === 'opencode') return await opencodeTranscript(id)
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
  return null
}
