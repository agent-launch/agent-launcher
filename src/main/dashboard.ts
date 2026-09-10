import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { get } from 'node:http'
import { shell } from 'electron'
import { loadConfig } from './store'
import { buildCliEnv } from './cli-env'
import type { CliId, DashboardLaunchResult } from '@shared/types'

const HERMES_DASHBOARD_URL = 'http://127.0.0.1:9119'
const DASHBOARD_READY_TIMEOUT_MS = 30_000
const DASHBOARD_EARLY_EXIT_GRACE_MS = 3_000
const DASHBOARD_PROBE_TIMEOUT_MS = 1_500
const DASHBOARD_POLL_INTERVAL_MS = 500
const OPEN_URL_TIMEOUT_MS = 2_500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function platformOpenCommand(url: string): { command: string; args: string[] } {
  if (process.platform === 'darwin') return { command: '/usr/bin/open', args: [url] }
  if (process.platform === 'win32')
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '""', url] }
  return { command: 'xdg-open', args: [url] }
}

async function runOpenCommand(url: string): Promise<string | null> {
  const { command, args } = platformOpenCommand(url)
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => {
      child.unref()
      done(null)
    }, OPEN_URL_TIMEOUT_MS)
    const done = (error: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(error)
    }
    child.once('error', (error) => done(`${command}: ${error.message}`))
    child.once('exit', (code, signal) => {
      if (code === 0) {
        done(null)
      } else {
        done(`${command}: ${code !== null ? `exit code ${code}` : `signal ${signal ?? 'unknown'}`}`)
      }
    })
  })
}

async function isDashboardReady(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    const req = get(HERMES_DASHBOARD_URL, { timeout: DASHBOARD_PROBE_TIMEOUT_MS }, (res) => {
      res.resume()
      done(true)
    })
    req.on('timeout', () => {
      req.destroy()
      done(false)
    })
    req.on('error', () => done(false))
  })
}

async function openDashboardUrl(cliId: CliId): Promise<DashboardLaunchResult> {
  try {
    await shell.openExternal(HERMES_DASHBOARD_URL)
    return { ok: true, cliId, url: HERMES_DASHBOARD_URL }
  } catch (electronError) {
    const systemOpenError = await runOpenCommand(HERMES_DASHBOARD_URL)
    if (systemOpenError) {
      const electronOpenError =
        electronError instanceof Error ? electronError.message : String(electronError)
      return {
        ok: false,
        cliId,
        error: `Hermes Dashboard started, but the browser could not be opened. Electron: ${electronOpenError}; system opener: ${systemOpenError}. Open ${HERMES_DASHBOARD_URL} manually.`
      }
    }
    return { ok: true, cliId, url: HERMES_DASHBOARD_URL }
  }
}

let pendingLaunch: Promise<DashboardLaunchResult> | null = null

export function launchDashboard(cliId: CliId): Promise<DashboardLaunchResult> {
  if (cliId !== 'hermes') {
    return Promise.resolve({
      ok: false,
      cliId,
      error: 'Dashboard is only available for Hermes Agent'
    })
  }
  if (!pendingLaunch)
    pendingLaunch = launchHermesDashboard(cliId).finally(() => (pendingLaunch = null))
  return pendingLaunch
}

async function launchHermesDashboard(cliId: CliId): Promise<DashboardLaunchResult> {
  const install = loadConfig().install.hermes
  if (!install.installed || !install.binPath) {
    return { ok: false, cliId, error: 'Hermes is not installed' }
  }
  if (!existsSync(install.binPath)) {
    return { ok: false, cliId, error: `Hermes command does not exist: ${install.binPath}` }
  }

  try {
    if (await isDashboardReady()) return await openDashboardUrl(cliId)

    let spawnError: string | null = null
    let earlyExitAt = 0
    let earlyExitMessage: string | null = null
    const child = spawn(install.binPath, ['dashboard', '--no-open'], {
      detached: true,
      stdio: 'ignore',
      env: buildCliEnv('hermes')
    })
    child.once('error', (error) => {
      spawnError = error.message
    })
    child.once('exit', (code, signal) => {
      earlyExitAt = Date.now()
      earlyExitMessage = code !== null ? `exit code ${code}` : `signal ${signal ?? 'unknown'}`
    })
    child.unref()

    const deadline = Date.now() + DASHBOARD_READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await isDashboardReady()) return await openDashboardUrl(cliId)
      if (spawnError) {
        return { ok: false, cliId, error: `Hermes Dashboard failed to start: ${spawnError}` }
      }
      if (earlyExitMessage && Date.now() - earlyExitAt > DASHBOARD_EARLY_EXIT_GRACE_MS) {
        return {
          ok: false,
          cliId,
          error: `Hermes Dashboard exited after startup (${earlyExitMessage})`
        }
      }
      await sleep(Math.min(DASHBOARD_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())))
    }

    return {
      ok: false,
      cliId,
      error:
        'Hermes Dashboard startup timed out. Try again later or inspect the hermes dashboard output in a terminal.'
    }
  } catch (error) {
    return { ok: false, cliId, error: error instanceof Error ? error.message : String(error) }
  }
}
