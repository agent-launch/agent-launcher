// Shared IPC contract types — imported by both main and renderer.

// The array is the source of truth — CliId is derived from it — so adding a
// CLI means updating this one place instead of several independently
// hand-maintained lists drifting out of sync (see sessions-worker.ts and
// install/detect.ts, which both did exactly that before this change).
export const ALL_CLI_IDS = ['claude-code', 'codex', 'opencode', 'pi', 'hermes', 'gemini'] as const
export type CliId = (typeof ALL_CLI_IDS)[number]

export type InstallSource = 'system'
export type CodexInstallKind =
  | 'standalone'
  | 'npm'
  | 'homebrew-cask'
  | 'github-release'
  | 'dotslash'
  | 'source-build'
  | 'app-bundled'
  | 'unknown'
export type CodexPackageManager = 'npm' | 'pnpm' | 'bun' | 'volta'

export interface PlatformInfo {
  os: 'darwin' | 'win32' | 'linux'
  arch: 'x64' | 'arm64'
  /** Rust-style target triple key we use to pick subpackages. */
  platformKey: string
}

/** A single detected environment fact shown in the wizard's environment detection step. */
export interface DetectItem {
  key: string
  label: string
  present: boolean
  detail?: string
}

export interface DetectResult {
  platform: PlatformInfo
  items: DetectItem[]
  systemClis?: Record<CliId, SystemCliDetection>
}

/** Per-CLI install state persisted in config.json. */
export interface CliInstallState {
  installed: boolean
  /** Where the executable comes from. Always normalized to 'system' on load.
   * The legacy managed-install state is tracked by `legacyManaged`. */
  source?: InstallSource
  /** True when the recorded binPath/nodeEntry lives under the app's own
   * managed root (legacy app-managed installs). Derived from paths, not the
   * persisted `source` field, so it survives SCHEMA normalization. */
  legacyManaged?: boolean
  version?: string
  binPath?: string
  /** For node-npm CLIs (Pi): the bundled-node entry we exec. */
  nodeEntry?: string
  /** Prevents launch paths from executing a binary that macOS has blocked or
   * that must be replaced before it is safe to probe. */
  launchBlockedReason?: 'macos-security'
  /** Static provenance for Codex system installs. */
  installKind?: CodexInstallKind
  packageManager?: CodexPackageManager
}

export interface SystemCliCandidate {
  path: string
  realPath?: string
  version?: string
  /** macOS Gatekeeper quarantine — executing this binary pops a security dialog. */
  quarantined?: boolean
  /** The candidate must not be executed during detection. For Codex this also
   * covers explicit Gatekeeper/XProtect assessment failures. */
  macosSecurityRisk?: boolean
  installKind?: CodexInstallKind
  packageManager?: CodexPackageManager
}

export interface SystemCliDetection {
  cliId: CliId
  command: string
  candidates: SystemCliCandidate[]
  selectedPath?: string
  configuredBinPath?: string
  installed: boolean
  duplicate: boolean
  status: 'linked' | 'available' | 'missing' | 'duplicate' | 'stale'
  detail: string
  /** True when the selected candidate carries the macOS quarantine attribute. */
  quarantined?: boolean
  /** True when a static check found that launching the selected candidate may
   * trigger a macOS security dialog. */
  macosSecurityRisk?: boolean
  installKind?: CodexInstallKind
  packageManager?: CodexPackageManager
  /** A Codex command detected inside the default WSL distribution. It is
   * informational because the native desktop app can only use Windows commands. */
  wslPath?: string
}

export interface CliLinkOptions {
  binPath?: string
}

export type CleanupCliResult =
  | { ok: true; cliId: CliId; path: string; backupPath: string }
  | { ok: false; cliId: CliId; path: string; error: string }

export type DashboardLaunchResult =
  { ok: true; cliId: CliId; url: string } | { ok: false; cliId: CliId; error: string }

