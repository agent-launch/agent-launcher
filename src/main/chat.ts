import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import type { WebContents } from 'electron'
import { paths } from './sandbox'
import { loadConfig, getActiveProfile, getInstallSource } from './store'
import { buildCliEnv } from './cli-env'
import { resolveLaunchCwd } from './launch-cwd'
import { writeNativeConfig, hasNativeConfig } from './native-config'
import { spawnProcess } from './process'
import type { ChatEvent, ChatStartOptions, CliId, TranscriptPart, TranscriptRole } from '@shared/types'

/**
 * In-UI chat driver. Runs a coding-agent CLI in its programmatic mode and
 * streams normalized ChatEvents to the renderer. Two process models:
 *  - Claude Code: one long-lived process; turns are sent as stream-json lines
 *    on stdin (`--input/--output-format stream-json`).
 *  - Codex / opencode / Pi: a fresh process per turn (exec/run with a resume id);
 *    the turn ends when that process exits.
 * Tool calls are auto-approved (per-CLI bypass flag).
 */
interface ChatState {
  cliId: CliId
  wc: WebContents
  cwd: string
  sessionId?: string
  persistent?: ChildProcess // claude
  turn?: ChildProcess // current per-turn process
  buf: string
  sawText: boolean // whether the current turn produced any output (for error fallback)
  stderr: string
}

const chats = new Map<string, ChatState>()
let seq = 0

const PERSISTENT = new Set<CliId>(['claude-code'])

function send(wc: WebContents, id: string, ev: ChatEvent): void {
  if (!wc.isDestroyed()) wc.send('chat:event', id, ev)
}

function emitPart(s: ChatState, id: string, role: TranscriptRole, part: TranscriptPart): void {
  s.sawText = true
  send(s.wc, id, { type: 'part', role, part, ts: Date.now() })
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
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    for (const key of ['text', 'content', 'value']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) {
        out.push(value.trim())
        break
      }
    }
  }
  return out.length ? out.join('\n\n') : undefined
}

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

function setSession(s: ChatState, id: string, sid: unknown): void {
  if (typeof sid === 'string' && sid && s.sessionId !== sid) {
    s.sessionId = sid
    send(s.wc, id, { type: 'session', sessionId: sid })
  }
}

// ---------- per-CLI line parsers ----------

function handleClaude(s: ChatState, id: string, o: Record<string, any>): void {
  if (o.type === 'system' && o.subtype === 'init') return setSession(s, id, o.session_id)
  if (o.type === 'assistant' && o.message) {
    const blocks = Array.isArray(o.message.content) ? o.message.content : []
    for (const b of blocks) {
      if (b.type === 'text' && b.text) emitPart(s, id, 'assistant', { kind: 'text', text: b.text })
      else if (b.type === 'thinking' && b.thinking)
        emitPart(s, id, 'assistant', { kind: 'thinking', text: b.thinking })
      else if (b.type === 'tool_use')
        emitPart(s, id, 'assistant', {
          kind: 'tool',
          tool: b.name || 'tool',
          detail: toolDetail(b.input),
          input: stringifyToolPayload(b.input),
          id: typeof b.id === 'string' ? b.id : undefined,
          status: 'running'
        })
    }
    return
  }
  if (o.type === 'user' && o.message) {
    const blocks = Array.isArray(o.message.content) ? o.message.content : []
    for (const b of blocks) {
      if (b.type !== 'tool_result') continue
      const toolId = typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined
      emitPart(s, id, 'assistant', {
        kind: 'tool',
        tool: 'tool',
        result: extractToolResultText(b.content),
        isError: b.is_error === true,
        status: b.is_error === true ? 'error' : 'completed',
        id: toolId
      })
    }
    return
  }
  if (o.type === 'result') send(s.wc, id, { type: 'turn-end' })
}

