import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import { paths } from './sandbox'
import { hermesHomeDir } from './config-paths'
import { getActiveProfile, getAuthMode, getInstallSource } from './store'
import type { CliId, CliProfile, EnvPair } from '@shared/types'

function withCommonPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform === 'win32') return env
  const common = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const existing = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const seen = new Set(existing)
  env.PATH = [...existing, ...common.filter((dir) => !seen.has(dir))].join(delimiter)
  return env
}

function clearManagedAuthEnv(env: NodeJS.ProcessEnv, cliId: CliId): void {
  if (cliId === 'claude-code') {
    delete env.ANTHROPIC_BASE_URL
    delete env.ANTHROPIC_AUTH_TOKEN
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_MODEL
    delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    delete env.ANTHROPIC_DEFAULT_SONNET_MODEL
    delete env.ANTHROPIC_DEFAULT_OPUS_MODEL
  } else if (cliId === 'codex') {
    delete env.OPENAI_BASE_URL
    delete env.OPENAI_API_KEY
    delete env.OPENAI_ORG_ID
    delete env.OPENAI_PROJECT_ID
  } else if (cliId === 'hermes') {
    delete env.OPENAI_BASE_URL
    delete env.OPENAI_API_KEY
    delete env.HERMES_INFERENCE_MODEL
    delete env.HERMES_MODEL
  } else if (cliId === 'gemini') {
    delete env.GEMINI_API_KEY
    delete env.GOOGLE_GEMINI_BASE_URL
  }
}

function claudeModelEnv(profile: CliProfile | undefined): EnvPair[] {
  if (!profile) return []
  const fallback = profile.model?.trim() || undefined
  const defaultModel = profile.defaultModel?.trim() || fallback
  const haikuModel = profile.haikuModel?.trim() || fallback
  const sonnetModel = profile.sonnetModel?.trim() || fallback
  const opusModel = profile.opusModel?.trim() || fallback
  const out: EnvPair[] = []
  if (defaultModel) out.push({ key: 'ANTHROPIC_MODEL', value: defaultModel })
  if (haikuModel) out.push({ key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', value: haikuModel })
  if (sonnetModel) out.push({ key: 'ANTHROPIC_DEFAULT_SONNET_MODEL', value: sonnetModel })
  if (opusModel) out.push({ key: 'ANTHROPIC_DEFAULT_OPUS_MODEL', value: opusModel })
  return out
}

/**
 * The CLI-specific env vars we inject (config dir + relay endpoint + auth +
 * model). Separated from PATH so it can also drive the "Resolved Environment"
 * preview in the UI. Uses the CLI's ACTIVE profile.
 */
function cliVars(cliId: CliId): EnvPair[] {
  const p = getActiveProfile(cliId)
  const configDir = paths.cliConfig(cliId)
  const isSystemInstall = getInstallSource(cliId) === 'system'
  const out: EnvPair[] = []

  if (cliId === 'claude-code') {
    if (!isSystemInstall) out.push({ key: 'CLAUDE_CONFIG_DIR', value: configDir })
    if (getAuthMode(cliId) === 'official') return out
    if (p?.baseUrl) out.push({ key: 'ANTHROPIC_BASE_URL', value: p.baseUrl })
    if (p?.apiKey) out.push({ key: 'ANTHROPIC_AUTH_TOKEN', value: p.apiKey, secret: true })
    out.push(...claudeModelEnv(p))
  } else if (cliId === 'codex') {
    if (isSystemInstall) return out
    out.push({ key: 'CODEX_HOME', value: configDir })
  } else if (cliId === 'opencode') {
    if (isSystemInstall) return out
    // opencode honors XDG dirs; isolate config/data/cache/state into the sandbox.
    // Relay/key live in opencode.json (see native-config), pointed to here.
    out.push({ key: 'XDG_CONFIG_HOME', value: join(configDir, 'xdg-config') })
    out.push({ key: 'XDG_DATA_HOME', value: join(configDir, 'xdg-data') })
    out.push({ key: 'XDG_CACHE_HOME', value: join(configDir, 'xdg-cache') })
    out.push({ key: 'XDG_STATE_HOME', value: join(configDir, 'xdg-state') })
    out.push({ key: 'OPENCODE_CONFIG', value: join(configDir, 'opencode.json') })
  } else if (cliId === 'pi') {
    if (isSystemInstall) return out
    // PI_CODING_AGENT_DIR holds config (models.json/auth.json) + sessions/.
    out.push({ key: 'PI_CODING_AGENT_DIR', value: configDir })
  } else if (cliId === 'gemini') {
    // Gemini CLI has no reliable config-dir override (unlike the CLIs above),
    // so its config/session state always lives in the real ~/.gemini — no
    // configDir redirection here. Official (OAuth) mode needs no env at all.
    if (getAuthMode('gemini') === 'official') return out
    if (p?.baseUrl) out.push({ key: 'GOOGLE_GEMINI_BASE_URL', value: p.baseUrl })
    if (p?.apiKey) out.push({ key: 'GEMINI_API_KEY', value: p.apiKey, secret: true })
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
 * current env. Deprecated managed installs may still prepend their bundled
 * Node directory while they are being migrated. The user never exports this.
 */
export function buildCliEnv(cliId: CliId): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = withCommonPath({ ...process.env })
  clearManagedAuthEnv(env, cliId)
  if (cliId === 'hermes') env.HERMES_HOME = hermesHomeDir()
  if (getInstallSource(cliId) !== 'system') {
    const nodeBinDir = process.platform === 'win32' ? paths.node : join(paths.node, 'bin')
    env.PATH = [nodeBinDir, env.PATH].filter(Boolean).join(delimiter)
  }
  for (const { key, value } of cliVars(cliId)) env[key] = value
  return env
}