/** A single saved provider configuration. */
export interface CliProfile {
  id: string
  /** User-facing label, e.g. "AiHubMix · Opus". */
  name: string
  providerId?: string
  /** Pre-filled or custom relay base URL. */
  baseUrl?: string
  /** Stored in PLAINTEXT locally per product decision (no keychain). */
  apiKey?: string
  /** Generic/default model for CLIs that expose a single model setting. */
  model?: string
  /** Claude Code model aliases written to its native ANTHROPIC_* env config. */
  defaultModel?: string
  opusModel?: string
  sonnetModel?: string
  haikuModel?: string
}

export type AuthMode = 'official' | 'api'

/** All profiles for one CLI plus which one is active. */
export interface CliProfiles {
  activeProfileId?: string
  profiles: CliProfile[]
  /** Claude/Codex can use official account login instead of API-key profiles. */
  authMode?: AuthMode
}

/** Patch shape used when creating/editing a profile. */
export type CliProfilePatch = Partial<Omit<CliProfile, 'id'>>

export type ProfileConnectionCode =
  | 'ok'
  | 'invalid_config'
  | 'invalid_url'
  | 'unauthorized'
  | 'forbidden'
  | 'payment_required'
  | 'bad_request'
  | 'unsupported_api'
  | 'rate_limited'
  | 'server_error'
  | 'http_error'
  | 'invalid_response'
  | 'backend_mismatch'
  | 'timeout'
  | 'network_error'

export interface ProfileConnectionResult {
  kind: 'generation'
  ok: boolean
  code: ProfileConnectionCode
  status?: number
  /** Server-reported error message, when the endpoint returned one. */
  detail?: string
}

export interface CliPriceEntry {
  id: string
  name: string
  provider?: string
  model?: string
  currency?: string
  inputPerMillion?: number
  outputPerMillion?: number
  cacheReadPerMillion?: number
  cacheWritePerMillion?: number
  notes?: string
}

export type McpTransport = 'stdio' | 'http' | 'sse'

export interface CliMcpEntry {
  id: string
  name: string
  enabled: boolean
  transport: McpTransport
  command?: string
  args?: string
  url?: string
  env?: string
  notes?: string
}

export interface CliSkillEntry {
  id: string
  name: string
  enabled: boolean
  source?: string
  provider?: 'manual' | 'skills.sh'
  description?: string
  installUrl?: string
  skillsShId?: string
  skillsShSlug?: string
  skillsShSource?: string
  skillsShUrl?: string
  notes?: string
}

export interface CliResources {
  prices: CliPriceEntry[]
  mcpServers: CliMcpEntry[]
  skills: CliSkillEntry[]
}

export type CliPricePatch = Partial<Omit<CliPriceEntry, 'id'>>
export type CliMcpPatch = Partial<Omit<CliMcpEntry, 'id'>>
export type CliSkillPatch = Partial<Omit<CliSkillEntry, 'id'>>

export type InstalledMcpConfigKind =
  'codex-toml' | 'codex-plugin' | 'json-mcp' | 'json-mcp-servers' | 'hermes-yaml'

export interface InstalledMcpEntry {
  id: string
  cliId: CliId
  name: string
  enabled: boolean
  supportsEnabled: boolean
  /** Read-only entries (e.g. MCP servers bundled by a Codex plugin) can't be
   * added/edited/deleted from the UI — they're managed by their plugin. */
  readOnly?: boolean
  transport: McpTransport
  command?: string
  args?: string
  url?: string
  env?: string
  configPath: string
  configKind: InstalledMcpConfigKind
}

export type InstalledMcpPatch = Partial<
  Pick<InstalledMcpEntry, 'name' | 'enabled' | 'transport' | 'command' | 'args' | 'url' | 'env'>
>

export interface InstalledSkillEntry {
  id: string
  cliId: CliId
  name: string
  enabled: boolean
  path: string
  dir: string
  root: string
  source?: string
  provider?: 'local' | 'skills.sh'
  description?: string
}

