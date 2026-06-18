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
 */
export function hasNativeConfig(cliId: CliId): boolean {
  return cliId === 'claude-code' || cliId === 'codex' || cliId === 'opencode' || cliId === 'pi'
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

// ---------- Claude Code ----------
function claudeSettingsPatch(): Record<string, any> {
  const p = getActiveProfile('claude-code')
  const env: Record<string, string> = {}
  if (getAuthMode('claude-code') !== 'official') {
    if (p?.baseUrl) env.ANTHROPIC_BASE_URL = p.baseUrl
    if (p?.apiKey) env.ANTHROPIC_AUTH_TOKEN = p.apiKey
    if (p?.model) {
      env.ANTHROPIC_MODEL = p.model
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = p.model
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = p.model
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = p.model
    }
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
          : {}
  const files = Object.entries(names).map(([name, generated]) => {
    const full = join(dir, name)
    const content = cliId === 'codex' ? generated : existsSync(full) ? readFileSync(full, 'utf8') : generated
    return { name, content: mask(content) }
  })
  return { dir, files }
}
