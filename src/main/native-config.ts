import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './sandbox'
import { getActiveProfile } from './store'
import type { CliId, NativeFiles } from '@shared/types'

/**
 * Some CLIs aren't configured purely by env vars — they read config FILES from
 * their home dir. We materialize those from the active profile (the way
 * cc-switch does) so launching them actually uses the chosen relay:
 *   - Codex:    config.toml + auth.json
 *   - opencode: opencode.json (custom provider via @ai-sdk/openai-compatible)
 *   - pi:       models.json (custom provider)
 */
export function hasNativeConfig(cliId: CliId): boolean {
  return cliId === 'codex' || cliId === 'opencode' || cliId === 'pi'
}

const PROVIDER_ID = 'agentlauncher'

// ---------- Codex ----------
function codexToml(): string {
  const p = getActiveProfile('codex')
  if (!p?.baseUrl) return ''
  return (
    [
      'model_provider = "custom"',
      p.model ? `model = "${p.model}"` : null,
      '',
      '[model_providers.custom]',
      `name = "${(p.name || 'Custom').replace(/"/g, '')}"`,
      `base_url = "${p.baseUrl}"`,
      // Codex's native API; most relays support it now.
      'wire_api = "responses"',
      'env_key = "OPENAI_API_KEY"'
    ]
      .filter((l) => l !== null)
      .join('\n') + '\n'
  )
}
function codexAuth(): string {
  const p = getActiveProfile('codex')
  return JSON.stringify({ OPENAI_API_KEY: p?.apiKey ?? '' }, null, 2)
}

// ---------- opencode ----------
function opencodeJson(): string {
  const p = getActiveProfile('opencode')
  if (!p?.baseUrl) return JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)
  const model = p.model || 'default'
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        [PROVIDER_ID]: {
          npm: '@ai-sdk/openai-compatible',
          name: p.name || 'AgentLauncher',
          options: { baseURL: p.baseUrl, apiKey: p.apiKey ?? '' },
          models: { [model]: { name: model } }
        }
      },
      model: `${PROVIDER_ID}/${model}`
    },
    null,
    2
  )
}

// ---------- pi ----------
function piModelsJson(): string {
  const p = getActiveProfile('pi')
  if (!p?.baseUrl) return JSON.stringify({ providers: {} }, null, 2)
  const model = p.model || 'default'
  return JSON.stringify(
    {
      providers: {
        [PROVIDER_ID]: {
          baseUrl: p.baseUrl,
          apiKey: p.apiKey ?? '',
          // OpenAI Chat Completions is the most universal relay API.
          api: 'openai-completions',
          models: [{ id: model }]
        }
      }
    },
    null,
    2
  )
}

/** Write a CLI's native config files from its active profile. */
export function writeNativeConfig(cliId: CliId): void {
  const dir = paths.cliConfig(cliId)
  mkdirSync(dir, { recursive: true })
  if (cliId === 'codex') {
    const toml = codexToml()
    if (toml) writeFileSync(join(dir, 'config.toml'), toml)
    writeFileSync(join(dir, 'auth.json'), codexAuth(), { mode: 0o600 })
  } else if (cliId === 'opencode') {
    writeFileSync(join(dir, 'opencode.json'), opencodeJson(), { mode: 0o600 })
  } else if (cliId === 'pi') {
    writeFileSync(join(dir, 'models.json'), piModelsJson(), { mode: 0o600 })
  }
}

function mask(content: string): string {
  // Mask any apiKey / OPENAI_API_KEY value, keeping a short hint.
  return content.replace(
    /("(?:apiKey|OPENAI_API_KEY)"\s*:\s*")([^"]+)(")/g,
    (_m, a, key: string, c) => `${a}${key ? `${key.slice(0, 3)}…${key.slice(-4)}` : ''}${c}`
  )
}

/** The on-disk native config files for display (secrets masked). */
export function readNativeFiles(cliId: CliId): NativeFiles {
  const dir = paths.cliConfig(cliId)
  const names: Record<string, string> =
    cliId === 'codex'
      ? { 'config.toml': codexToml() || '（官方登录模式，无自定义 provider）', 'auth.json': codexAuth() }
      : cliId === 'opencode'
        ? { 'opencode.json': opencodeJson() }
        : cliId === 'pi'
          ? { 'models.json': piModelsJson() }
          : {}
  const files = Object.entries(names).map(([name, generated]) => {
    const full = join(dir, name)
    const content = existsSync(full) ? readFileSync(full, 'utf8') : generated
    return { name, content: mask(content) }
  })
  return { dir, files }
}
