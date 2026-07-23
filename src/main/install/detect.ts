import { spawn } from 'node:child_process'
import { loadConfig, setInstallState } from '../store'
import { detectPlatform } from './platform'
import type { DetectItem, DetectResult } from '@shared/types'
import { detectSystemCli } from './installer'

const CLI_IDS = ['claude-code', 'codex', 'opencode', 'pi', 'hermes'] as const

function detectWslCodex(): Promise<string | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const p = spawn('wsl.exe', ['--exec', 'sh', '-lc', 'command -v codex'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    const timer = setTimeout(() => {
      p.kill()
      resolve(undefined)
    }, 2500)
    p.stdout.on('data', (data) => (out += data))
    p.on('error', () => {
      clearTimeout(timer)
      resolve(undefined)
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      const path = out.trim().split(/\r?\n/)[0]
      resolve(code === 0 && path ? path : undefined)
    })
  })
}

function displayDetectionDetail(d: Awaited<ReturnType<typeof detectSystemCli>>): string {
  if (d.macosSecurityRisk) {
    const message =
      d.cliId === 'codex'
        ? 'Manual update required: uninstall Codex and install version 0.135.0 or later'
        : 'Manual update required: uninstall this CLI and install a current version'
    return d.selectedPath
      ? `${message} · ${d.selectedPath}`
      : message
  }
  if (d.status === 'linked' && d.selectedPath) return d.selectedPath
  return d.detail
}

export async function detectEnvironment(): Promise<DetectResult> {
  const platform = detectPlatform()
  const cfg = loadConfig()
  const [detections, wslCodexPath] = await Promise.all([
    Promise.all(
      CLI_IDS.map((id) =>
        detectSystemCli(id, cfg.install[id].source === 'system' ? cfg.install[id].binPath : undefined)
      )
    ),
    detectWslCodex()
  ])
  const codexDetection = detections.find((detection) => detection.cliId === 'codex')
  if (codexDetection && wslCodexPath) {
    codexDetection.wslPath = wslCodexPath
    if (!codexDetection.installed) {
      codexDetection.detail = `Codex was detected inside WSL at ${wslCodexPath}; install a native Windows version to use it here`
    }
  }
  const systemClis = Object.fromEntries(detections.map((d) => [d.cliId, d])) as DetectResult['systemClis']
  for (const detection of detections) {
    const install = cfg.install[detection.cliId]
    if (install.source !== 'system') continue
    const launchBlockedReason = detection.macosSecurityRisk ? 'macos-security' : undefined
    if (install.launchBlockedReason !== launchBlockedReason) {
      setInstallState(detection.cliId, { ...install, launchBlockedReason })
    }
  }
  const items: DetectItem[] = [
    {
      key: 'os',
      label: 'Operating system',
      present: true,
      detail: `${platform.os} · ${platform.arch}`
    }
  ]

  for (const d of detections) {
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
      present: d.installed,
      detail: d.installed ? displayDetectionDetail(d) : d.detail
    })
  }

  return { platform, items, systemClis }
}
