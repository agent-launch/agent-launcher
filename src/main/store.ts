import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { paths } from './sandbox'
import type {
  AppConfig,
  AuthMode,
  CliId,
  CliInstallState,
  InstallSource,
  CliPrefs,
  CliProfile,
  CliProfilePatch,
  CliProfiles
} from '@shared/types'

const SCHEMA = 3
const CLI_IDS: CliId[] = ['claude-code', 'codex', 'opencode', 'pi']
const OFFICIAL_AUTH_CLIS = new Set<CliId>(['claude-code', 'codex'])
const OFFICIAL_PROFILE_ID = 'official'

function defaultAuthMode(id: CliId): AuthMode {
  return OFFICIAL_AUTH_CLIS.has(id) ? 'official' : 'api'
}

function officialProfileName(id: CliId): string {
  return id === 'codex' ? 'OpenAI 官方' : 'Claude 官方'
}

function createOfficialProfile(id: CliId): CliProfile {
  return { id: OFFICIAL_PROFILE_ID, name: officialProfileName(id), providerId: 'official', baseUrl: '' }
}

function hasApiConfig(profile: Pick<CliProfile, 'baseUrl' | 'apiKey'>): boolean {
  return Boolean(profile.baseUrl?.trim() || profile.apiKey?.trim())
}

function isOfficialProfile(profile: CliProfile): boolean {
  return profile.providerId === 'official' && !hasApiConfig(profile)
}

function authModeForProfile(id: CliId, profile?: CliProfile): AuthMode {
  if (!OFFICIAL_AUTH_CLIS.has(id)) return 'api'
  if (!profile) return 'official'
  if (isOfficialProfile(profile)) return 'official'
  return hasApiConfig(profile) || profile.providerId ? 'api' : 'official'
}

function ensureOfficialProfile(id: CliId, cli: CliProfiles): CliProfile | undefined {
  if (!OFFICIAL_AUTH_CLIS.has(id)) return undefined
  const existing = cli.profiles.find(isOfficialProfile)
  if (existing) {
    if (!existing.name) existing.name = officialProfileName(id)
    return existing
  }
  const profile = createOfficialProfile(id)
  cli.profiles.unshift(profile)
  return profile
}

function existingOfficialProfile(id: CliId, cli: CliProfiles): CliProfile | undefined {
  if (!OFFICIAL_AUTH_CLIS.has(id)) return undefined
  const existing = cli.profiles.find(isOfficialProfile)
  if (existing && !existing.name) existing.name = officialProfileName(id)
  return existing
}

function activeProfile(cli: CliProfiles): CliProfile | undefined {
  return cli.profiles.find((x) => x.id === cli.activeProfileId)
}

function syncProfileState(id: CliId, cli: CliProfiles): void {
  const official = existingOfficialProfile(id, cli)
  const requestedMode = cli.authMode ?? defaultAuthMode(id)
  if (!activeProfile(cli)) {
    const fallback =
      requestedMode === 'official' ? official : cli.profiles.find((p) => authModeForProfile(id, p) === 'api')
    cli.activeProfileId = fallback?.id ?? cli.profiles[0]?.id
  }
  cli.authMode = activeProfile(cli) ? authModeForProfile(id, activeProfile(cli)) : requestedMode
}

function dropUnpinnedOfficialProfile(cli: CliProfiles, prefs: CliPrefs | undefined): void {
  if (prefs?.officialProfilePinned) return
  cli.profiles = cli.profiles.filter((profile) => !isOfficialProfile(profile))
  if (cli.activeProfileId && !cli.profiles.some((profile) => profile.id === cli.activeProfileId)) {
    cli.activeProfileId = undefined
  }
}

function inferInstallSource(state: CliInstallState): InstallSource {
  if (state.source) return state.source
  if (!state.installed) return 'system'
  const root = resolve(paths.root)
  const binPath = state.binPath ? resolve(state.binPath) : ''
  const nodeEntry = state.nodeEntry ? resolve(state.nodeEntry) : ''
  return binPath.startsWith(root) || nodeEntry.startsWith(root) ? 'sandbox' : 'system'
}