function handleCodex(s: ChatState, id: string, o: Record<string, any>): void {
  if (o.type === 'thread.started') return setSession(s, id, o.thread_id)
  if (o.type === 'item.completed' && o.item) {
    const it = o.item
    if (it.type === 'agent_message' || it.type === 'assistant_message') {
      if (it.text) emitPart(s, id, 'assistant', { kind: 'text', text: it.text })
    } else if (it.type === 'reasoning') {
      if (it.text) emitPart(s, id, 'assistant', { kind: 'thinking', text: it.text })
    } else if (it.type === 'command_execution') {
      emitPart(s, id, 'assistant', {
        kind: 'tool',
        tool: 'shell',
        detail: toolDetail(it.command ?? it),
        input: stringifyToolPayload(it.command ?? it),
        result: extractToolResultText(it.output ?? it.result),
        status: it.status === 'failed' ? 'error' : 'completed',
        isError: it.status === 'failed',
        id: typeof it.call_id === 'string' ? it.call_id : typeof it.id === 'string' ? it.id : undefined
      })
    } else if (it.type === 'file_change') {
      emitPart(s, id, 'assistant', {
        kind: 'tool',
        tool: 'edit',
        detail: toolDetail(it.path ?? it.changes ?? it),
        input: stringifyToolPayload(it.path ?? it.changes ?? it),
        result: extractToolResultText(it.output ?? it.result),
        status: it.status === 'failed' ? 'error' : 'completed',
        isError: it.status === 'failed',
        id: typeof it.call_id === 'string' ? it.call_id : typeof it.id === 'string' ? it.id : undefined
      })
    } else if (it.type === 'mcp_tool_call') {
      emitPart(s, id, 'assistant', {
        kind: 'tool',
        tool: it.tool || it.server || 'mcp',
        detail: toolDetail(it.arguments),
        input: stringifyToolPayload(it.arguments),
        result: extractToolResultText(it.output ?? it.result),
        status: it.status === 'failed' ? 'error' : 'completed',
        isError: it.status === 'failed',
        id: typeof it.call_id === 'string' ? it.call_id : typeof it.id === 'string' ? it.id : undefined
      })
    } else if (it.type === 'web_search') {
      emitPart(s, id, 'assistant', {
        kind: 'tool',
        tool: 'web_search',
        detail: toolDetail(it.query),
        input: stringifyToolPayload(it.query),
        result: extractToolResultText(it.output ?? it.result),
        status: it.status === 'failed' ? 'error' : 'completed',
        isError: it.status === 'failed',
        id: typeof it.call_id === 'string' ? it.call_id : typeof it.id === 'string' ? it.id : undefined
      })
    }
    return
  }
  if (o.type === 'response_item' && o.payload) {
    const p = o.payload
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      emitPart(s, id, 'assistant', {
        kind: 'tool',
        tool: p.name || 'tool',
        detail: toolDetail(p.arguments ?? p.input),
        input: stringifyToolPayload(p.arguments ?? p.input),
        id: typeof p.call_id === 'string' ? p.call_id : typeof p.id === 'string' ? p.id : undefined,
        status: p.status === 'failed' ? 'error' : 'running',
        isError: p.status === 'failed'
      })
      return
    }
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      emitPart(s, id, 'assistant', {
        kind: 'tool',
        tool: 'tool',
        result: extractToolResultText(p.output ?? p.content),
        id: typeof p.call_id === 'string' ? p.call_id : typeof p.id === 'string' ? p.id : undefined,
        status: p.status === 'failed' ? 'error' : 'completed',
        isError: p.status === 'failed'
      })
      return
    }
  }
  if (o.type === 'turn.failed') send(s.wc, id, { type: 'error', message: String(o.error?.message ?? 'turn failed') })
  else if (o.type === 'error' && o.message && !String(o.message).startsWith('Reconnecting'))
    send(s.wc, id, { type: 'error', message: String(o.message) })
}

