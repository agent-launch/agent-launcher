import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { paths } from './sandbox'
import type {
  CliId,
  SessionInfo,
  Transcript,
  TranscriptMessage,
  TranscriptPart,
  TranscriptRole
} from '@shared/types'

const MAX_LIST = 50 // only parse the most-recently-touched files

interface FileRef {
  full: string
  id: string
  mtimeMs: number
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

/** Claude: <cfg>/projects/<encoded-cwd>/<uuid>.jsonl, name from `ai-title`. */
function listClaude(): SessionInfo[] {
  const root = join(paths.cliConfig('claude-code'), 'projects')
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
      if (!f.endsWith('.jsonl')) continue
      const full = join(dir, f)
      try {
        refs.push({ full, id: f.replace(/\.jsonl$/, ''), mtimeMs: statSync(full).mtimeMs })
      } catch {
        /* ignore */
      }
    }
  }
  return recentJsonl(refs).map((ref) => {
    // Mirror `claude --resume`'s title priority: customTitle → aiTitle →
    // lastPrompt → summary → first (cleaned) user prompt. Relays often don't
    // generate aiTitle, in which case claude shows the LATEST prompt — not the
    // first raw message (which may just be a slash-command wrapper).
    let aiTitle: string | null = null
    let customTitle: string | null = null
    let lastPrompt: string | null = null
    let summary: string | null = null
    let cwd: string | undefined
    let firstUser: string | null = null
    for (const rec of readLines(ref.full)) {
      const o = rec as Record<string, any>
      if (o.type === 'ai-title' && o.aiTitle) aiTitle = o.aiTitle
      else if (o.type === 'last-prompt' && typeof o.lastPrompt === 'string') lastPrompt = o.lastPrompt
      else if (o.type === 'summary' && typeof o.summary === 'string') summary = o.summary
      if (typeof o.customTitle === 'string' && o.customTitle) customTitle = o.customTitle
      if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
      if (!firstUser && o.type === 'user' && o.message) {
        const c = o.message.content
        const raw =
          typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x) => x.type === 'text')?.text ?? null) : null
        const cleaned = raw ? stripCmd(raw) : null
        if (cleaned) firstUser = cleaned
      }
    }
    const title = customTitle || aiTitle || lastPrompt || summary || firstUser || '未命名会话'
    return {
      id: ref.id,
      cliId: 'claude-code' as CliId,
      name: title.trim().slice(0, 80),
      updatedAt: ref.mtimeMs,
      cwd
    }
  })
}

/** Codex: <cfg>/sessions/YYYY/MM/DD/rollout-*-<uuid>.jsonl, meta in first line. */
function listCodex(): SessionInfo[] {
  const root = join(paths.cliConfig('codex'), 'sessions')
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
  return recentJsonl(refs).map((ref) => {
    const lines = readLines(ref.full)
    const meta = (lines[0] as Record<string, any>)?.payload ?? {}
    let name: string | null = null
    for (const rec of lines) {
      const o = rec as Record<string, any>
      const p = o.payload ?? {}
      if (o.type === 'event_msg' && p.type === 'user_message' && p.message) {
        name = String(p.message)
        break
      }
      if (o.type === 'response_item' && p.role === 'user') {
        const t = Array.isArray(p.content) ? p.content.find((x: any) => x.text)?.text : p.content
        if (t && !String(t).startsWith('<environment_context>')) {
          name = String(t)
          break
        }
      }
    }
    return {
      id: meta.id || ref.full.match(/([0-9a-f-]{36})\.jsonl$/)?.[1] || '',
      cliId: 'codex' as CliId,
      name: (name || 'Codex 会话').trim().slice(0, 80),
      updatedAt: ref.mtimeMs,
      cwd: typeof meta.cwd === 'string' ? meta.cwd : undefined
    }
  })
}

