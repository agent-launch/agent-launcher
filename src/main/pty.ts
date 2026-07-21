import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import * as pty from '@lydell/node-pty'
import type { WebContents } from 'electron'
import { windowsShellTarget } from './process'
import { paths } from './sandbox'
import { loadConfig, getActiveProfile, getPrefs } from './store'
import { buildCliEnv } from './cli-env'
import { assertCliLaunchAllowed } from './cli-launch-safety'
import { embeddedTerminalArgs } from './embedded-terminal'
import { CodexInterruptGuard } from './pty-compat'
import { resolveLaunchCwd } from './launch-cwd'
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
  interrupt?: CodexInterruptGuard
  normalizeExit?: boolean
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
    case 'opencode':
      // Approves permission requests unless explicitly denied; supported by
      // both the interactive TUI and `opencode run` (added in 2026 releases —
      // older system-linked installs may reject the flag).
      return ['--auto']
    case 'hermes':
      return ['--yolo']
    default:
      return null // pi never asks for approval; tools always run
  }
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env.COMSPEC || 'cmd.exe', args: [] }
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] }
}

/** Resolve what to spawn for the selected CLI. */
function resolveTarget(opts: SpawnOptions, embedded = false): { file: string; args: string[] } {
  if (opts.mode === 'shell') return defaultShell()
  const cfg = loadConfig()
  const install = cfg.install[opts.cliId]
  if (!install.installed || !install.binPath) {
    throw new Error(`${opts.cliId} is not installed`)
  }
  assertCliLaunchAllowed(opts.cliId, install)
  const resume = opts.resumeId ? resumeArgs(opts.cliId, opts.resumeId) : null
  const autoApprove = getPrefs(opts.cliId).yolo === true
  const yolo = autoApprove ? (yoloArgs(opts.cliId) ?? []) : []
  const embeddedArgs = embedded
    ? embeddedTerminalArgs({
        cliId: opts.cliId,
        version: install.version,
        autoApprove,
        resume: Boolean(opts.resumeId)
      })
    : []
  // Legacy managed Pi installs run through bundled Node + their JS entry. A
  // current system Pi install is already an executable wrapper.
  if (install.nodeEntry && install.source !== 'system') {
    const extra: string[] = [...embeddedArgs, ...(resume ?? []), ...yolo]
    if (opts.cliId === 'pi') {
      const profile = getActiveProfile('pi')
      if (profile?.baseUrl && profile.model) extra.push('--model', `agentlauncher/${profile.model}`)
    }
    return { file: install.binPath, args: [install.nodeEntry, ...extra] }
  }
  const session = opts.cliId === 'claude-code' && !opts.resumeId ? ['--session-id', randomUUID()] : []
  const extra: string[] = [...embeddedArgs, ...(resume ?? []), ...session, ...yolo]
  if (opts.cliId === 'pi') {
    const profile = getActiveProfile('pi')
    if (profile?.baseUrl && profile.model) extra.push('--model', `agentlauncher/${profile.model}`)
  }
  return { file: install.binPath, args: extra }
}

function quoteSh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function quotePs(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function launchEnvEntries(env: NodeJS.ProcessEnv): Array<[string, string]> {
  return Object.entries(env).filter(
    (entry): entry is [string, string] => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0]) && typeof entry[1] === 'string'
  )
}

function prepareCliLaunch(
  opts: SpawnOptions,
  embedded = false
): { cwd: string; file: string; args: string[]; env: NodeJS.ProcessEnv } {
  const cwd = resolveLaunchCwd(opts.cwd)
  const target = resolveTarget({ ...opts, mode: 'cli' }, embedded)

  if (hasNativeConfig(opts.cliId) && opts.cliId !== 'claude-code') {
    writeNativeConfig(opts.cliId)
  }

  return { cwd, file: target.file, args: target.args, env: buildCliEnv(opts.cliId) }
}

function embeddedTerminalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    CLICOLOR: '1'
  }
}