export type InstalledSkillPatch = Partial<Pick<InstalledSkillEntry, 'name' | 'description'>>

export interface InstalledSkillFile {
  path: string
  content: string
}

/** Per-CLI runtime preferences (not tied to a provider profile). */
export interface CliPrefs {
  /** Auto-approve everything / skip permission prompts (where supported). */
  yolo?: boolean
  /** Internal: whether we already tried importing this CLI's existing system config. */
  systemConfigImportChecked?: boolean
  /** Internal: keep a user-created empty official profile visible in config lists. */
  officialProfilePinned?: boolean
  /** Gemini-only: opt-in to gemini-cli's own local OpenTelemetry file so its
   * token usage can be read for the Usage page. Off by default — gemini-cli
   * doesn't record token counts anywhere else on disk, so this is the only
   * way to populate its usage data, and enabling it changes gemini-cli's own
   * behavior (writes a local log file on every run). */
  usageTrackingEnabled?: boolean
}

export interface AppConfig {
  schema: number
  install: Record<CliId, CliInstallState>
  clis: Record<CliId, CliProfiles>
  prefs: Record<CliId, CliPrefs>
  resources: Record<CliId, CliResources>
}

/** A real, resumable conversation persisted by the CLI itself. */
export interface SessionInfo {
  id: string
  cliId: CliId
  /** ai-title / first prompt — the display name. */
  name: string
  /** Last-modified epoch ms, for sorting + display. */
  updatedAt: number
  cwd?: string
}

export interface SessionDeleteResult {
  ok: boolean
  cliId: CliId
  id: string
  /** Number of physical files or database rows removed. */
  deletedCount: number
  /** True when the session was already missing, so the UI can still clear it. */
  missing?: boolean
  error?: string
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  configPath: string
  /** True when Agent Launcher's sandbox config existed before renderer startup. */
  hasConfig: boolean
}

export interface AppUpdateReleaseAsset {
  name: string
  url: string
  size?: number
}

export interface AppUpdateRelease {
  version: string
  tagName: string
  name: string
  notes?: string
  url: string
  publishedAt?: string
  assets: AppUpdateReleaseAsset[]
}

export interface AppUpdatePolicy {
  force: boolean
  minVersion?: string
  latestVersion?: string
  message?: string
  url?: string
}

export type AppUpdateStatusKind =
  'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'

export interface AppUpdateStatus {
  status: AppUpdateStatusKind
  supported: boolean
  /** False when this package format supports updates, but no updater feed was found for this version/platform. */
  canAutoDownload?: boolean
  currentVersion: string
  latestRelease?: AppUpdateRelease
  policy?: AppUpdatePolicy
  percent?: number
  error?: string
  checkedAt?: number
}

export type AppUpdateCheckResult =
  { ok: true; status: AppUpdateStatus } | { ok: false; status: AppUpdateStatus; error: string }

export type AppUpdateDownloadResult =
  { ok: true; status: AppUpdateStatus } | { ok: false; status: AppUpdateStatus; error: string }

export interface AppUpdateDownloadProgress {
  percent: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
}

export interface UsageTokenTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
}

export interface UsageCostTotals {
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheCreationCost: number
  totalCost: number
}

export interface UsageModelBreakdown {
  model: string
  requestCount: number
  tokens: UsageTokenTotals
  cost: UsageCostTotals
}

export interface UsageDailyBucket {
  date: string
  requestCount: number
  tokens: UsageTokenTotals
  cost: UsageCostTotals
}

export interface UsageCliSummary {
  cliId: CliId
  requestCount: number
  sessionCount: number
  tokens: UsageTokenTotals
  cost: UsageCostTotals
}