function emptyConfig(): AppConfig {
  const install = {} as Record<CliId, CliInstallState>
  const clis = {} as Record<CliId, CliProfiles>
  const prefs = {} as Record<CliId, CliPrefs>
  for (const id of CLI_IDS) {
    install[id] = { installed: false }
    clis[id] = { profiles: [], authMode: defaultAuthMode(id) }
    syncProfileState(id, clis[id])
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
    if (r.install?.[id]) {
      base.install[id] = { ...base.install[id], ...r.install[id] }
      base.install[id].source = inferInstallSource(base.install[id])
    }
    if (rp?.[id]) base.prefs[id] = { ...base.prefs[id], ...rp[id] }

    const entry = r.clis?.[id] as unknown
    if (!entry || typeof entry !== 'object') continue

    if (Array.isArray((entry as CliProfiles).profiles)) {
      base.clis[id] = { ...base.clis[id], ...(entry as CliProfiles) }
    } else {
      // Legacy schema 1: a single {providerId,baseUrl,apiKey,model} object.
      const legacy = entry as CliProfilePatch
      if (legacy.baseUrl || legacy.apiKey || legacy.providerId || legacy.model) {
        const p: CliProfile = { id: newId(), name: legacy.providerId ?? '默认配置', ...legacy }
        base.clis[id] = { activeProfileId: p.id, profiles: [p], authMode: 'api' }
      }
    }
    dropUnpinnedOfficialProfile(base.clis[id], base.prefs[id])
    syncProfileState(id, base.clis[id])
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

export function getInstallSource(id: CliId): InstallSource {
  return loadConfig().install[id].source ?? 'system'
}

// ---- profile CRUD ----

export function addProfile(id: CliId, patch: CliProfilePatch): AppConfig {
  const cfg = loadConfig()
  const cli = cfg.clis[id]
  if (patch.providerId === 'official' && !hasApiConfig(patch)) {
    cfg.prefs[id] = { ...cfg.prefs[id], officialProfilePinned: true }
    const profile = ensureOfficialProfile(id, cli)
    if (profile) {
      profile.name = patch.name || profile.name
      cli.activeProfileId = profile.id
      syncProfileState(id, cli)
      return saveConfig(cfg)
    }
  }
  const profile: CliProfile = { id: newId(), name: patch.name || '未命名', ...patch }
  cli.profiles.push(profile)
  if (!cli.activeProfileId || authModeForProfile(id, profile) === 'api') cli.activeProfileId = profile.id
  syncProfileState(id, cli)
  return saveConfig(cfg)
}

export function updateProfile(id: CliId, profileId: string, patch: CliProfilePatch): AppConfig {
  const cfg = loadConfig()
  const cli = cfg.clis[id]
  const p = cli.profiles.find((x) => x.id === profileId)
  if (p) {
    Object.assign(p, patch)
    syncProfileState(id, cli)
  }
  return saveConfig(cfg)
}

export function deleteProfile(id: CliId, profileId: string): AppConfig {
  const cfg = loadConfig()
  const c = cfg.clis[id]
  c.profiles = c.profiles.filter((x) => x.id !== profileId)
  if (c.activeProfileId === profileId) c.activeProfileId = undefined
  syncProfileState(id, c)
  return saveConfig(cfg)
}

export function setActiveProfile(id: CliId, profileId: string): AppConfig {
  const cfg = loadConfig()
  const profile = cfg.clis[id].profiles.find((x) => x.id === profileId)
  if (profile) {
    cfg.clis[id].activeProfileId = profileId
    syncProfileState(id, cfg.clis[id])
  }
  return saveConfig(cfg)
}

export function setAuthMode(id: CliId, authMode: AuthMode): AppConfig {
  const cfg = loadConfig()
  const cli = cfg.clis[id]
  if (authMode === 'official') {
    cfg.prefs[id] = { ...cfg.prefs[id], officialProfilePinned: true }
    const profile = ensureOfficialProfile(id, cli)
    cli.activeProfileId = profile?.id
  } else if (authMode === 'api' && authModeForProfile(id, activeProfile(cli)) === 'official') {
    cli.activeProfileId = cli.profiles.find((p) => authModeForProfile(id, p) === 'api')?.id
  }
  cli.authMode = authMode
  syncProfileState(id, cli)
  return saveConfig(cfg)
}

export function getAuthMode(id: CliId): AuthMode {
  const cli = loadConfig().clis[id]
  return activeProfile(cli) ? authModeForProfile(id, activeProfile(cli)) : (cli.authMode ?? defaultAuthMode(id))
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

export function markSystemConfigImportChecked(id: CliId): AppConfig {
  const cfg = loadConfig()
  cfg.prefs[id] = { ...cfg.prefs[id], systemConfigImportChecked: true }
  return saveConfig(cfg)
}
