import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import * as pty from '@lydell/node-pty'
import type { WebContents } from 'electron'
import { paths } from './sandbox'
import { loadConfig, getActiveProfile, getPrefs } from './store'
import { buildCliEnv } from './cli-env'
import { resumeArgs } from './sessions-history'
import { writeNativeConfig, hasNativeConfig } from './native-config'
import type { CliId } from '@shared/types'

export interface SpawnOptions {
  cliId: CliId
  /** 'cli' runs the CLI binary directly; 'shell' opens a shell with env+PATH injected. */
  mode: 'cli' | 'shell'
  cwd?: string
  /** When set (cli mode), resume this saved session instead of starting fresh. */
  resumeId?: string
  cols?: number
  rows?: number
}

interface Session {
  proc: pty.IPty
  cliId: CliId
}

const sessions = new Map<string, Session>()
let seq = 0

/** The flag that auto-approves everything ("YOLO"), or null if unsupported. */
function yoloArgs(cliId: CliId): string[] | null {
  switch (cliId) {
    case 'claude-code':
      return ['--dangerously-skip-permissions']
    case 'codex':
      return ['--dangerously-bypass-approvals-and-sandbox']
    case 'gemini':
      return ['--yolo']
    case 'opencode':
      return ['--dangerously-skip-permissions']
    default:
      return null // pi has no auto-approve flag
  }
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env.COMSPEC || 'cmd.exe', args: [] }
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] }
}

/** Resolve what to spawn for the selected CLI. */
function resolveTarget(opts: SpawnOptions): { file: string; args: string[] } {
  if (opts.mode === 'shell') return defaultShell()
  const cfg = loadConfig()
  const install = cfg.install[opts.cliId]
  if (!install.installed || !install.binPath) {
    throw new Error(`${opts.cliId} 尚未安装`)
  }
  const resume = opts.resumeId ? resumeArgs(opts.cliId, opts.resumeId) : null
  const yolo = getPrefs(opts.cliId).yolo ? (yoloArgs(opts.cliId) ?? []) : []
  // Node-based CLIs (Gemini, Pi) run through the bundled node via their JS entry.
  if (install.nodeEntry) {
    const extra: string[] = [...(resume ?? []), ...yolo]
    if (opts.cliId === 'pi') {
      const model = getActiveProfile('pi')?.model
      if (model) extra.push('--model', `agentlauncher/${model}`)
    }
    return { file: install.binPath, args: [install.nodeEntry, ...extra] }
  }
  return { file: install.binPath, args: [...(resume ?? []), ...yolo] }
}

export function createSession(wc: WebContents, opts: SpawnOptions): string {
  const cwd = opts.cwd && opts.cwd.length ? opts.cwd : homedir()
  const { file, args } = resolveTarget(opts)
  const env = buildCliEnv(opts.cliId)

  // Ensure the isolated config dir exists before the CLI tries to write it.
  mkdirSync(paths.cliConfig(opts.cliId), { recursive: true })
  // CLIs configured by files (Codex/opencode/pi) — materialize them first.
  if (hasNativeConfig(opts.cliId)) writeNativeConfig(opts.cliId)

  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd,
    env: env as { [key: string]: string }
  })

  const id = `pty-${++seq}`
  sessions.set(id, { proc, cliId: opts.cliId })

  proc.onData((data) => {
    if (!wc.isDestroyed()) wc.send('pty:data', id, data)
  })
  proc.onExit(({ exitCode }) => {
    sessions.delete(id)
    if (!wc.isDestroyed()) wc.send('pty:exit', id, exitCode)
  })

  return id
}

export function writeSession(id: string, data: string): void {
  sessions.get(id)?.proc.write(data)
}

export function resizeSession(id: string, cols: number, rows: number): void {
  try {
    sessions.get(id)?.proc.resize(Math.max(1, cols), Math.max(1, rows))
  } catch {
    /* resize can race with exit */
  }
}

export function killSession(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  try {
    s.proc.kill()
  } catch {
    /* already dead */
  }
  sessions.delete(id)
}

export function killAll(): void {
  for (const id of [...sessions.keys()]) killSession(id)
}
