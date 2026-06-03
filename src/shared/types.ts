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

/** Per-CLI runtime preferences (not tied to a provider profile). */
export interface CliPrefs {
  /** Auto-approve everything / skip permission prompts (where supported). */
  yolo?: boolean
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
  | { type: 'part'; role: TranscriptRole; part: TranscriptPart; streaming?: boolean }
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
