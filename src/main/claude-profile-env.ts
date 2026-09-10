import type { CliProfile, EnvPair } from '@shared/types'

const CLAUDE_PROFILE_ENV_KEYS = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_AUTO_MODE_MODEL',
  'CLAUDE_CODE_BG_CLASSIFIER_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL'
])

function isClaudeProfileEnvKey(key: string): boolean {
  return (
    CLAUDE_PROFILE_ENV_KEYS.has(key) ||
    /^ANTHROPIC_DEFAULT_[A-Z0-9]+_MODEL(?:_[A-Z0-9_]+)?$/.test(key) ||
    /^ANTHROPIC_CUSTOM_MODEL_OPTION(?:_[A-Z0-9_]+)?$/.test(key) ||
    /^ANTHROPIC_SMALL_FAST_MODEL(?:_[A-Z0-9_]+)?$/.test(key)
  )
}

/** Remove endpoint, auth, and model routing left by a previously active profile. */
export function clearClaudeProfileEnv(env: Record<string, unknown>): void {
  for (const key of Object.keys(env)) {
    if (isClaudeProfileEnvKey(key)) delete env[key]
  }
}

export function claudeProfileEnv(profile: CliProfile | undefined): EnvPair[] {
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
