import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadConfig } from '../store'
import { isNodeInstalled } from './node-runtime'
import { detectPlatform } from './platform'
import type { DetectItem, DetectResult } from '@shared/types'

/** Resolve a command on PATH without throwing. */
function which(cmd: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    const p = spawn(finder, [cmd], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => resolve(null))
    p.on('close', (code) => resolve(code === 0 ? out.trim().split('\n')[0] : null))
  })
}

export async function detectEnvironment(): Promise<DetectResult> {
  const platform = detectPlatform()
  const cfg = loadConfig()

  const pkgManager =
    platform.os === 'darwin' ? 'brew' : platform.os === 'win32' ? 'winget' : 'apt'
  const [pkg, git] = await Promise.all([which(pkgManager), which('git')])

  const items: DetectItem[] = [
    {
      key: 'os',
      label: '操作系统',
      present: true,
      detail: `${platform.os} · ${platform.arch}`
    },
    {
      key: 'pkg',
      label: `包管理器（${pkgManager}）`,
      present: !!pkg,
      detail: pkg ?? '可选，route B 不强依赖'
    },
    {
      key: 'git',
      label: 'git',
      present: !!git,
      detail: git ?? '未检测到（部分 CLI 功能需要）'
    },
    {
      key: 'node',
      label: '便携 Node 运行时（仅 Gemini 需要）',
      present: isNodeInstalled(),
      detail: isNodeInstalled() ? '沙盒内已就绪' : '将在安装 Gemini 时自动获取'
    },
    {
      key: 'claude-code',
      label: 'Claude Code',
      present: cfg.install['claude-code'].installed && !!cfg.install['claude-code'].binPath,
      detail: cfg.install['claude-code'].version
        ? `已装 ${cfg.install['claude-code'].version}`
        : '未安装'
    },
    {
      key: 'codex',
      label: 'Codex CLI',
      present: cfg.install.codex.installed,
      detail: cfg.install.codex.version ? `已装 ${cfg.install.codex.version}` : '未安装'
    },
    {
      key: 'gemini',
      label: 'Gemini CLI',
      present: cfg.install.gemini.installed,
      detail: cfg.install.gemini.version ? `已装 ${cfg.install.gemini.version}` : '未安装'
    }
  ]

  // Reflect the real on-disk binary for installed CLIs (config could be stale).
  for (const it of items) {
    if (['claude-code', 'codex'].includes(it.key)) {
      const bin = cfg.install[it.key as 'claude-code' | 'codex'].binPath
      if (it.present && bin && !existsSync(bin)) {
        it.present = false
        it.detail = '记录存在但二进制丢失'
      }
    }
  }

  return { platform, items }
}
