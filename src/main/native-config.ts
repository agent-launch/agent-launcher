import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { getActiveProfile, getAuthMode } from './store'
import { cliConfigDir } from './config-paths'
import type { CliId, NativeFiles } from '@shared/types'

/**
 * Some CLIs aren't configured purely by env vars — they read config FILES from
 * their home dir. We materialize those from the active profile (the way
 * cc-switch does) so launching them actually uses the chosen relay:
 *   - Claude:  settings.json env
 *   - Codex:    config.toml
 *   - opencode: opencode.json (custom provider via @ai-sdk/openai-compatible)
 *   - pi:       models.json (custom provider)
 *   - Hermes:   config.yaml + .env (custom OpenAI-compatible provider)
 */
export function hasNativeConfig(cliId: CliId): boolean {
  return cliId === 'claude-code' || cliId === 'codex' || cliId === 'opencode' || cliId === 'pi' || cliId === 'hermes'
}

const PROVIDER_ID = 'agentlauncher'
const CODEX_MANAGED_START = '# >>> AgentLauncher managed provider >>>'
const CODEX_MANAGED_END = '# <<< AgentLauncher managed provider <<<'
const CODEX_OFFICIAL_SCALARS = ['cli_auth_credentials_store', 'forced_login_method']

function readJsonObject(path: string): Record<string, any> {
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeJsonObject(path: string, data: Record<string, any>): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
}

function envString(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]*$/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function stripCodexManagedBlock(content: string): string {
  const start = content.indexOf(CODEX_MANAGED_START)
  const end = content.indexOf(CODEX_MANAGED_END)
  if (start < 0 || end < start) return content.trimEnd()
  const afterEnd = end + CODEX_MANAGED_END.length
  return `${content.slice(0, start).trimEnd()}\n${content.slice(afterEnd).trimStart()}`.trimEnd()
}

