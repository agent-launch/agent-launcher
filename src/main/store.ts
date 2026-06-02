import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { paths } from './sandbox'
import type { AppConfig, CliConfig, CliId, CliInstallState } from '@shared/types'

const SCHEMA = 1

function emptyConfig(): AppConfig {
  const blankInstall: CliInstallState = { installed: false }
  const blankCli: CliConfig = {}
  return {
    schema: SCHEMA,
    install: {
      'claude-code': { ...blankInstall },
      codex: { ...blankInstall },
      gemini: { ...blankInstall }
    },
    clis: {
      'claude-code': { ...blankCli },
      codex: { ...blankCli },
      gemini: { ...blankCli }
    }
  }
}

let cache: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (cache) return cache
  try {
    if (existsSync(paths.config)) {
      const parsed = JSON.parse(readFileSync(paths.config, 'utf8')) as AppConfig
      // Shallow-merge over defaults so new fields don't crash old configs.
      cache = { ...emptyConfig(), ...parsed }
      return cache
    }
  } catch {
    // Corrupt config — fall back to defaults rather than crash.
  }
  cache = emptyConfig()
  return cache
}

export function saveConfig(cfg: AppConfig): void {
  cache = cfg
  mkdirSync(dirname(paths.config), { recursive: true })
  // Plaintext on purpose — product decision is local JSON, no keychain.
  writeFileSync(paths.config, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

export function setInstallState(id: CliId, state: CliInstallState): AppConfig {
  const cfg = loadConfig()
  cfg.install[id] = state
  saveConfig(cfg)
  return cfg
}

export function setCliConfig(id: CliId, patch: Partial<CliConfig>): AppConfig {
  const cfg = loadConfig()
  cfg.clis[id] = { ...cfg.clis[id], ...patch }
  saveConfig(cfg)
  return cfg
}
