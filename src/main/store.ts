import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { paths } from './sandbox'
import { ALL_CLI_IDS } from '@shared/types'
import type {
  AppConfig,
  AuthMode,
  CliId,
  CliInstallState,
  CliMcpPatch,
  CliPrefs,
  CliPricePatch,
  CliProfile,
  CliProfilePatch,
  CliProfiles,
  CliResources,
  CliSkillPatch,
  RecentProject
} from '@shared/types'

const SCHEMA = 5
const CLI_IDS: readonly CliId[] = ALL_CLI_IDS
// gemini-cli dropped free-tier Google-account sign-in on 2026-06-18 (Google
// pushed individuals to Antigravity CLI instead), so gemini can no longer
// default to — or offer — "official" OAuth here; API-key/relay is now the
// only auth path that actually works for it.
const OFFICIAL_AUTH_CLIS = new Set<CliId>(['claude-code', 'codex'])
const OPENAI_COMPATIBLE_CLIS = new Set<CliId>(['codex', 'opencode', 'pi', 'hermes'])
const OFFICIAL_PROFILE_ID = 'official'
const ROUTERLINK_OPENAI_BASE_URL = 'https://router-link.world3.ai/api/v1'
const LEGACY_ROUTERLINK_OPENAI_BASE_URL = 'https://router-link.world3.ai/api'

function defaultAuthMode(id: CliId): AuthMode {
  return OFFICIAL_AUTH_CLIS.has(id) ? 'official' : 'api'
}

function officialProfileName(id: CliId): string {
  if (id === 'codex') return 'OpenAI Official'
  return 'Claude Official'
}

