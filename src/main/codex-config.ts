import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './sandbox'
import { getActiveProfile } from './store'

/**
 * Codex doesn't configure relays purely from env vars the way Claude does —
 * it reads `config.toml` ([model_providers]) + `auth.json` ({OPENAI_API_KEY})
 * from $CODEX_HOME. We materialize both from the active profile (same shape
 * cc-switch writes), so launching Codex actually uses the chosen relay.
 */
const CODEX_HOME = () => paths.cliConfig('codex')
const authPath = () => join(CODEX_HOME(), 'auth.json')
const tomlPath = () => join(CODEX_HOME(), 'config.toml')

function buildConfigToml(): string {
  const p = getActiveProfile('codex')
  // No relay (official login) → leave config minimal, Codex uses its own auth.
  if (!p?.baseUrl) return ''
  const lines = [
    'model_provider = "custom"',
    p.model ? `model = "${p.model}"` : null,
    '',
    '[model_providers.custom]',
    `name = "${(p.name || 'Custom').replace(/"/g, '')}"`,
    `base_url = "${p.baseUrl}"`,
    // Codex's native API; most relays support it now, so default to "responses".
    'wire_api = "responses"',
    'env_key = "OPENAI_API_KEY"'
  ].filter((l) => l !== null)
  return lines.join('\n') + '\n'
}

function buildAuthJson(): string {
  const p = getActiveProfile('codex')
  return JSON.stringify({ OPENAI_API_KEY: p?.apiKey ?? '' }, null, 2)
}

/** Write Codex's native config files from the active profile. */
export function writeCodexConfig(): void {
  const dir = CODEX_HOME()
  mkdirSync(dir, { recursive: true })
  const toml = buildConfigToml()
  if (toml) writeFileSync(tomlPath(), toml)
  writeFileSync(authPath(), buildAuthJson(), { mode: 0o600 })
}

function maskKey(json: string): string {
  return json.replace(/("OPENAI_API_KEY":\s*")([^"]+)(")/, (_m, a, key: string, c) => {
    const masked = key ? `${key.slice(0, 3)}…${key.slice(-4)}` : ''
    return `${a}${masked}${c}`
  })
}

export interface CodexFiles {
  dir: string
  configToml: string
  authJson: string
}

/** The on-disk Codex config files for display (auth key masked). */
export function readCodexFiles(): CodexFiles {
  // Regenerate so the preview reflects the active profile even before launch.
  const configToml = existsSync(tomlPath())
    ? readFileSync(tomlPath(), 'utf8')
    : buildConfigToml() || '（官方登录模式，无自定义 provider）'
  const authJson = existsSync(authPath()) ? readFileSync(authPath(), 'utf8') : buildAuthJson()
  return { dir: CODEX_HOME(), configToml, authJson: maskKey(authJson) }
}