export function openExternalAgent(opts: SpawnOptions): void {
  const { cwd, file, args, env } = prepareCliLaunch(opts)
  const dir = join(paths.root, 'launchers')
  mkdirSync(dir, { recursive: true })

  if (process.platform === 'win32') {
    const script = join(dir, `agent-${opts.cliId}-${Date.now()}.ps1`)
    const envLines = launchEnvEntries(env)
      .map(([key, value]) => `$env:${key} = ${quotePs(value as string)}`)
      .join('\r\n')
    const argv = [file, ...args].map(quotePs).join(', ')
    writeFileSync(
      script,
      [
        '$ErrorActionPreference = "Stop"',
        envLines,
        `Set-Location ${quotePs(cwd)}`,
        `$argv = @(${argv})`,
        '& $argv[0] @($argv[1..($argv.Length - 1)])',
        'Read-Host "Press Enter to close"'
      ].join('\r\n')
    )
    spawn('cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', script], {
      detached: true,
      stdio: 'ignore'
    }).unref()
    return
  }

  const script = join(dir, `agent-${opts.cliId}-${Date.now()}.command`)
  const envLines = launchEnvEntries(env)
    .map(([key, value]) => `export ${key}=${quoteSh(value as string)}`)
    .join('\n')
  writeFileSync(
    script,
    [
      '#!/bin/sh',
      'set -e',
      envLines,
      `cd ${quoteSh(cwd)}`,
      `exec ${[file, ...args].map(quoteSh).join(' ')}`
    ].join('\n'),
    { mode: 0o700 }
  )

  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Terminal', script], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn('sh', ['-lc', `x-terminal-emulator -e ${quoteSh(script)} || gnome-terminal -- ${quoteSh(script)} || konsole -e ${quoteSh(script)} || xterm -e ${quoteSh(script)}`], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  }
}

export function createSession(wc: WebContents, opts: SpawnOptions): string {
  const prepared =
    opts.mode === 'shell'
      ? { cwd: resolveLaunchCwd(opts.cwd), ...resolveTarget(opts), env: buildCliEnv(opts.cliId) }
      : prepareCliLaunch(opts, true)

  const target = windowsShellTarget(prepared.file, prepared.args)
  const proc = pty.spawn(target.file, target.args, {
    name: 'xterm-256color',
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd: prepared.cwd,
    env: embeddedTerminalEnv(prepared.env) as { [key: string]: string }
  })

  const id = `pty-${++seq}`
  const session: Session = { proc, cliId: opts.cliId }
  sessions.set(id, session)

  proc.onData((data) => {
    session.interrupt?.observe(data)
    if (!wc.isDestroyed()) wc.send('pty:data', id, data)
  })
  proc.onExit(({ exitCode }) => {
    const interrupted = session.interrupt?.pending === true || session.normalizeExit === true
    clearCodexInterrupt(session)
    sessions.delete(id)
    if (!wc.isDestroyed()) wc.send('pty:exit', id, interrupted ? 0 : exitCode)
  })

  return id
}

export function writeSession(id: string, data: string): void {
  const session = sessions.get(id)
  if (!session) return
  if (isWindowsCodex(session) && data.includes('\x03')) armCodexInterrupt(id, session)
  session.proc.write(data)
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
  clearCodexInterrupt(s)
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

function isWindowsCodex(session: Session): boolean {
  return process.platform === 'win32' && session.cliId === 'codex'
}

function clearCodexInterrupt(session: Session): void {
  session.interrupt?.clear()
}

function forceCodexInterruptExit(id: string, session: Session): void {
  if (sessions.get(id) !== session) return
  session.normalizeExit = true
  clearCodexInterrupt(session)
  try {
    session.proc.kill()
  } catch {
    /* already dead */
  }
}

function armCodexInterrupt(id: string, session: Session): void {
  session.interrupt ??= new CodexInterruptGuard({
    onForceExit: () => forceCodexInterruptExit(id, session)
  })
  session.interrupt.arm()
}