function createOfficialProfile(id: CliId): CliProfile {
  return {
    id: OFFICIAL_PROFILE_ID,
    name: officialProfileName(id),
    providerId: 'official',
    baseUrl: ''
  }
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

function normalizeProfile(id: CliId, profile: CliProfile): void {
  const baseUrl = profile.baseUrl?.trim().replace(/\/+$/, '')
  if (
    OPENAI_COMPATIBLE_CLIS.has(id) &&
    profile.providerId === 'routerlink' &&
    baseUrl === LEGACY_ROUTERLINK_OPENAI_BASE_URL
  ) {
    profile.baseUrl = ROUTERLINK_OPENAI_BASE_URL
  }
}

function normalizeProfiles(id: CliId, cli: CliProfiles): void {
  for (const profile of cli.profiles) normalizeProfile(id, profile)
}

function syncProfileState(id: CliId, cli: CliProfiles): void {
  const official = existingOfficialProfile(id, cli)
  const requestedMode = cli.authMode ?? defaultAuthMode(id)
  if (!activeProfile(cli)) {
    const fallback =
      requestedMode === 'official'
        ? official
        : cli.profiles.find((p) => authModeForProfile(id, p) === 'api')
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

/** gemini-cli's OAuth support (OFFICIAL_AUTH_CLIS) was removed after Google
 * dropped free-tier sign-in (2026-06-18). A user who'd previously pinned a
 * "Google Official" profile would otherwise keep it active with an empty
 * baseUrl/apiKey and no matching provider card — unlike
 * dropUnpinnedOfficialProfile, this clears it unconditionally, pinned or not. */
function dropGeminiOfficialProfile(cli: CliProfiles, prefs: CliPrefs | undefined): void {
  if (prefs) delete prefs.officialProfilePinned
  cli.profiles = cli.profiles.filter((profile) => !isOfficialProfile(profile))
  if (cli.activeProfileId && !cli.profiles.some((profile) => profile.id === cli.activeProfileId)) {
    cli.activeProfileId = undefined
  }
  // A stale stored 'official' authMode would otherwise survive as
  // syncProfileState's requestedMode fallback once there's no active profile.
  if (cli.authMode === 'official') cli.authMode = 'api'
}

export function isLegacyManagedInstall(state: CliInstallState): boolean {
  if (!state.installed) return false
  const root = resolve(paths.root)
  const isInsideRoot = (value?: string): boolean => {
    if (!value) return false
    const rel = relative(root, resolve(value))
    return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
  }
  return isInsideRoot(state.binPath) || isInsideRoot(state.nodeEntry)
}

function emptyConfig(): AppConfig {
  const install = {} as Record<CliId, CliInstallState>
  const clis = {} as Record<CliId, CliProfiles>
  const prefs = {} as Record<CliId, CliPrefs>
  const resources = {} as Record<CliId, CliResources>
  for (const id of CLI_IDS) {
    install[id] = { installed: false }
    clis[id] = { profiles: [], authMode: defaultAuthMode(id) }
    syncProfileState(id, clis[id])
    prefs[id] = {}
    resources[id] = { prices: [], mcpServers: [], skills: [] }
  }
  return { schema: SCHEMA, install, clis, prefs, resources, recentProjects: [] }
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
  const rr = (raw as { resources?: Partial<Record<CliId, Partial<CliResources>>> }).resources
  for (const id of CLI_IDS) {
    if (r.install?.[id]) {
      base.install[id] = { ...base.install[id], ...r.install[id] }
      base.install[id].legacyManaged = isLegacyManagedInstall(base.install[id])
      base.install[id].source = 'system'
      // Security blocks are detection-session state. Older builds persisted a
      // version-based guess here, which could keep a working Codex disabled
      // after restart even though no explicit security failure was present.
      base.install[id].launchBlockedReason = undefined
    }
    if (rp?.[id]) base.prefs[id] = { ...base.prefs[id], ...rp[id] }
    if (rr?.[id]) {
      base.resources[id] = {
        prices: Array.isArray(rr[id]?.prices) ? rr[id].prices : [],
        mcpServers: Array.isArray(rr[id]?.mcpServers) ? rr[id].mcpServers : [],
        skills: Array.isArray(rr[id]?.skills) ? rr[id].skills : []
      }
    }

    const entry = r.clis?.[id] as unknown
    if (!entry || typeof entry !== 'object') continue

    if (Array.isArray((entry as CliProfiles).profiles)) {
      base.clis[id] = { ...base.clis[id], ...(entry as CliProfiles) }
    } else {
      // Legacy schema 1: a single {providerId,baseUrl,apiKey,model} object.
      const legacy = entry as CliProfilePatch
      if (legacy.baseUrl || legacy.apiKey || legacy.providerId || legacy.model) {
        const p: CliProfile = {
          id: newId(),
          name: legacy.providerId ?? 'Default config',
          ...legacy
        }
        base.clis[id] = { activeProfileId: p.id, profiles: [p], authMode: 'api' }
      }
    }
    normalizeProfiles(id, base.clis[id])
    if (id === 'gemini') dropGeminiOfficialProfile(base.clis[id], base.prefs[id])
    else dropUnpinnedOfficialProfile(base.clis[id], base.prefs[id])
    syncProfileState(id, base.clis[id])
  }
  const rawProjects = (raw as { recentProjects?: unknown }).recentProjects
  if (Array.isArray(rawProjects)) {
    base.recentProjects = rawProjects
      .filter(
        (p): p is RecentProject =>
          !!p &&
          typeof p === 'object' &&
          typeof (p as RecentProject).path === 'string' &&
          (p as RecentProject).path.trim() !== '' &&
          typeof (p as RecentProject).lastUsedAt === 'number'
      )
      .map((p) => ({ path: p.path, lastUsedAt: p.lastUsedAt }))
    sortRecentProjects(base.recentProjects)
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
  cfg.install[id] = {
    ...state,
    legacyManaged: isLegacyManagedInstall(state),
    source: 'system'
  }
  return saveConfig(cfg)
}

// ---- recent projects ----

/** Unpinned-list cap; oldest entries fall off. Kept generous — these are
 * one-line records, the limit only guards against unbounded growth. */
const MAX_RECENT_PROJECTS = 30

function sortRecentProjects(list: RecentProject[]): void {
  list.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

/** Strictly after every recorded use, so a bump always wins the (stable)
 * sort even when two land in the same millisecond. List is sorted desc,
 * so [0] holds the current max. */
function nextUseTimestamp(list: RecentProject[]): number {
  return Math.max(Date.now(), (list[0]?.lastUsedAt ?? 0) + 1)
}

/** Upsert a directory the user explicitly picked; bumps it to the top. */
export function addRecentProject(path: string): AppConfig {
  const cfg = loadConfig()
  const trimmed = path.trim()
  if (!trimmed) return cfg
  const now = nextUseTimestamp(cfg.recentProjects)
  const existing = cfg.recentProjects.find((p) => p.path === trimmed)
  if (existing) existing.lastUsedAt = now
  else cfg.recentProjects.push({ path: trimmed, lastUsedAt: now })
  sortRecentProjects(cfg.recentProjects)
  cfg.recentProjects = cfg.recentProjects.slice(0, MAX_RECENT_PROJECTS)
  return saveConfig(cfg)
}

/** Bump lastUsedAt only when the path is already a recorded project — a
 * launch into a scratch workspace or a history-only directory must not
 * create new entries. */
export function touchRecentProject(path: string | undefined): void {
  const trimmed = path?.trim()
  if (!trimmed) return
  const cfg = loadConfig()
  const existing = cfg.recentProjects.find((p) => p.path === trimmed)
  if (!existing) return
  existing.lastUsedAt = nextUseTimestamp(cfg.recentProjects)
  sortRecentProjects(cfg.recentProjects)
  saveConfig(cfg)
}

export function removeRecentProject(path: string): AppConfig {
  const cfg = loadConfig()
  cfg.recentProjects = cfg.recentProjects.filter((p) => p.path !== path)
  return saveConfig(cfg)
}

// ---- profile CRUD ----

export function addProfile(id: CliId, patch: CliProfilePatch): AppConfig {
  const cfg = loadConfig()
  const cli = cfg.clis[id]
  if (patch.providerId === 'official' && !hasApiConfig(patch) && OFFICIAL_AUTH_CLIS.has(id)) {
    cfg.prefs[id] = { ...cfg.prefs[id], officialProfilePinned: true }
    const profile = ensureOfficialProfile(id, cli)
    if (profile) {
      profile.name = patch.name || profile.name
      cli.activeProfileId = profile.id
      syncProfileState(id, cli)
      return saveConfig(cfg)
    }
  }
  const profile: CliProfile = { id: newId(), name: patch.name || 'Untitled', ...patch }
  normalizeProfile(id, profile)
  cli.profiles.push(profile)
  if (!cli.activeProfileId || authModeForProfile(id, profile) === 'api')
    cli.activeProfileId = profile.id
  syncProfileState(id, cli)
  return saveConfig(cfg)
}

export function updateProfile(id: CliId, profileId: string, patch: CliProfilePatch): AppConfig {
  const cfg = loadConfig()
  const cli = cfg.clis[id]
  const p = cli.profiles.find((x) => x.id === profileId)
  if (p) {
    Object.assign(p, patch)
    normalizeProfile(id, p)
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
  // Ignore requests to switch a CLI without official-auth support into
  // 'official' — it would otherwise stick as a pinned, profile-less mode
  // with nothing for buildCliEnv to inject (see dropGeminiOfficialProfile).
  if (authMode === 'official' && !OFFICIAL_AUTH_CLIS.has(id)) return cfg
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
  return activeProfile(cli)
    ? authModeForProfile(id, activeProfile(cli))
    : (cli.authMode ?? defaultAuthMode(id))
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

/** Gemini-only: see CliPrefs.usageTrackingEnabled. Narrowed to the literal
 * 'gemini' (rather than CliId) since no other CLI has a meaning for this
 * pref — a caller passing another id is a type error, not a silent no-op. */
export function setUsageTrackingEnabled(id: 'gemini', enabled: boolean): AppConfig {
  const cfg = loadConfig()
  cfg.prefs[id] = { ...cfg.prefs[id], usageTrackingEnabled: enabled }
  return saveConfig(cfg)
}

// ---- per-agent resources (pricing / MCP / skills) ----

export function addPriceEntry(id: CliId, patch: CliPricePatch): AppConfig {
  const cfg = loadConfig()
  cfg.resources[id].prices.push({
    id: newId(),
    name: patch.name || 'Untitled price',
    currency: patch.currency || 'USD',
    ...patch
  })
  return saveConfig(cfg)
}

export function updatePriceEntry(id: CliId, entryId: string, patch: CliPricePatch): AppConfig {
  const cfg = loadConfig()
  const entry = cfg.resources[id].prices.find((item) => item.id === entryId)
  if (entry) Object.assign(entry, patch)
  return saveConfig(cfg)
}

export function deletePriceEntry(id: CliId, entryId: string): AppConfig {
  const cfg = loadConfig()
  cfg.resources[id].prices = cfg.resources[id].prices.filter((item) => item.id !== entryId)
  return saveConfig(cfg)
}

export function addMcpEntry(id: CliId, patch: CliMcpPatch): AppConfig {
  const cfg = loadConfig()
  cfg.resources[id].mcpServers.push({
    id: newId(),
    name: patch.name || 'Untitled MCP',
    enabled: patch.enabled ?? true,
    transport: patch.transport ?? 'stdio',
    ...patch
  })
  return saveConfig(cfg)
}

export function updateMcpEntry(id: CliId, entryId: string, patch: CliMcpPatch): AppConfig {
  const cfg = loadConfig()
  const entry = cfg.resources[id].mcpServers.find((item) => item.id === entryId)
  if (entry) Object.assign(entry, patch)
  return saveConfig(cfg)
}

export function deleteMcpEntry(id: CliId, entryId: string): AppConfig {
  const cfg = loadConfig()
  cfg.resources[id].mcpServers = cfg.resources[id].mcpServers.filter((item) => item.id !== entryId)
  return saveConfig(cfg)
}

export function addSkillEntry(id: CliId, patch: CliSkillPatch): AppConfig {
  const cfg = loadConfig()
  cfg.resources[id].skills.push({
    id: newId(),
    name: patch.name || 'Untitled Skill',
    enabled: patch.enabled ?? true,
    ...patch
  })
  return saveConfig(cfg)
}

export function updateSkillEntry(id: CliId, entryId: string, patch: CliSkillPatch): AppConfig {
  const cfg = loadConfig()
  const entry = cfg.resources[id].skills.find((item) => item.id === entryId)
  if (entry) Object.assign(entry, patch)
  return saveConfig(cfg)
}

export function deleteSkillEntry(id: CliId, entryId: string): AppConfig {
  const cfg = loadConfig()
  cfg.resources[id].skills = cfg.resources[id].skills.filter((item) => item.id !== entryId)
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