function upsertTomlScalar(content: string, key: string, value: string): string {
  const line = `${key} = ${value}`
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=.*$`, 'm')
  if (re.test(content)) return content.replace(re, line)
  return `${line}\n${content}`.trimEnd()
}

function upsertTopLevelTomlScalar(content: string, key: string, value: string): string {
  const sectionStart = content.search(/^\s*\[/m)
  if (sectionStart < 0) return upsertTomlScalar(content, key, value)
  const before = upsertTomlScalar(content.slice(0, sectionStart), key, value)
  return `${before}${before ? '\n' : ''}${content.slice(sectionStart).trimStart()}`.trimEnd()
}

function removeTomlScalar(content: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return content.replace(new RegExp(`^${escapedKey}\\s*=.*\\n?`, 'm'), '').trimEnd()
}

function removeTopLevelTomlScalar(content: string, key: string): string {
  const sectionStart = content.search(/^\s*\[/m)
  if (sectionStart < 0) return removeTomlScalar(content, key)
  const before = removeTomlScalar(content.slice(0, sectionStart), key)
  return `${before}${before ? '\n' : ''}${content.slice(sectionStart).trimStart()}`.trimEnd()
}

function removeTomlScalarValue(content: string, key: string, value: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return content.replace(new RegExp(`^${escapedKey}\\s*=\\s*${escapedValue}\\s*\\n?`, 'm'), '').trimEnd()
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// ---------- Codex ----------
function codexProviderBlock(): string {
  const p = getActiveProfile('codex')
  if (!p) return ''
  const baseUrl = p.baseUrl?.trim()
  if (!baseUrl) return ''
  const apiKey = p.apiKey?.trim()
  return [
    `[model_providers.${PROVIDER_ID}]`,
    `name = ${tomlString(p.name || 'Custom')}`,
    `base_url = ${tomlString(baseUrl)}`,
    // Codex's native API; most relays support it now.
    'wire_api = "responses"',
    'requires_openai_auth = true',
    apiKey ? `experimental_bearer_token = ${tomlString(apiKey)}` : null
  ]
    .filter((line) => line !== null)
    .join('\n')
}

function hasMeaningfulJsonValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return value !== null && value !== undefined
}

function codexAuthHasLoginMaterial(auth: Record<string, any>): boolean {
  return Object.entries(auth).some(([key, value]) => {
    if (key === 'auth_mode') return false
    if (key === 'OPENAI_API_KEY') return hasMeaningfulJsonValue(value)
    if (typeof value === 'string') return value.trim().length > 0
    return hasMeaningfulJsonValue(value)
  })
}

function codexAuthHasOauthLoginMaterial(auth: Record<string, any>): boolean {
  return Object.entries(auth).some(([key, value]) => {
    if (key === 'auth_mode' || key === 'OPENAI_API_KEY') return false
    return hasMeaningfulJsonValue(value)
  })
}

function codexAuthForActiveProfile(existing: Record<string, any>): Record<string, any> | null {
  const p = getActiveProfile('codex')
  if (p?.baseUrl?.trim()) {
    const apiKey = p.apiKey?.trim()
    // Default behavior is not to preserve official OAuth material while a
    // third-party provider is active. Keep auth.json in the same API-key shape
    // that `codex login --with-api-key` writes, so TUI startup sees auth.
    return apiKey ? { auth_mode: 'apikey', OPENAI_API_KEY: apiKey } : null
  }

  const next = { ...existing }
  delete next.OPENAI_API_KEY
  if (next.auth_mode === 'apikey') {
    if (codexAuthHasOauthLoginMaterial(next)) next.auth_mode = 'chatgpt'
    else delete next.auth_mode
  }
  return codexAuthHasLoginMaterial(next) ? next : null
}

function syncCodexAuth(dir: string): void {
  const path = join(dir, 'auth.json')
  const next = codexAuthForActiveProfile(readJsonObject(path))
  if (next) writeJsonObject(path, next)
  else if (existsSync(path)) unlinkSync(path)
}

function mergeCodexToml(existing: string): string {
  const hadManagedProvider = /^model_provider\s*=\s*"agentlauncher"\s*$/m.test(existing)
  let content = stripCodexManagedBlock(existing)
  const block = codexProviderBlock()
  if (!block) {
    content = removeTomlScalarValue(content, 'model_provider', `"${PROVIDER_ID}"`)
    content = removeTopLevelTomlScalar(content, 'experimental_bearer_token')
    if (hadManagedProvider) content = content.replace(/^model\s*=.*\n?/m, '').trimEnd()
    for (const key of CODEX_OFFICIAL_SCALARS) content = removeTopLevelTomlScalar(content, key)
    return `${content.trimEnd()}\n`
  }
  content = upsertTopLevelTomlScalar(content, 'model_provider', `"${PROVIDER_ID}"`)
  const p = getActiveProfile('codex')
  if (p?.model) content = upsertTopLevelTomlScalar(content, 'model', tomlString(p.model))
  else if (hadManagedProvider) content = removeTopLevelTomlScalar(content, 'model')
  content = removeTopLevelTomlScalar(content, 'experimental_bearer_token')
  for (const key of CODEX_OFFICIAL_SCALARS) content = removeTopLevelTomlScalar(content, key)
  return `${content.trimEnd()}\n\n${CODEX_MANAGED_START}\n${block}\n${CODEX_MANAGED_END}\n`
}

// ---------- opencode ----------
function opencodeConfig(): Record<string, any> {
  const p = getActiveProfile('opencode')
  if (!p?.baseUrl) return { $schema: 'https://opencode.ai/config.json' }
  const model = p.model || 'default'
  return {
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
  }
}

function opencodeJson(): string {
  return JSON.stringify(opencodeConfig(), null, 2)
}

// ---------- pi ----------
function piModelsConfig(): Record<string, any> {
  const p = getActiveProfile('pi')
  if (!p?.baseUrl) return { providers: {} }
  const model = p.model || 'default'
  return {
    providers: {
      [PROVIDER_ID]: {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey ?? '',
        // OpenAI Chat Completions is the most universal relay API.
        api: 'openai-completions',
        models: [{ id: model }]
      }
    }
  }
}

function piModelsJson(): string {
  return JSON.stringify(piModelsConfig(), null, 2)
}

function piSettingsPatch(): Record<string, any> {
  const p = getActiveProfile('pi')
  if (!p?.baseUrl || !p.model) return {}
  return { defaultProvider: PROVIDER_ID, defaultModel: p.model }
}

// ---------- Hermes Agent ----------
const HERMES_MANAGED_START = '# >>> AgentLauncher managed model >>>'
const HERMES_MANAGED_END = '# <<< AgentLauncher managed model <<<'
const HERMES_ENV_MANAGED_START = '# >>> AgentLauncher managed env >>>'
const HERMES_ENV_MANAGED_END = '# <<< AgentLauncher managed env <<<'
const HERMES_MANAGED_API_KEY = 'AGENTLAUNCHER_OPENAI_API_KEY'
const HERMES_MANAGED_MODEL_KEYS = new Set(['provider', 'default', 'model', 'base_url', 'api_key', 'api_mode'])

function stripManagedBlock(content: string, startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker)
  const end = content.indexOf(endMarker)
  if (start < 0 || end < start) return content.trimEnd()
  const afterEnd = end + endMarker.length
  return `${content.slice(0, start).trimEnd()}\n${content.slice(afterEnd).trimStart()}`.trimEnd()
}

function stripHermesManagedBlock(content: string): string {
  return stripManagedBlock(content, HERMES_MANAGED_START, HERMES_MANAGED_END)
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function hermesManagedModelLines(): string[] {
  const p = getActiveProfile('hermes')
  const baseUrl = p?.baseUrl?.trim()
  const model = p?.model?.trim()
  if (!baseUrl && !model) return []
  return [
    `  ${HERMES_MANAGED_START}`,
    `  provider: ${baseUrl ? 'custom' : 'auto'}`,
    model ? `  default: ${yamlString(model)}` : null,
    baseUrl ? `  base_url: ${yamlString(baseUrl)}` : null,
    p?.apiKey?.trim() ? `  api_key: ${yamlString(`\${${HERMES_MANAGED_API_KEY}}`)}` : null,
    baseUrl ? '  api_mode: chat_completions' : null,
    `  ${HERMES_MANAGED_END}`
  ]
    .filter((line): line is string => line !== null)
}

function mergeHermesYaml(existing: string): string {
  const content = stripHermesManagedBlock(existing)
  const managed = hermesManagedModelLines()
  if (!managed.length) return `${content.trimEnd()}\n`

  const lines = content.split(/\r?\n/)
  const modelStart = lines.findIndex((line) => /^model\s*:\s*(?:#.*)?$/.test(line))
  if (modelStart < 0) {
    const prefix = content.trimEnd()
    return `${prefix ? `${prefix}\n\n` : ''}model:\n${managed.join('\n')}\n`
  }

  let modelEnd = lines.length
  for (let i = modelStart + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) {
      modelEnd = i
      break
    }
  }

  const body = lines.slice(modelStart + 1, modelEnd).filter((line) => {
    const match = line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_-]*)\s*:/)
    return !match || !HERMES_MANAGED_MODEL_KEYS.has(match[1])
  })
  return [...lines.slice(0, modelStart + 1), ...managed, ...body, ...lines.slice(modelEnd)]
    .join('\n')
    .trimEnd()
    .concat('\n')
}

function hermesEnvBlock(): string {
  const p = getActiveProfile('hermes')
  const entries: Array<[string, string]> = []
  if (p?.apiKey?.trim()) entries.push([HERMES_MANAGED_API_KEY, p.apiKey.trim()])
  return entries.map(([key, value]) => `${key}=${envString(value)}`).join('\n')
}

function mergeHermesEnv(existing: string): string {
  const content = stripManagedBlock(existing, HERMES_ENV_MANAGED_START, HERMES_ENV_MANAGED_END)
  const block = hermesEnvBlock()
  if (!block) return `${content.trimEnd()}\n`
  const prefix = content.trimEnd()
  return `${prefix ? `${prefix}\n\n` : ''}${HERMES_ENV_MANAGED_START}\n${block}\n${HERMES_ENV_MANAGED_END}\n`
}

function syncHermesEnv(dir: string): void {
  const envPath = join(dir, '.env')
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  writeFileSync(envPath, mergeHermesEnv(existing), { mode: 0o600 })
}

function hermesEnvPreview(): string {
  return hermesEnvBlock()
}

// ---------- Claude Code ----------
function claudeSettingsPatch(): Record<string, any> {
  const p = getActiveProfile('claude-code')
  const env: Record<string, string> = {}
  if (getAuthMode('claude-code') !== 'official') {
    if (p?.baseUrl) env.ANTHROPIC_BASE_URL = p.baseUrl
    if (p?.apiKey) env.ANTHROPIC_AUTH_TOKEN = p.apiKey
    const fallback = p?.model?.trim()
    const defaultModel = p?.defaultModel?.trim() || fallback
    const haikuModel = p?.haikuModel?.trim() || fallback
    const sonnetModel = p?.sonnetModel?.trim() || fallback
    const opusModel = p?.opusModel?.trim() || fallback
    if (defaultModel) env.ANTHROPIC_MODEL = defaultModel
    if (haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haikuModel
    if (sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnetModel
    if (opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = opusModel
  }
  return Object.keys(env).length ? { env } : {}
}

function clearClaudeManagedEnv(env: Record<string, unknown>): Record<string, unknown> {
  const next = { ...env }
  for (const key of [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL'
  ]) {
    delete next[key]
  }
  return next
}

function mergedClaudeSettings(existing: Record<string, any>): Record<string, any> {
  const patch = claudeSettingsPatch()
  const existingEnv =
    existing.env && typeof existing.env === 'object' && !Array.isArray(existing.env)
      ? (existing.env as Record<string, unknown>)
      : {}
  return {
    ...existing,
    env: patch.env ? { ...clearClaudeManagedEnv(existingEnv), ...patch.env } : clearClaudeManagedEnv(existingEnv)
  }
}

/** Write a CLI's native config files from its active profile. */
export function writeNativeConfig(cliId: CliId): void {
  const dir = cliConfigDir(cliId)
  mkdirSync(dir, { recursive: true })
  if (cliId === 'claude-code') {
    const settingsPath = join(dir, 'settings.json')
    writeJsonObject(settingsPath, mergedClaudeSettings(readJsonObject(settingsPath)))
  } else if (cliId === 'codex') {
    const configPath = join(dir, 'config.toml')
    const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
    writeFileSync(configPath, mergeCodexToml(existing), { mode: 0o600 })
    syncCodexAuth(dir)
  } else if (cliId === 'opencode') {
    const configPath = join(dir, 'opencode.json')
    const existing = readJsonObject(configPath)
    const generated = opencodeConfig()
    const existingProvider = objectValue(existing.provider)
    const generatedProvider = objectValue(generated.provider)
    if (!generatedProvider[PROVIDER_ID]) {
      delete existingProvider[PROVIDER_ID]
      if (typeof existing.model === 'string' && existing.model.startsWith(`${PROVIDER_ID}/`)) {
        delete existing.model
      }
    }
    const merged = {
      ...existing,
      ...generated,
      provider: { ...existingProvider, ...generatedProvider }
    }
    writeJsonObject(configPath, merged)
  } else if (cliId === 'pi') {
    const modelsPath = join(dir, 'models.json')
    const existingModels = readJsonObject(modelsPath)
    const generatedModels = piModelsConfig()
    const existingProviders = objectValue(existingModels.providers)
    const generatedProviders = objectValue(generatedModels.providers)
    if (!generatedProviders[PROVIDER_ID]) delete existingProviders[PROVIDER_ID]
    writeJsonObject(modelsPath, {
      ...existingModels,
      ...generatedModels,
      providers: { ...existingProviders, ...generatedProviders }
    })
    const settingsPath = join(dir, 'settings.json')
    const settingsPatch = piSettingsPatch()
    if (Object.keys(settingsPatch).length) {
      writeJsonObject(settingsPath, { ...readJsonObject(settingsPath), ...settingsPatch })
    } else {
      const settings = readJsonObject(settingsPath)
      if (settings.defaultProvider === PROVIDER_ID) {
        delete settings.defaultProvider
        delete settings.defaultModel
        writeJsonObject(settingsPath, settings)
      }
    }
  } else if (cliId === 'hermes') {
    const configPath = join(dir, 'config.yaml')
    const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
    writeFileSync(configPath, mergeHermesYaml(existing), { mode: 0o600 })
    syncHermesEnv(dir)
  }
}

function mask(content: string): string {
  // Mask known API key fields, keeping a short hint.
  return content
    .replace(
      /("(?:apiKey|OPENAI_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY)"\s*:\s*")([^"]+)(")/g,
      (_m, a, key: string, c) => `${a}${key ? `${key.slice(0, 3)}…${key.slice(-4)}` : ''}${c}`
    )
    .replace(
      /^(\s*(?:experimental_bearer_token|api_key|openai_api_key)\s*=\s*")([^"]+)(".*)$/gim,
      (_m, a, key: string, c) => `${a}${key ? `${key.slice(0, 3)}…${key.slice(-4)}` : ''}${c}`
    )
    .replace(
      /^(\s*(?:api_key|openai_api_key|OPENAI_API_KEY|AGENTLAUNCHER_OPENAI_API_KEY)\s*:\s*["']?)([^"'\n#]+)(["']?.*)$/gim,
      (_m, a, key: string, c) => `${a}${key ? `${key.trim().slice(0, 3)}…${key.trim().slice(-4)}` : ''}${c}`
    )
    .replace(
      /^((?:OPENAI_API_KEY|AGENTLAUNCHER_OPENAI_API_KEY)=)(.+)$/gim,
      (_m, a, key: string) => `${a}${key ? `${key.slice(0, 3)}…${key.slice(-4)}` : ''}`
    )
}

/** The on-disk native config files for display (secrets masked). */
export function readNativeFiles(cliId: CliId): NativeFiles {
  const dir = cliConfigDir(cliId)
  const names: Record<string, string> =
    cliId === 'claude-code'
      ? { 'settings.json': JSON.stringify(mergedClaudeSettings(readJsonObject(join(dir, 'settings.json'))), null, 2) }
      : cliId === 'codex'
      ? {
          'config.toml': (() => {
            const full = join(dir, 'config.toml')
            const existing = existsSync(full) ? readFileSync(full, 'utf8') : ''
            return mergeCodexToml(existing) || '（官方登录模式，无自定义 provider）'
          })(),
          'auth.json': (() => {
            const next = codexAuthForActiveProfile(readJsonObject(join(dir, 'auth.json')))
            return next ? JSON.stringify(next, null, 2) : '（未写入 auth.json）'
          })()
        }
      : cliId === 'opencode'
        ? { 'opencode.json': opencodeJson() }
        : cliId === 'pi'
          ? { 'models.json': piModelsJson(), 'settings.json': JSON.stringify(piSettingsPatch(), null, 2) }
          : cliId === 'hermes'
            ? {
                'config.yaml': (() => {
                  const full = join(dir, 'config.yaml')
                  const existing = existsSync(full) ? readFileSync(full, 'utf8') : ''
                  return mergeHermesYaml(existing)
                })(),
                '.env': hermesEnvPreview()
              }
          : {}
  const files = Object.entries(names).map(([name, generated]) => {
    const full = join(dir, name)
    const content = cliId === 'codex' || cliId === 'hermes' ? generated : existsSync(full) ? readFileSync(full, 'utf8') : generated
    return { name, content: mask(content) }
  })
  return { dir, files }
}
