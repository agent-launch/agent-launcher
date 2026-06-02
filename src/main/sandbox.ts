import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CliId } from '@shared/types'

/**
 * The whole app lives in an isolated sandbox so we never touch the user's
 * existing CLI installs or global npm. Layout:
 *
 *   ~/.agent-launcher/
 *     config.json            app config (provider/key/model, install state)
 *     node/                  bundled portable Node (only fetched if Gemini)
 *     npm-cache/             isolated npm cache
 *     cli/<id>/              each CLI's install
 *     cli-config/<id>/       each CLI's redirected config dir (CLAUDE_CONFIG_DIR etc.)
 *     downloads/             scratch space for tarballs
 */
export const SANDBOX_ROOT = join(homedir(), '.agent-launcher')

export const paths = {
  root: SANDBOX_ROOT,
  config: join(SANDBOX_ROOT, 'config.json'),
  node: join(SANDBOX_ROOT, 'node'),
  npmCache: join(SANDBOX_ROOT, 'npm-cache'),
  downloads: join(SANDBOX_ROOT, 'downloads'),
  cliInstall: (id: CliId) => join(SANDBOX_ROOT, 'cli', id),
  cliConfig: (id: CliId) => join(SANDBOX_ROOT, 'cli-config', id)
}

/** Path to the bundled node executable, OS-aware. */
export function bundledNodeBin(): string {
  return process.platform === 'win32'
    ? join(paths.node, 'node.exe')
    : join(paths.node, 'bin', 'node')
}

/** Path to npm's cli entry inside the bundled node, OS-aware. */
export function bundledNpmCli(): string {
  return process.platform === 'win32'
    ? join(paths.node, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : join(paths.node, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
}