function handlePi(s: ChatState, id: string, o: Record<string, any>): void {
  if (o.type === 'session') return setSession(s, id, o.id)
  if (o.type === 'message' && o.message) {
    const r = o.message.role
    const role: TranscriptRole = r === 'assistant' ? 'assistant' : r === 'user' ? 'user' : 'system'
    if (role === 'user') return // we already render the user's own message
    const c = o.message.content
    if (typeof c === 'string') emitPart(s, id, role, { kind: 'text', text: c })
    else if (Array.isArray(c))
      for (const b of c) {
        if (b.type === 'text') emitPart(s, id, role, { kind: 'text', text: b.text })
        else if (b.type === 'thinking' || b.type === 'reasoning')
          emitPart(s, id, role, { kind: 'thinking', text: b.text ?? b.thinking })
        else if (b.type === 'tool_use' || b.type === 'tool_call')
          emitPart(s, id, role, {
            kind: 'tool',
            tool: b.name ?? b.tool ?? 'tool',
            detail: toolDetail(b.input ?? b.arguments),
            input: stringifyToolPayload(b.input ?? b.arguments),
            id: typeof b.id === 'string' ? b.id : typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined,
            status: 'running'
          })
        else if (b.type === 'tool_result')
          emitPart(s, id, role, {
            kind: 'tool',
            tool: b.name ?? b.tool ?? 'tool',
            result: extractToolResultText(b.content ?? b.output ?? b.result),
            isError: b.is_error === true,
            status: b.is_error === true ? 'error' : 'completed',
            id: typeof b.tool_use_id === 'string' ? b.tool_use_id : typeof b.id === 'string' ? b.id : undefined
          })
      }
  }
}

function handleOpencode(s: ChatState, id: string, o: Record<string, any>): void {
  if (typeof o.sessionID === 'string') setSession(s, id, o.sessionID)
  if (o.type === 'message.part.updated' && o.part) {
    const p = o.part
    if (p.type === 'text' && p.text) emitPart(s, id, 'assistant', { kind: 'text', text: p.text, id: p.id })
    else if (p.type === 'reasoning' && p.text)
      emitPart(s, id, 'assistant', { kind: 'thinking', text: p.text, id: p.id })
    else if (p.type === 'tool')
      emitPart(s, id, 'assistant', {
        kind: 'tool',
        tool: p.tool || 'tool',
        detail: toolDetail(p.state?.input) ?? (typeof p.state?.title === 'string' ? p.state.title : undefined),
        input: stringifyToolPayload(p.state?.input),
        result: extractToolResultText(p.state?.output ?? p.state?.result),
        isError: p.state?.status === 'error' || p.state?.status === 'failed',
        status: p.state?.status === 'completed'
          ? 'completed'
          : p.state?.status === 'error' || p.state?.status === 'failed'
            ? 'error'
            : 'running',
        id: p.id
      })
    return
  }
  if ((o.type === 'session.error' || o.type === 'error') && o.error)
    send(s.wc, id, { type: 'error', message: String(o.error?.data?.message ?? o.error?.message ?? 'error') })
}

function handleLine(s: ChatState, id: string, o: Record<string, any>): void {
  if (s.cliId === 'claude-code') handleClaude(s, id, o)
  else if (s.cliId === 'codex') handleCodex(s, id, o)
  else if (s.cliId === 'pi') handlePi(s, id, o)
  else if (s.cliId === 'opencode') handleOpencode(s, id, o)
}

/** Buffer a stdout stream and feed complete JSON lines to the parser. */
function attachParser(s: ChatState, id: string, stream: NodeJS.ReadableStream): void {
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    s.buf += chunk
    let nl: number
    while ((nl = s.buf.indexOf('\n')) >= 0) {
      const line = s.buf.slice(0, nl).trim()
      s.buf = s.buf.slice(nl + 1)
      if (!line || line[0] !== '{') continue // skip blanks + non-JSON log lines
      try {
        handleLine(s, id, JSON.parse(line))
      } catch {
        /* partial/non-JSON */
      }
    }
  })
}

// ---------- per-turn (codex / opencode / pi) ----------

function turnTarget(s: ChatState, text: string): { file: string; args: string[] } {
  const cfg = loadConfig()
  const install = cfg.install[s.cliId]
  const bin = install.binPath as string
  if (s.cliId === 'codex') {
    const base = s.sessionId ? ['exec', 'resume', s.sessionId, text] : ['exec', text]
    return { file: bin, args: [...base, '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox'] }
  }
  if (s.cliId === 'opencode') {
    const sess = s.sessionId ? ['--session', s.sessionId] : []
    return { file: bin, args: ['run', text, '--format', 'json', ...sess] }
  }
  const sess = s.sessionId ? ['--session', s.sessionId] : []
  const profile = getActiveProfile('pi')
  const modelArgs = profile?.baseUrl && profile.model ? ['--model', `agentlauncher/${profile.model}`] : []
  if (install.source === 'system') {
    return { file: bin, args: ['--mode', 'json', '-p', text, ...sess, ...modelArgs] }
  }
  // Sandboxed pi (node app): node + cli.js entry.
  const entry = install.nodeEntry as string
  return { file: bin, args: [entry, '--mode', 'json', '-p', text, ...sess, ...modelArgs] }
}

