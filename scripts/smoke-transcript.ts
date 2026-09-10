// Ad-hoc smoke for transcript parsing. Reads a real on-disk session from the
// CLI's standard home and prints a compact view.
// Run: npx tsx scripts/smoke-transcript.ts [claude-code|codex]
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { readTranscript } from '../src/main/sessions-history'
import type { CliId } from '../src/shared/types'

function newest(dir: string, match: (n: string) => boolean): string | null {
  // Assigned inside the walk closure, so TS can't track the narrowing.
  let best = null as { f: string; m: number } | null
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (match(e.name)) {
        const m = statSync(full).mtimeMs
        if (!best || m > best.m) best = { f: full, m }
      }
    }
  }
  try {
    walk(dir)
  } catch {
    /* ignore */
  }
  return best?.f ?? null
}

function dump(cliId: CliId, messages: { role: string; parts: any[] }[]): void {
  for (const m of messages.slice(0, 20)) {
    console.log(`\n[${m.role}]`)
    for (const p of m.parts) {
      if (p.kind === 'tool') console.log(`  🔧 ${p.tool} ${p.detail ?? ''}`)
      else if (p.kind === 'thinking') console.log(`  (thinking) ${String(p.text).slice(0, 80)}…`)
      else console.log(`  ${String(p.text).slice(0, 200)}`)
    }
  }
}

async function main() {
  const which = (process.argv[2] as CliId) || 'claude-code'
  if (which === 'claude-code') {
    const src = newest(join(homedir(), '.claude', 'projects'), (n) => n.endsWith('.jsonl'))
    if (!src) return console.log('no real claude sessions found')
    const id = src
      .replace(/\.jsonl$/, '')
      .split('/')
      .pop()!
    console.log('claude id:', id)
    dump('claude-code', (await readTranscript('claude-code', id)).messages)
  } else if (which === 'codex') {
    const src = newest(
      join(homedir(), '.codex', 'sessions'),
      (n) => n.startsWith('rollout-') && n.endsWith('.jsonl')
    )
    if (!src) return console.log('no real codex sessions found')
    const uuid = src.match(/([0-9a-f-]{36})\.jsonl$/)?.[1]
    if (!uuid) throw new Error(`Could not read a Codex session id from ${src}`)
    console.log('codex uuid:', uuid)
    dump('codex', (await readTranscript('codex', uuid)).messages)
  }
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
