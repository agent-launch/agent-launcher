// Shared IPC contract types — imported by both main and renderer.

export type CliId = 'claude-code' | 'codex' | 'gemini'

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

/** Per-CLI provider/runtime config persisted in config.json. */
export interface CliConfig {
  providerId?: string
  /** Pre-filled or custom relay base URL. */
  baseUrl?: string
  /** Stored in PLAINTEXT locally per product decision (no keychain). */
  apiKey?: string
  model?: string
}

export interface AppConfig {
  schema: number
  install: Record<CliId, CliInstallState>
  clis: Record<CliId, CliConfig>
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
