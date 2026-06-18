import { homedir } from 'node:os'
import { join } from 'node:path'
import { paths } from './sandbox'
import { getInstallSource } from './store'
import type { CliId } from '@shared/types'

export function systemCliConfigDir(cliId: CliId): string {
  if (cliId === 'claude-code') return join(homedir(), '.claude')
  if (cliId === 'codex') return join(homedir(), '.codex')
  if (cliId === 'pi') return join(homedir(), '.pi', 'agent')
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(xdgConfigHome, 'opencode')
}

export function cliConfigDir(cliId: CliId): string {
  return getInstallSource(cliId) === 'system' ? systemCliConfigDir(cliId) : paths.cliConfig(cliId)
}
