import { delimiter, join } from 'node:path'
import { paths } from './sandbox'
import { getActiveProfile } from './store'
import type { CliId, EnvPair } from '@shared/types'

/**
 * The CLI-specific env vars we inject (config dir + relay endpoint + auth +
 * model). Separated from PATH so it can also drive the "Resolved Environment"
 * preview in the UI. Uses the CLI's ACTIVE profile.
 */
function cliVars(cliId: CliId): EnvPair[] {
  const p = getActiveProfile(cliId)
  const configDir = paths.cliConfig(cliId)
  const out: EnvPair[] = []

  if (cliId === 'claude-code') {
    out.push({ key: 'CLAUDE_CONFIG_DIR', value: configDir })
    if (p?.baseUrl) out.push({ key: 'ANTHROPIC_BASE_URL', value: p.baseUrl })
    if (p?.apiKey) out.push({ key: 'ANTHROPIC_AUTH_TOKEN', value: p.apiKey, secret: true })
    if (p?.model) out.push({ key: 'ANTHROPIC_MODEL', value: p.model })
  } else if (cliId === 'codex') {
    out.push({ key: 'CODEX_HOME', value: configDir })
    if (p?.baseUrl) out.push({ key: 'OPENAI_BASE_URL', value: p.baseUrl })
    if (p?.apiKey) out.push({ key: 'OPENAI_API_KEY', value: p.apiKey, secret: true })
  } else if (cliId === 'gemini') {
    out.push({ key: 'GEMINI_CLI_HOME', value: configDir })
    if (p?.baseUrl) out.push({ key: 'GOOGLE_GEMINI_BASE_URL', value: p.baseUrl })
    if (p?.apiKey) out.push({ key: 'GEMINI_API_KEY', value: p.apiKey, secret: true })
    if (p?.model) out.push({ key: 'GEMINI_MODEL', value: p.model })
  }
  return out
}

/** Masked env pairs for display (secrets shown as sk-…last4). */
export function resolvedEnvPreview(cliId: CliId): EnvPair[] {
  return cliVars(cliId).map((e) =>
    e.secret
      ? { ...e, value: e.value ? `${e.value.slice(0, 3)}…${e.value.slice(-4)}` : '' }
      : e
  )
}

/**
 * Full process env for spawning the CLI: the injected vars over a copy of the
 * current env, plus our sandbox node/bin prepended to PATH (Gemini's JS entry
 * needs `node`). The user never exports any of this.
 */
export function buildCliEnv(cliId: CliId): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  const nodeBinDir = process.platform === 'win32' ? paths.node : join(paths.node, 'bin')
  env.PATH = [nodeBinDir, env.PATH].filter(Boolean).join(delimiter)
  for (const { key, value } of cliVars(cliId)) env[key] = value
  return env
}
