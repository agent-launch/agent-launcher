import { homedir } from 'node:os'
import { join } from 'node:path'
import { paths } from './sandbox'
import { getInstallSource } from './store'
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
 * state lands at `${GEMINI_CLI_HOME}/.gemini` (see buildCliEnv). Anything
 * that needs to read gemini's on-disk config/session state directly — not
 * just set the env var — should go through this instead of cliConfigDir().
 */
export function geminiStateDir(): string {
  return getInstallSource('gemini') === 'system'
    ? join(process.env.GEMINI_CLI_HOME || homedir(), '.gemini')
    : join(paths.cliConfig('gemini'), '.gemini')
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

export function cliConfigDir(cliId: CliId): string {
  return getInstallSource(cliId) === 'system' ? systemCliConfigDir(cliId) : paths.cliConfig(cliId)
}
