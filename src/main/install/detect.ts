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
      label: '操作系统',
      present: true,
      detail: `${platform.os} · ${platform.arch}`
    },
    {
      key: 'installer',
      label: '系统安装能力',
      present: !!pkg || !!npm,
      detail:
        platform.os === 'darwin'
          ? pkg
            ? `Homebrew · ${pkg}`
            : npm
              ? `npm · ${npm}`
              : '未检测到 Homebrew 或 npm'
          : npm
            ? `npm · ${npm}`
            : '未检测到 npm'
    },
    {
      key: 'npm',
      label: 'npm',
      present: !!npm,
      detail: npm ?? '未检测到 npm，部分 CLI 可能需要手动安装 Node/npm'
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
      detail: d.installed ? d.detail : sandboxInstalled ? '已安装，可切换为系统版本' : d.detail
    })
  }

  return { platform, items, systemClis }
}
