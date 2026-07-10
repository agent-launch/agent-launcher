import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadConfig } from '../store'
import { detectPlatform } from './platform'
import type { DetectItem, DetectResult } from '@shared/types'
import { detectSystemCli } from './installer'

const CLI_IDS = ['claude-code', 'codex', 'opencode', 'pi', 'hermes'] as const

function which(cmd: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    const p = spawn(finder, [cmd], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => resolve(null))
    p.on('close', (code) => resolve(code === 0 ? out.trim().split(/\r?\n/)[0] || null : null))
  })
}

function displayDetectionDetail(d: Awaited<ReturnType<typeof detectSystemCli>>): string {
  if (d.status === 'linked' && d.selectedPath) return d.selectedPath
  return d.detail
}

export async function detectEnvironment(): Promise<DetectResult> {
  const platform = detectPlatform()
  const cfg = loadConfig()
  const detections = await Promise.all(
    CLI_IDS.map((id) => detectSystemCli(id, cfg.install[id].source === 'system' ? cfg.install[id].binPath : undefined))
  )
  const systemClis = Object.fromEntries(detections.map((d) => [d.cliId, d])) as DetectResult['systemClis']
  const pkgManager = platform.os === 'darwin' ? 'brew' : 'npm'
  const [pkg, npm] = await Promise.all([which(pkgManager), which('npm')])

  const items: DetectItem[] = [
    {
      key: 'os',
      label: 'Operating system',
      present: true,
      detail: `${platform.os} · ${platform.arch}`
    },
    {
      key: 'installer',
      label: 'System install support',
      present: !!pkg || !!npm,
      detail:
        platform.os === 'darwin'
          ? pkg
            ? `Homebrew · ${pkg}`
            : npm
              ? `npm · ${npm}`
              : 'Homebrew and npm were not detected'
          : npm
            ? `npm · ${npm}`
            : 'npm was not detected'
    },
    {
      key: 'npm',
      label: 'npm',
      present: !!npm,
      detail: npm ?? 'npm was not detected; some CLIs may require a manual Node/npm installation'
    }
  ]

  for (const d of detections) {
    const configured = cfg.install[d.cliId]
    const sandboxInstalled =
      configured.installed && configured.source === 'sandbox' && !!configured.binPath && existsSync(configured.binPath)
    items.push({
      key: d.cliId,
      label:
        d.cliId === 'claude-code'
          ? 'Claude Code'
          : d.cliId === 'codex'
            ? 'Codex CLI'
            : d.cliId === 'opencode'
              ? 'OpenCode'
              : d.cliId === 'pi'
                ? 'Pi'
                : 'Hermes Agent',
      present: d.installed || sandboxInstalled,
      detail: d.installed ? displayDetectionDetail(d) : sandboxInstalled ? 'Installed in the Agent Launcher sandbox' : d.detail
    })
  }

  return { platform, items, systemClis }
}
