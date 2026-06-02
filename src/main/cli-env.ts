import { delimiter, dirname, join } from 'node:path'
import { paths } from './sandbox'
import { loadConfig } from './store'
import type { CliId } from '@shared/types'

/**
 * Build the environment for a CLI process. This is the product's core trick:
 * the user never exports anything — we inject the relay endpoint, auth token,
 * model, and an ISOLATED config dir so the user's real ~/.claude etc. is
 * untouched. See the per-CLI config-dir env vars researched earlier.
 */
export function buildCliEnv(cliId: CliId): NodeJS.ProcessEnv {
  const cfg = loadConfig()
  const cli = cfg.clis[cliId]
  const install = cfg.install[cliId]
  const configDir = paths.cliConfig(cliId)

  // Start from a trimmed copy of the current env, then prepend our sandbox
  // node/bin to PATH (needed for the Gemini JS entry to find `node`).
  const env: NodeJS.ProcessEnv = { ...process.env }
  const nodeBinDir =
    process.platform === 'win32' ? paths.node : join(paths.node, 'bin')
  env.PATH = [nodeBinDir, env.PATH].filter(Boolean).join(delimiter)

  if (cliId === 'claude-code') {
    env.CLAUDE_CONFIG_DIR = configDir
    if (cli.baseUrl) env.ANTHROPIC_BASE_URL = cli.baseUrl
    if (cli.apiKey) env.ANTHROPIC_AUTH_TOKEN = cli.apiKey
    if (cli.model) env.ANTHROPIC_MODEL = cli.model
  } else if (cliId === 'codex') {
    env.CODEX_HOME = configDir
    if (cli.baseUrl) env.OPENAI_BASE_URL = cli.baseUrl
    if (cli.apiKey) env.OPENAI_API_KEY = cli.apiKey
  } else if (cliId === 'gemini') {
    // GEMINI_CLI_HOME relocates the whole home root; .gemini lives under it.
    env.GEMINI_CLI_HOME = configDir
    if (cli.baseUrl) env.GOOGLE_GEMINI_BASE_URL = cli.baseUrl
    if (cli.apiKey) env.GEMINI_API_KEY = cli.apiKey
    if (cli.model) env.GEMINI_MODEL = cli.model
  }

  // Make sure the isolated config dir's parent exists so the CLI can write it.
  void dirname(configDir)
  void install
  return env
}
