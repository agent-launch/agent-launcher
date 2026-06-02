import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './sandbox'
import type { CliId, SessionInfo } from '@shared/types'

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
    let name: string | null = null
    let cwd: string | undefined
    let firstUser: string | null = null
    for (const rec of readLines(ref.full)) {
      const o = rec as Record<string, any>
      if (o.type === 'ai-title' && o.aiTitle) name = o.aiTitle
      if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
      if (!firstUser && o.type === 'user' && o.message) {
        const c = o.message.content
        firstUser =
          typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x) => x.type === 'text')?.text ?? null) : null
      }
    }
    return {
      id: ref.id,
      cliId: 'claude-code' as CliId,
      name: (name || firstUser || '未命名会话').trim().slice(0, 80),
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

export function listSessions(cliId: CliId): SessionInfo[] {
  try {
    if (cliId === 'claude-code') return listClaude()
    if (cliId === 'codex') return listCodex()
    return [] // Gemini CLI resume not wired yet
  } catch {
    return []
  }
}

/** Args to resume a given session, or null if the CLI can't resume by id. */
export function resumeArgs(cliId: CliId, id: string): string[] | null {
  if (cliId === 'claude-code') return ['--resume', id]
  if (cliId === 'codex') return ['resume', id]
  return null
}
