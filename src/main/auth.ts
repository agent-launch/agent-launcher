import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { WebContents } from 'electron'
import { buildCliEnv } from './cli-env'
import { detectSystemCli } from './install/installer'
import { hasNativeConfig, writeNativeConfig } from './native-config'
import { loadConfig, setAuthMode, setInstallState } from './store'
import type { AuthLoginMethod, AuthStatus, CliId } from '@shared/types'

interface AuthProc {
  proc: ChildProcess
  wc: WebContents
  cliId: CliId
}

const procs = new Map<string, AuthProc>()
let seq = 0

function authTarget(cliId: CliId, method: AuthLoginMethod): string[] | null {
  if (cliId === 'claude-code') return ['auth', 'login']
  if (cliId === 'codex') return method === 'device' ? ['login', '--device-auth'] : ['login']
  return null
}

function statusTarget(cliId: CliId): string[] | null {
  if (cliId === 'claude-code') return ['auth', 'status']
  if (cliId === 'codex') return ['login', 'status']
  return null
}

async function installedBin(cliId: CliId): Promise<string | undefined> {
  const install = loadConfig().install[cliId]
  if (install.installed && install.binPath && existsSync(install.binPath)) return install.binPath

  const detection = await detectSystemCli(cliId, install.source === 'system' ? install.binPath : undefined)
  const selected = detection.selectedPath
  if (!selected || !existsSync(selected)) return undefined

  const candidate = detection.candidates.find((c) => c.path === selected || c.realPath === selected)
  setInstallState(cliId, { installed: true, source: 'system', version: candidate?.version, binPath: selected })
  return selected
}

function send(wc: WebContents, id: string, cliId: CliId, data: string): void {
  if (!wc.isDestroyed()) wc.send('auth:data', id, cliId, data)
}

function isLoggedIn(code: number | null, text: string): boolean {
  if (/not logged in|not authenticated|not signed in|no .*login|no .*auth/i.test(text)) return false
  if (code === 0) return true
  return /logged in|authenticated|signed in/i.test(text) && !/not logged in|not authenticated/i.test(text)
}

async function runStatus(cliId: CliId, args: string[]): Promise<AuthStatus> {
  const bin = await installedBin(cliId)
  if (!bin) return Promise.resolve({ cliId, supported: !!statusTarget(cliId), installed: false, loggedIn: false })

  return new Promise((resolve) => {
    let output = ''
    const proc = spawn(bin, args, {
      cwd: homedir(),
      env: buildCliEnv(cliId) as NodeJS.ProcessEnv
    })
    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
    proc.stdout?.on('data', (d: string) => (output += d))
    proc.stderr?.on('data', (d: string) => (output += d))
    proc.on('error', (e) =>
      resolve({ cliId, supported: true, installed: true, loggedIn: false, error: e.message })
    )
    proc.on('exit', (code) => {
      const detail = output.trim().split('\n').slice(-3).join('\n')
      resolve({ cliId, supported: true, installed: true, loggedIn: isLoggedIn(code, output), detail })
    })
  })
}

export function authStatus(cliId: CliId): Promise<AuthStatus> {
  const args = statusTarget(cliId)
  if (!args) return Promise.resolve({ cliId, supported: false, installed: false, loggedIn: false })
  return runStatus(cliId, args)
}

export async function startAuthLogin(wc: WebContents, cliId: CliId, method: AuthLoginMethod): Promise<string> {
  const args = authTarget(cliId, method)
  if (!args) throw new Error(`${cliId} 不支持官方订阅登录`)
  const bin = await installedBin(cliId)
  if (!bin) throw new Error(`${cliId} 尚未安装`)

  setAuthMode(cliId, 'official')
  if (hasNativeConfig(cliId)) {
    writeNativeConfig(cliId)
  }

  const proc = spawn(bin, args, {
    cwd: homedir(),
    env: buildCliEnv(cliId) as NodeJS.ProcessEnv
  })
  const id = `auth-${++seq}`
  procs.set(id, { proc, wc, cliId })

  proc.stdout?.setEncoding('utf8')
  proc.stderr?.setEncoding('utf8')
  proc.stdout?.on('data', (d: string) => send(wc, id, cliId, d))
  proc.stderr?.on('data', (d: string) => send(wc, id, cliId, d))
  proc.on('error', (e) => {
    send(wc, id, cliId, `\n${e.message}\n`)
    procs.delete(id)
    if (!wc.isDestroyed()) wc.send('auth:exit', id, cliId, 1)
  })
  proc.on('exit', (code) => {
    procs.delete(id)
    if (!wc.isDestroyed()) wc.send('auth:exit', id, cliId, code ?? 0)
  })

  return id
}

export function writeAuth(id: string, data: string): void {
  procs.get(id)?.proc.stdin?.write(data)
}

export function stopAuth(id: string): void {
  const entry = procs.get(id)
  if (!entry) return
  entry.proc.kill()
  procs.delete(id)
  if (!entry.wc.isDestroyed()) {
    entry.wc.send('auth:data', id, entry.cliId, '\n[cancelled]\n')
    entry.wc.send('auth:exit', id, entry.cliId, 130)
  }
}

export function killAllAuth(): void {
  for (const id of [...procs.keys()]) stopAuth(id)
}
