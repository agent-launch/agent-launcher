import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CliId } from '@shared/types'

/**
 * Agent Launcher state root. CLI/config subdirectories remain for backwards
 * compatibility with deprecated app-managed installs. Agent Launcher no
 * longer installs CLIs; it only links existing system commands. Layout:
 *
 *   ~/.agent-launcher/
 *     config.json            app config (provider/key/model, install state)
 *     node/                  legacy bundled portable Node
 *     cli/<id>/              legacy managed CLI files
 *     cli-config/<id>/       legacy redirected config/state and app-owned telemetry
 */
export const SANDBOX_ROOT = join(homedir(), '.agent-launcher')

export const paths = {
  root: SANDBOX_ROOT,
  config: join(SANDBOX_ROOT, 'config.json'),
  node: join(SANDBOX_ROOT, 'node'),
  cliInstall: (id: CliId) => join(SANDBOX_ROOT, 'cli', id),
  cliConfig: (id: CliId) => join(SANDBOX_ROOT, 'cli-config', id)
}
