// Shared IPC contract types — imported by both main and renderer.

export type CliId = 'claude-code' | 'codex' | 'opencode' | 'pi'

export type InstallStrategy = 'native-binary' | 'node-npm'
export type InstallSource = 'sandbox' | 'system'
export type InstallAction = 'link' | 'install' | 'reinstall' | 'repair'

export interface PlatformInfo {
  os: 'darwin' | 'win32' | 'linux'
  arch: 'x64' | 'arm64'
  /** Rust-style target triple key we use to pick subpackages. */
  platformKey: string
}

/** A single detected environment fact shown in the wizard's "检测环境" step. */
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
  /** Where the executable comes from. Legacy values are inferred on load. */
  source?: InstallSource
  version?: string
  binPath?: string
  /** For node-npm CLIs (Pi): the bundled-node entry we exec. */
  nodeEntry?: string
}

export interface SystemCliCandidate {
  path: string
  realPath?: string
  version?: string
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
}

export interface InstallOptions {
  source?: InstallSource
  action?: InstallAction
  binPath?: string
}

export type CleanupCliResult =
  | { ok: true; cliId: CliId; path: string; backupPath: string }
  | { ok: false; cliId: CliId; path: string; error: string }

/** A single saved provider config (cc-switch style profile). */
export interface CliProfile {
  id: string
  /** User-facing label, e.g. "AiHubMix · Opus". */
  name: string
  providerId?: string
  /** Pre-filled or custom relay base URL. */
  baseUrl?: string
  /** Stored in PLAINTEXT locally per product decision (no keychain). */
  apiKey?: string
  model?: string
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

/** Per-CLI runtime preferences (not tied to a provider profile). */
export interface CliPrefs {
  /** Auto-approve everything / skip permission prompts (where supported). */
  yolo?: boolean
  /** Internal: whether we already tried importing this CLI's existing system config. */
  systemConfigImportChecked?: boolean
  /** Internal: keep a user-created empty official profile visible in config lists. */
  officialProfilePinned?: boolean
}

export interface AppConfig {
  schema: number
  install: Record<CliId, CliInstallState>
  clis: Record<CliId, CliProfiles>
  prefs: Record<CliId, CliPrefs>
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
  /** True when AgentLauncher's sandbox config existed before renderer startup. */
  hasConfig: boolean
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

/** Streamed install progress. */
export interface InstallProgress {
  cliId: CliId
  phase:
    | 'resolve'
    | 'download'
    | 'extract'
    | 'node'
    | 'npm'
    | 'system'
    | 'link'
    | 'repair'
    | 'verify'
    | 'done'
    | 'error'
  message: string
  /** 0..1 when known. */
  fraction?: number
}

export type InstallResult =
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
