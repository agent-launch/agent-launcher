import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { paths } from './sandbox'
import type {
  AppConfig,
  CliId,
  CliInstallState,
  CliPrefs,
  CliProfile,
  CliProfilePatch,
  CliProfiles
} from '@shared/types'

const SCHEMA = 2
const CLI_IDS: CliId[] = ['claude-code', 'codex', 'opencode', 'pi']

function emptyConfig(): AppConfig {
  const install = {} as Record<CliId, CliInstallState>
  const clis = {} as Record<CliId, CliProfiles>
  const prefs = {} as Record<CliId, CliPrefs>
  for (const id of CLI_IDS) {
    install[id] = { installed: false }
    clis[id] = { profiles: [] }
    prefs[id] = {}
  }
  return { schema: SCHEMA, install, clis, prefs }
}

let counter = 0
function newId(): string {
  counter += 1
  return `p${Date.now().toString(36)}${counter}`
}

/** Coerce any on-disk shape (incl. legacy single-config) into the current model. */
function normalize(raw: unknown): AppConfig {
  const base = emptyConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<AppConfig> & { clis?: Record<string, unknown> }

  const rp = (raw as { prefs?: Record<string, CliPrefs> }).prefs
  for (const id of CLI_IDS) {
    if (r.install?.[id]) base.install[id] = { ...base.install[id], ...r.install[id] }
    if (rp?.[id]) base.prefs[id] = { ...base.prefs[id], ...rp[id] }

    const entry = r.clis?.[id] as unknown
    if (!entry || typeof entry !== 'object') continue

    if (Array.isArray((entry as CliProfiles).profiles)) {
      base.clis[id] = entry as CliProfiles
    } else {
      // Legacy schema 1: a single {providerId,baseUrl,apiKey,model} object.
      const legacy = entry as CliProfilePatch
      if (legacy.baseUrl || legacy.apiKey || legacy.providerId || legacy.model) {
        const p: CliProfile = { id: newId(), name: legacy.providerId ?? '默认配置', ...legacy }
        base.clis[id] = { activeProfileId: p.id, profiles: [p] }
      }
    }
  }
  return base
}

let cache: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (cache) return cache
  try {
    if (existsSync(paths.config)) {
      cache = normalize(JSON.parse(readFileSync(paths.config, 'utf8')))
      return cache
    }
  } catch {
    /* corrupt — fall back to defaults */
  }
  cache = emptyConfig()
  return cache
}

export function saveConfig(cfg: AppConfig): AppConfig {
  cache = cfg
  mkdirSync(dirname(paths.config), { recursive: true })
  // Plaintext on purpose — product decision is local JSON, no keychain.
  writeFileSync(paths.config, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  return cfg
}

export function setInstallState(id: CliId, state: CliInstallState): AppConfig {
  const cfg = loadConfig()
  cfg.install[id] = state
  return saveConfig(cfg)
}

// ---- profile CRUD ----

export function addProfile(id: CliId, patch: CliProfilePatch): AppConfig {
  const cfg = loadConfig()
  const profile: CliProfile = { id: newId(), name: patch.name || '未命名', ...patch }
  cfg.clis[id].profiles.push(profile)
  // First profile becomes active automatically.
  if (!cfg.clis[id].activeProfileId) cfg.clis[id].activeProfileId = profile.id
  return saveConfig(cfg)
}

export function updateProfile(id: CliId, profileId: string, patch: CliProfilePatch): AppConfig {
  const cfg = loadConfig()
  const p = cfg.clis[id].profiles.find((x) => x.id === profileId)
  if (p) Object.assign(p, patch)
  return saveConfig(cfg)
}

export function deleteProfile(id: CliId, profileId: string): AppConfig {
  const cfg = loadConfig()
  const c = cfg.clis[id]
  c.profiles = c.profiles.filter((x) => x.id !== profileId)
  if (c.activeProfileId === profileId) c.activeProfileId = c.profiles[0]?.id
  return saveConfig(cfg)
}

export function setActiveProfile(id: CliId, profileId: string): AppConfig {
  const cfg = loadConfig()
  if (cfg.clis[id].profiles.some((x) => x.id === profileId)) {
    cfg.clis[id].activeProfileId = profileId
  }
  return saveConfig(cfg)
}

export function getActiveProfile(id: CliId): CliProfile | undefined {
  const c = loadConfig().clis[id]
  return c.profiles.find((x) => x.id === c.activeProfileId)
}

export function setYolo(id: CliId, yolo: boolean): AppConfig {
  const cfg = loadConfig()
  cfg.prefs[id] = { ...cfg.prefs[id], yolo }
  return saveConfig(cfg)
}

export function getPrefs(id: CliId): CliPrefs {
  return loadConfig().prefs[id] ?? {}
}