export interface UsageScanResult {
  rangeDays: number
  summaryDays: number
  generatedAt: number
  startedAt: number
  summaryStartedAt: number
  endedAt: number
  requestCount: number
  sessionCount: number
  tokens: UsageTokenTotals
  cost: UsageCostTotals
  byCli: UsageCliSummary[]
  byModel: UsageModelBreakdown[]
  daily: UsageDailyBucket[]
  errors: string[]
}

/** A normalized, read-only view of a CLI's saved conversation (for in-UI render). */
export type TranscriptRole = 'user' | 'assistant' | 'system'
export interface TranscriptPart {
  kind: 'text' | 'thinking' | 'tool'
  /** Body for kind=text/thinking. */
  text?: string
  /** Tool name for kind=tool. */
  tool?: string
  /** One-line tool target/args for kind=tool. */
  detail?: string
  /** Full or fuller tool input/args for expandable rendering. */
  input?: string
  /** Tool stdout/result body for expandable rendering. */
  result?: string
  /** True when the CLI marked the tool result as failed. */
  isError?: boolean
  /** Tool execution state when the CLI exposes it. */
  status?: 'running' | 'completed' | 'error'
  /** Stable part id; when set, a streamed update replaces the same-id part (opencode). */
  id?: string
}
export interface TranscriptMessage {
  role: TranscriptRole
  parts: TranscriptPart[]
  ts?: number
}
export interface Transcript {
  cliId: CliId
  id: string
  messages: TranscriptMessage[]
  /** True if we capped a very long conversation. */
  truncated: boolean
}

/** Options for starting an in-UI chat session with a CLI (programmatic mode). */
export interface ChatStartOptions {
  cliId: CliId
  cwd?: string
  /** Resume an existing CLI session instead of starting fresh. */
  resumeId?: string
}

/** Streamed events from a running in-UI chat, normalized across CLIs. */
export type ChatEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'part'; role: TranscriptRole; part: TranscriptPart; streaming?: boolean; ts?: number }
  | { type: 'turn-end' }
  | { type: 'error'; message: string }
  | { type: 'exit' }

/** One resolved env var pair for the "Resolved Environment" preview. */
export interface EnvPair {
  key: string
  value: string
  /** True for secrets we mask in the UI. */
  secret?: boolean
}

/** A native config file a CLI reads (Codex/opencode/pi), for display. */
export interface NativeFile {
  name: string
  content: string
}
export interface NativeFiles {
  dir: string
  files: NativeFile[]
}

export type AuthLoginMethod = 'official' | 'device'

export interface AuthStatus {
  cliId: CliId
  supported: boolean
  installed: boolean
  loggedIn: boolean
  detail?: string
  error?: string
}

/** Streamed progress while linking an existing system CLI. */
export interface CliLinkProgress {
  cliId: CliId
  /** 'install' | 'native' | 'npm' | 'official' only occur while installing a
   * CLI the user does not have yet; linking never reports them. */
  phase: 'link' | 'verify' | 'install' | 'native' | 'npm' | 'official' | 'done' | 'error'
  message: string
}

export type CliLinkResult =
  | {
      ok: true
      cliId: CliId
      version: string
      binPath: string
      source: InstallSource
      warning?: string
      candidates?: SystemCliCandidate[]
    }
  | { ok: false; cliId: CliId; error: string }

export interface CliUpdateStatus {
  cliId: CliId
  /** True only when the configured executable/entry still exists on disk. */
  installed: boolean
  /** True when config.json says this CLI was installed, even if files are now missing. */
  configured: boolean
  /** Config points at files that no longer exist. */
  stale: boolean
  /** Always 'system' in current builds; use `legacyManaged` for the legacy label. */
  source?: InstallSource
  /** True for legacy app-managed installs whose binaries live under the app's
   * managed root. Used by Settings to show the "legacy" source label. */
  legacyManaged?: boolean
  currentVersion?: string
  latestVersion?: string
  updateAvailable: boolean
  binPath?: string
  error?: string
  checkedAt: number
}