/** Pi: JSONL session files under <cfg>/sessions (organized by working dir). */
function listPi(): SessionInfo[] {
  const root = join(paths.cliConfig('pi'), 'sessions')
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
  const dbPath = join(paths.cliConfig('opencode'), 'xdg-data', 'opencode', 'opencode.db')
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

export async function listSessions(cliId: CliId): Promise<SessionInfo[]> {
  try {
    if (cliId === 'claude-code') return listClaude()
    if (cliId === 'codex') return listCodex()
    if (cliId === 'pi') return listPi()
    if (cliId === 'opencode') return await listOpencode()
    return [] // Gemini CLI resume not wired yet
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Transcript reading: normalize each CLI's stored conversation into a common
// read-only model so the renderer can show it without launching the CLI.
// ---------------------------------------------------------------------------

const MAX_MSG = 800 // cap very long conversations

/** Append a part, merging into the previous message when the role matches. */
function pushPart(msgs: TranscriptMessage[], role: TranscriptRole, part: TranscriptPart): void {
  if (part.kind !== 'tool' && !part.text?.trim()) return
  const last = msgs[msgs.length - 1]
  if (last && last.role === role) last.parts.push(part)
  else msgs.push({ role, parts: [part] })
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

function done(cliId: CliId, id: string, messages: TranscriptMessage[], truncated = false): Transcript {
  return { cliId, id, messages, truncated }
}

/** Claude: locate <id>.jsonl across projects/*, map message.content blocks. */
function claudeTranscript(id: string): Transcript {
  const root = join(paths.cliConfig('claude-code'), 'projects')
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
  for (const rec of readLines(file)) {
    const o = rec as Record<string, any>
    if (o.type !== 'user' && o.type !== 'assistant') continue
    const role: TranscriptRole = o.type === 'assistant' ? 'assistant' : 'user'
    const content = o.message?.content
    if (typeof content === 'string') {
      pushPart(msgs, role, { kind: 'text', text: stripCmd(content) })
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text') pushPart(msgs, role, { kind: 'text', text: b.text })
        else if (b.type === 'thinking') pushPart(msgs, role, { kind: 'thinking', text: b.thinking })
        else if (b.type === 'tool_use')
          pushPart(msgs, role, { kind: 'tool', tool: b.name, detail: toolDetail(b.input) })
        else if (b.type === 'image') pushPart(msgs, role, { kind: 'text', text: '[image]' })
        // tool_result blocks (carried on user messages) are intentionally skipped
      }
    }
    if (msgs.length >= MAX_MSG) return done('claude-code', id, msgs, true)
  }
  return done('claude-code', id, msgs)
}

/** Codex: find rollout file containing the uuid; map events + response items. */
function codexTranscript(id: string): Transcript {
  const root = join(paths.cliConfig('codex'), 'sessions')
  let file: string | null = null
  if (existsSync(root)) {
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (file) return
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name.endsWith('.jsonl') && e.name.includes(id)) file = full
      }
    }
    try {
      walk(root)
    } catch {
      /* ignore */
    }
  }
  const msgs: TranscriptMessage[] = []
  if (!file) return done('codex', id, msgs)
  for (const rec of readLines(file)) {
    const o = rec as Record<string, any>
    const p = o.payload ?? {}
    if (o.type === 'event_msg' && p.type === 'user_message' && p.message) {
      pushPart(msgs, 'user', { kind: 'text', text: String(p.message) })
    } else if (o.type === 'response_item' && p.type === 'message' && p.role === 'assistant') {
      const blocks = Array.isArray(p.content) ? p.content : []
      for (const b of blocks) {
        if (b.type === 'output_text' || b.type === 'text')
          pushPart(msgs, 'assistant', { kind: 'text', text: b.text })
      }
    } else if (o.type === 'response_item' && p.type === 'reasoning') {
      const txt = Array.isArray(p.summary)
        ? p.summary.map((s: any) => (typeof s === 'string' ? s : s?.text)).filter(Boolean).join('\n')
        : typeof p.summary === 'string'
          ? p.summary
          : Array.isArray(p.content)
            ? p.content.map((c: any) => c?.text).filter(Boolean).join('\n')
            : ''
      pushPart(msgs, 'assistant', { kind: 'thinking', text: txt })
    } else if (o.type === 'response_item' && p.type === 'function_call') {
      pushPart(msgs, 'assistant', {
        kind: 'tool',
        tool: p.name || 'tool',
        detail: toolDetail(safeJson(p.arguments))
      })
    }
    if (msgs.length >= MAX_MSG) return done('codex', id, msgs, true)
  }
  return done('codex', id, msgs)
}

/** Pi: id is the file path; map message records (text + tool, defensive). */
function piTranscript(file: string): Transcript {
  const msgs: TranscriptMessage[] = []
  if (!existsSync(file)) return done('pi', file, msgs)
  for (const rec of readLines(file)) {
    const o = rec as Record<string, any>
    if (o.type !== 'message' || !o.message) continue
    const r = o.message.role
    const role: TranscriptRole = r === 'assistant' ? 'assistant' : r === 'user' ? 'user' : 'system'
    const c = o.message.content
    if (typeof c === 'string') {
      pushPart(msgs, role, { kind: 'text', text: c })
    } else if (Array.isArray(c)) {
      for (const b of c) {
        if (b.type === 'text') pushPart(msgs, role, { kind: 'text', text: b.text })
        else if (b.type === 'thinking' || b.type === 'reasoning')
          pushPart(msgs, role, { kind: 'thinking', text: b.text ?? b.thinking })
        else if (b.type === 'tool_use' || b.type === 'tool_call')
          pushPart(msgs, role, {
            kind: 'tool',
            tool: b.name ?? b.tool ?? 'tool',
            detail: toolDetail(b.input ?? b.arguments)
          })
      }
    }
    if (msgs.length >= MAX_MSG) return done('pi', file, msgs, true)
  }
  return done('pi', file, msgs)
}

/** opencode: join message + part (data JSON) by session_id, ordered by time. */
async function opencodeTranscript(id: string): Promise<Transcript> {
  const dbPath = join(paths.cliConfig('opencode'), 'xdg-data', 'opencode', 'opencode.db')
  const msgs: TranscriptMessage[] = []
  if (!existsSync(dbPath)) return done('opencode', id, msgs)
  const SQL = await getSql()
  const db = new SQL.Database(readFileSync(dbPath))
  try {
    const roleById = new Map<string, TranscriptRole>()
    const order: string[] = []
    const mstmt = db.prepare('SELECT id, data FROM message WHERE session_id = $sid ORDER BY time_created')
    mstmt.bind({ $sid: id })
    while (mstmt.step()) {
      const row = mstmt.getAsObject() as { id: string; data: string }
      let role: TranscriptRole = 'assistant'
      try {
        const d = JSON.parse(row.data)
        role = d.role === 'user' ? 'user' : d.role === 'assistant' ? 'assistant' : 'system'
      } catch {
        /* keep default */
      }
      roleById.set(String(row.id), role)
      order.push(String(row.id))
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
            detail: toolDetail(d.state?.input) ?? (typeof d.state?.title === 'string' ? d.state.title : undefined)
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
      for (const part of partsByMsg.get(mid) ?? []) pushPart(msgs, role, part)
      if (msgs.length >= MAX_MSG) return done('opencode', id, msgs, true)
    }
  } finally {
    db.close()
  }
  return done('opencode', id, msgs)
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
