import { mkdirSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { paths } from './sandbox'
import { geminiUsageLogPath, hermesHomeDir } from './config-paths'
import { getActiveProfile, getAuthMode, getPrefs, loadConfig } from './store'
import { claudeProfileEnv, clearClaudeProfileEnv } from './claude-profile-env'
import { buildSystemEnv } from './system-path'
import type { CliId, EnvPair } from '@shared/types'

function clearManagedAuthEnv(env: NodeJS.ProcessEnv, cliId: CliId): void {
  if (cliId === 'claude-code') {
    clearClaudeProfileEnv(env)
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
    delete env.GOOGLE_GENAI_USE_VERTEXAI
    delete env.GOOGLE_GENAI_USE_GCA
  }
}

/**
 * The CLI-specific env vars we inject (relay endpoint + auth + model).
 * Config-home redirects were removed: every CLI now uses its standard config
 * directory (see config-paths.ts). Separated from PATH so it can also drive
 * the "Resolved Environment" preview in the UI. Uses the CLI's ACTIVE profile.
 */
function cliVars(cliId: CliId): EnvPair[] {
  const p = getActiveProfile(cliId)
  const out: EnvPair[] = []

  if (cliId === 'claude-code') {
    if (getAuthMode(cliId) === 'official') return out
    if (p?.baseUrl) out.push({ key: 'ANTHROPIC_BASE_URL', value: p.baseUrl })
    if (p?.apiKey) out.push({ key: 'ANTHROPIC_AUTH_TOKEN', value: p.apiKey, secret: true })
    out.push(...claudeProfileEnv(p))
  } else if (cliId === 'gemini') {
    // gemini-cli dropped free-tier OAuth login (2026-06-18), so there's no
    // "official" auth mode to defer to here — always inject the relay/key.
    // Unresolved caveat: a previously-saved `security.auth.selectedType` in
    // gemini's settings.json still wins over these env vars, so a system
    // install that OAuth'd before the cutoff may keep dead-ending even with
    // a relay profile configured here. GOOGLE_GEMINI_BASE_URL also switches
    // gemini-cli's env-based auth detection to "gateway" mode (checked
    // before GEMINI_API_KEY).
    if (p?.baseUrl) out.push({ key: 'GOOGLE_GEMINI_BASE_URL', value: p.baseUrl })
    if (p?.apiKey) out.push({ key: 'GEMINI_API_KEY', value: p.apiKey, secret: true })
    // Opt-in only (Settings > Usage tracking): gemini-cli never writes token
    // counts anywhere else on disk, so reading its own local OpenTelemetry
    // output (see geminiUsageLogPath) is the only way to populate the Usage
    // page for this CLI — off by default since it changes gemini-cli's own
    // behavior (an extra local log file written on every run).
    if (getPrefs('gemini').usageTrackingEnabled) {
      out.push({ key: 'GEMINI_TELEMETRY_ENABLED', value: 'true' })
      out.push({ key: 'GEMINI_TELEMETRY_TARGET', value: 'local' })
      out.push({ key: 'GEMINI_TELEMETRY_OUTFILE', value: geminiUsageLogPath() })
    }
  }
  // codex / opencode / pi / hermes rely on native config files for relay
  // settings, not env vars.
  return out
}

/** Masked env pairs for display (secrets shown as sk-…last4). */
export function resolvedEnvPreview(cliId: CliId): EnvPair[] {
  return cliVars(cliId).map((e) =>
    e.secret ? { ...e, value: e.value ? `${e.value.slice(0, 3)}…${e.value.slice(-4)}` : '' } : e
  )
}

/**
 * Full process env for spawning the CLI: the injected vars over a copy of the
 * current env. Deprecated managed installs may still prepend their bundled
 * Node directory while they are being migrated. The user never exports this.
 */
export function buildCliEnv(cliId: CliId): NodeJS.ProcessEnv {
  const install = loadConfig().install[cliId]
  const commandDir = install.binPath ? dirname(install.binPath) : undefined
  const env: NodeJS.ProcessEnv = buildSystemEnv(process.env, [commandDir])
  clearManagedAuthEnv(env, cliId)
  if (cliId === 'hermes') env.HERMES_HOME = hermesHomeDir()
  if (install.legacyManaged) {
    const nodeBinDir = process.platform === 'win32' ? paths.node : join(paths.node, 'bin')
    env.PATH = [nodeBinDir, env.PATH].filter(Boolean).join(delimiter)
  }
  if (cliId === 'gemini' && getPrefs('gemini').usageTrackingEnabled) {
    // Best-effort: if this fails (permissions, disk full), gemini-cli simply
    // won't be able to write its own telemetry file this run — same
    // degraded state as leaving the toggle off, not worth failing the
    // launch over.
    try {
      mkdirSync(paths.cliConfig('gemini'), { recursive: true })
    } catch {
      /* ignore */
    }
  }
  for (const { key, value } of cliVars(cliId)) env[key] = value
  return env
}
