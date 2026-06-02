// Shared IPC contract types — imported by both main and renderer.

export type CliId = 'claude-code' | 'codex' | 'gemini' | 'opencode' | 'pi'

export type InstallStrategy = 'native-binary' | 'node-npm'

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
}

/** Per-CLI install state persisted in config.json. */
export interface CliInstallState {
  installed: boolean
  version?: string
  binPath?: string
  /** For gemini: the bundled-node entry we exec. */
  nodeEntry?: string
}

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

/** All profiles for one CLI plus which one is active. */
export interface CliProfiles {
  activeProfileId?: string
  profiles: CliProfile[]
}

/** Patch shape used when creating/editing a profile. */
export type CliProfilePatch = Partial<Omit<CliProfile, 'id'>>

export interface AppConfig {
  schema: number
  install: Record<CliId, CliInstallState>
  clis: Record<CliId, CliProfiles>
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

/** Streamed install progress. */
export interface InstallProgress {
  cliId: CliId
  phase: 'resolve' | 'download' | 'extract' | 'node' | 'npm' | 'verify' | 'done' | 'error'
  message: string
  /** 0..1 when known. */
  fraction?: number
}

export type InstallResult =
  | { ok: true; cliId: CliId; version: string; binPath: string }
  | { ok: false; cliId: CliId; error: string }
