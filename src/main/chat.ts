import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import type { WebContents } from 'electron'
import { paths } from './sandbox'
import { loadConfig } from './store'
import { buildCliEnv } from './cli-env'
import type { ChatEvent, ChatStartOptions, TranscriptPart } from '@shared/types'

/**
 * In-UI chat driver. Runs a coding-agent CLI in its programmatic mode (instead
 * of the interactive terminal) and streams normalized ChatEvents to the
 * renderer. MVP: Claude Code only, via bidirectional `--*-format stream-json`
 * over stdio (a single long-lived process handles many turns). Tool calls are
 * auto-approved (--dangerously-skip-permissions).
 */
interface ChatProc {
  proc: ChildProcessWithoutNullStreams
  cliId: ChatStartOptions['cliId']
  wc: WebContents
  buf: string
}

const chats = new Map<string, ChatProc>()
let seq = 0

/** One-line summary of a tool's input for compact display. */
function toolDetail(input: unknown): string | undefined {
  if (input == null) return undefined
  if (typeof input === 'string') return input.slice(0, 140)
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>
    for (const k of ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'prompt', 'description']) {
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

function send(wc: WebContents, id: string, ev: ChatEvent): void {
  if (!wc.isDestroyed()) wc.send('chat:event', id, ev)
}

/** Map one Claude stream-json line into ChatEvents and emit them. */
function handleClaudeLine(c: ChatProc, id: string, line: Record<string, any>): void {
  if (line.type === 'system' && line.subtype === 'init' && line.session_id) {
    send(c.wc, id, { type: 'session', sessionId: String(line.session_id) })
    return
  }
  if (line.type === 'assistant' && line.message) {
    const content = line.message.content
    const blocks = Array.isArray(content) ? content : []
    for (const b of blocks) {
      let part: TranscriptPart | null = null
      if (b.type === 'text' && b.text) part = { kind: 'text', text: b.text }
      else if (b.type === 'thinking' && b.thinking) part = { kind: 'thinking', text: b.thinking }
      else if (b.type === 'tool_use') part = { kind: 'tool', tool: b.name || 'tool', detail: toolDetail(b.input) }
      if (part) send(c.wc, id, { type: 'part', role: 'assistant', part })
    }
    return
  }
  if (line.type === 'result') {
    send(c.wc, id, { type: 'turn-end' })
  }
  // `user` lines carry auto tool_result blocks (auto-approved) — not displayed.
}

function onData(c: ChatProc, id: string, chunk: string): void {
  c.buf += chunk
  let nl: number
  while ((nl = c.buf.indexOf('\n')) >= 0) {
    const line = c.buf.slice(0, nl).trim()
    c.buf = c.buf.slice(nl + 1)
    if (!line) continue
    let obj: Record<string, any>
    try {
      obj = JSON.parse(line)
    } catch {
      continue // skip non-JSON (stray logging)
    }
    if (c.cliId === 'claude-code') handleClaudeLine(c, id, obj)
  }
}

export function startChat(wc: WebContents, opts: ChatStartOptions): string {
  if (opts.cliId !== 'claude-code') {
    throw new Error(`UI 聊天暂仅支持 Claude Code（${opts.cliId} 待接入）`)
  }
  const cfg = loadConfig()
  const install = cfg.install['claude-code']
  if (!install.installed || !install.binPath) throw new Error('claude-code 尚未安装')

  const cwd = opts.cwd && opts.cwd.length ? opts.cwd : homedir()
  mkdirSync(paths.cliConfig('claude-code'), { recursive: true })

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

  const proc = spawn(install.binPath, args, {
    cwd,
    env: buildCliEnv('claude-code') as NodeJS.ProcessEnv
  })

  const id = `chat-${++seq}`
  const c: ChatProc = { proc, cliId: opts.cliId, wc, buf: '' }
  chats.set(id, c)

  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (d: string) => onData(c, id, d))
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (d: string) => {
    // Surface fatal-looking stderr (e.g. auth/relay errors) to the UI.
    const msg = d.trim()
    if (msg) send(wc, id, { type: 'error', message: msg.slice(0, 400) })
  })
  proc.on('error', (e) => send(wc, id, { type: 'error', message: e.message }))
  proc.on('exit', () => {
    chats.delete(id)
    send(wc, id, { type: 'exit' })
  })

  return id
}

/** Send a user turn (one stream-json line on stdin). */
export function sendChat(id: string, text: string): void {
  const c = chats.get(id)
  if (!c) return
  const msg = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
  try {
    c.proc.stdin.write(JSON.stringify(msg) + '\n')
  } catch {
    /* process gone */
  }
}

export function stopChat(id: string): void {
  const c = chats.get(id)
  if (!c) return
  try {
    c.proc.kill()
  } catch {
    /* already dead */
  }
  chats.delete(id)
}

export function killAllChats(): void {
  for (const id of [...chats.keys()]) stopChat(id)
}