function spawnTurn(s: ChatState, id: string, text: string): void {
  if (hasNativeConfig(s.cliId) && s.cliId !== 'claude-code') writeNativeConfig(s.cliId)
  const { file, args } = turnTarget(s, text)
  s.buf = ''
  s.sawText = false
  s.stderr = ''
  const proc = spawnProcess(file, args, { cwd: s.cwd, env: buildCliEnv(s.cliId) as NodeJS.ProcessEnv })
  s.turn = proc
  // Prompt is passed as an argv; close stdin so the CLI doesn't block reading it
  // (codex exec waits for stdin EOF otherwise).
  proc.stdin?.end()
  attachParser(s, id, proc.stdout!)
  proc.stderr!.setEncoding('utf8')
  proc.stderr!.on('data', (d: string) => (s.stderr += d))
  proc.on('error', (e) => send(s.wc, id, { type: 'error', message: e.message }))
  proc.on('exit', () => {
    s.turn = undefined
    // If the turn produced no visible output, surface a trimmed stderr as the error.
    if (!s.sawText && s.stderr.trim()) {
      send(s.wc, id, { type: 'error', message: s.stderr.trim().split('\n').slice(-3).join('\n').slice(0, 400) })
    }
    send(s.wc, id, { type: 'turn-end' })
  })
}

// ---------- public API ----------

export function startChat(wc: WebContents, opts: ChatStartOptions): string {
  const cfg = loadConfig()
  const install = cfg.install[opts.cliId]
  if (!install.installed || !install.binPath) throw new Error(`${opts.cliId} 尚未安装`)

  const cwd = resolveLaunchCwd(opts.cwd)
  if (hasNativeConfig(opts.cliId) && opts.cliId !== 'claude-code') writeNativeConfig(opts.cliId)
  if (getInstallSource(opts.cliId) !== 'system') {
    mkdirSync(paths.cliConfig(opts.cliId), { recursive: true })
  }

  const id = `chat-${++seq}`
  const s: ChatState = { cliId: opts.cliId, wc, cwd, sessionId: opts.resumeId, buf: '', sawText: false, stderr: '' }
  chats.set(id, s)

  if (PERSISTENT.has(opts.cliId)) {
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions'
    ]
    if (opts.resumeId) args.push('--resume', opts.resumeId)
    else args.push('--session-id', randomUUID())
    const proc = spawnProcess(install.binPath, args, { cwd, env: buildCliEnv(opts.cliId) as NodeJS.ProcessEnv })
    s.persistent = proc
    attachParser(s, id, proc.stdout!)
    proc.stderr!.setEncoding('utf8')
    proc.stderr!.on('data', (d: string) => {
      const msg = String(d).trim()
      if (msg) send(wc, id, { type: 'error', message: msg.slice(0, 400) })
    })
    proc.on('error', (e) => send(wc, id, { type: 'error', message: e.message }))
    proc.on('exit', () => {
      chats.delete(id)
      send(wc, id, { type: 'exit' })
    })
  }
  // per-turn CLIs spawn lazily in sendChat.
  return id
}

export function sendChat(id: string, text: string): void {
  const s = chats.get(id)
  if (!s) return
  if (s.persistent) {
    const msg = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
    try {
      s.persistent.stdin?.write(JSON.stringify(msg) + '\n')
    } catch {
      /* process gone */
    }
    return
  }
  if (s.turn) return // a turn is already running (UI also guards this)
  spawnTurn(s, id, text)
}

export function stopChat(id: string): void {
  const s = chats.get(id)
  if (!s) return
  try {
    s.turn?.kill()
    s.persistent?.kill()
  } catch {
    /* already dead */
  }
  chats.delete(id)
}

export function killAllChats(): void {
  for (const id of [...chats.keys()]) stopChat(id)
}
