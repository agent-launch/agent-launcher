import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { paths } from './sandbox'
import type { CliId } from '@shared/types'

export function hermesHomeDir(): string {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, 'hermes')
  }
  return join(homedir(), '.hermes')
}

/**
 * gemini-cli's GEMINI_CLI_HOME env var (v0.25+) replaces its own os.homedir()
 * resolution rather than pointing at a config dir directly, so its actual
 * state lands at `${GEMINI_CLI_HOME}/.gemini`. Anything that needs to read
 * gemini's on-disk config/session state directly — not just set the env var —
 * should go through this instead of cliConfigDir().
 */
export function geminiStateDir(): string {
  return join(process.env.GEMINI_CLI_HOME || homedir(), '.gemini')
}

/**
 * Where we point gemini-cli's own local OpenTelemetry output (see
 * CliPrefs.usageTrackingEnabled) so usage.ts can read token counts back.
 * Always under our own managed dir — independent of GEMINI_CLI_HOME/
 * geminiStateDir, since this is bookkeeping we own, not part of gemini's
 * real state.
 */
export function geminiUsageLogPath(): string {
  return join(paths.cliConfig('gemini'), 'usage-telemetry.log')
}

export function systemCliConfigDir(cliId: CliId): string {
  if (cliId === 'claude-code') return join(homedir(), '.claude')
  if (cliId === 'codex') return join(homedir(), '.codex')
  if (cliId === 'pi') return join(homedir(), '.pi', 'agent')
  if (cliId === 'hermes') return hermesHomeDir()
  if (cliId === 'gemini') return join(process.env.GEMINI_CLI_HOME || homedir(), '.gemini')
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(xdgConfigHome, 'opencode')
}

/** Every CLI now uses its standard config directory; the sandbox redirect is gone. */
export function cliConfigDir(cliId: CliId): string {
  return systemCliConfigDir(cliId)
}

/**
 * Read-only state dirs left behind by deprecated app-managed installs, which
 * redirected each CLI's config home into ~/.agent-launcher/cli-config/<id>.
 * SQLite-backed opencode/Hermes state is intentionally not merged.
 */
export function cliStateRoots(cliId: CliId): string[] {
  const primary = cliId === 'gemini' ? geminiStateDir() : systemCliConfigDir(cliId)
  if (cliId === 'opencode' || cliId === 'hermes') return [primary]
  // Mirror the old GEMINI_CLI_HOME semantics: state landed at <home>/.gemini.
  const legacy =
    cliId === 'gemini' ? join(paths.cliConfig('gemini'), '.gemini') : paths.cliConfig(cliId)
  return existsSync(legacy) ? [primary, legacy] : [primary]
}
