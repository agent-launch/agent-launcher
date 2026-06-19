import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addProfile, getPrefs, loadConfig, markSystemConfigImportChecked, setActiveProfile } from './store'
import { systemCliConfigDir } from './config-paths'
import type { CliId, CliProfilePatch } from '@shared/types'

const CLI_IDS: CliId[] = ['claude-code', 'codex', 'opencode', 'pi', 'hermes']

function hasApiProfile(cliId: CliId): boolean {
  return loadConfig().clis[cliId].profiles.some((profile) => {
    if (profile.providerId === 'official' && !profile.baseUrl?.trim() && !profile.apiKey?.trim()) return false
    return Boolean(profile.baseUrl?.trim() || profile.apiKey?.trim() || (profile.providerId && profile.providerId !== 'official'))
  })
}

function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

function readJsonObject(path: string): Record<string, any> | null {
  const text = readText(path)
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function objectValue(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : undefined
}

function readDotenv(path: string): Record<string, string> {
  const text = readText(path)
  if (!text) return {}
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[match[1]] = value
  }
  return out
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const s = stringValue(value)
    if (s) return s
  }
  return undefined
}

function inferProviderId(baseUrl?: string): string {
  if (!baseUrl) return 'custom'
  const host = baseUrl.toLowerCase()
  if (host.includes('shengsuanyun')) return 'shengsuanyun'
  if (host.includes('pateway')) return 'patewayai'
  if (host.includes('deepseek')) return 'deepseek'
  if (host.includes('bigmodel') || host.includes('z.ai')) return 'zhipu'
  if (host.includes('qianfan') || host.includes('baidubce')) return 'qianfan'
  if (host.includes('dashscope') || host.includes('aliyuncs')) return 'bailian'
  if (host.includes('moonshot') || host.includes('kimi')) return 'kimi'
  if (host.includes('stepfun')) return 'stepfun'
  if (host.includes('modelscope')) return 'modelscope'
  if (host.includes('longcat')) return 'longcat'
  if (host.includes('minimax')) return 'minimax'
  if (host.includes('aihubmix')) return 'aihubmix'
  if (host.includes('siliconflow')) return 'siliconflow'
  if (host.includes('dmxapi')) return 'dmxapi'
  if (host.includes('packyapi')) return 'packycode'
  if (host.includes('apikey.fun')) return 'apikeyfun'
  if (host.includes('apinebula')) return 'apinebula'
  if (host.includes('atlascloud')) return 'atlascloud'
  if (host.includes('sudocode')) return 'sudocode'
  if (host.includes('claudecn')) return 'claudecn'
  if (host.includes('runapi')) return 'runapi'
  if (host.includes('cubence')) return 'cubence'
  if (host.includes('crazyrouter')) return 'crazyrouter'
  if (host.includes('ctok.ai')) return 'ctok'
  if (host.includes('pipellm')) return 'pipellm'
  if (host.includes('openrouter')) return 'openrouter'
  if (host.includes('therouter')) return 'therouter'
  if (host.includes('novita')) return 'novita'
  return 'custom'
}

function importedProfile(name: string, baseUrl?: string, apiKey?: string, model?: string): CliProfilePatch | null {
  if (!baseUrl && !apiKey) return null
  return {
    name,
    providerId: inferProviderId(baseUrl),
    baseUrl,
    apiKey,
    model
  }
}

function importClaudeProfile(): CliProfilePatch | null {
  const settings = readJsonObject(join(systemCliConfigDir('claude-code'), 'settings.json'))
  const env = objectValue(settings?.env)
  return importedProfile(
    '本机默认配置',
    firstString(env?.ANTHROPIC_BASE_URL),
    firstString(env?.ANTHROPIC_AUTH_TOKEN, env?.ANTHROPIC_API_KEY),
    firstString(
      env?.ANTHROPIC_MODEL,
      env?.ANTHROPIC_DEFAULT_OPUS_MODEL,
      env?.ANTHROPIC_DEFAULT_SONNET_MODEL,
      env?.ANTHROPIC_DEFAULT_HAIKU_MODEL
    )
  )
}

function unquoteToml(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed.replace(/^'|'$/g, '')
}

function topLevelTomlValue(content: string, key: string): string | undefined {
  const sectionStart = content.search(/^\s*\[/m)
  const top = sectionStart >= 0 ? content.slice(0, sectionStart) : content
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = top.match(new RegExp(`^\\s*${escaped}\\s*=\\s*(.+?)\\s*(?:#.*)?$`, 'm'))
  return match ? unquoteToml(match[1]) : undefined
}

function tomlSection(content: string, section: string): string | undefined {
  const lines = content.split(/\r?\n/)
  const out: string[] = []
  let active = false
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)
    if (header) {
      if (active) break
      active = header[1].trim() === section
      continue
    }
    if (active) out.push(line)
  }
  return active || out.length ? out.join('\n') : undefined
}

function importCodexProfile(): CliProfilePatch | null {
  const dir = systemCliConfigDir('codex')
  const config = readText(join(dir, 'config.toml')) ?? ''
  const auth = readJsonObject(join(dir, 'auth.json'))
  const providerId = topLevelTomlValue(config, 'model_provider')
  const section = providerId ? tomlSection(config, `model_providers.${providerId}`) : undefined
  const configuredBaseUrl = section ? topLevelTomlValue(section, 'base_url') : undefined
  const apiKey = firstString(
    section ? topLevelTomlValue(section, 'experimental_bearer_token') : undefined,
    auth?.OPENAI_API_KEY
  )
  const baseUrl = configuredBaseUrl || (apiKey ? 'https://api.openai.com/v1' : undefined)
  const model = topLevelTomlValue(config, 'model')
  return importedProfile('本机默认配置', baseUrl, apiKey, model)
}

function importOpencodeProfile(): CliProfilePatch | null {
  const config = readJsonObject(join(systemCliConfigDir('opencode'), 'opencode.json'))
  const providers = objectValue(config?.provider)
  if (!providers) return null
  const selected = stringValue(config?.model)?.split('/')[0]
  const entries = Object.entries(providers)
  const [id, provider] =
    entries.find(([key]) => key === selected) ??
    entries.find(([, value]) => !!objectValue(value)?.options) ??
    entries[0] ??
    []
  const providerObject = objectValue(provider)
  if (!id || !providerObject) return null
  const options = objectValue(providerObject.options)
  const models = objectValue(providerObject.models)
  const selectedModel = stringValue(config?.model)?.startsWith(`${id}/`) ? stringValue(config?.model)?.slice(id.length + 1) : undefined
  const model = selectedModel || Object.keys(models ?? {})[0]
  return importedProfile(
    stringValue(providerObject.name) || '本机默认配置',
    firstString(options?.baseURL, options?.baseUrl, options?.base_url),
    firstString(options?.apiKey, options?.api_key),
    model
  )
}

function importPiProfile(): CliProfilePatch | null {
  const dir = systemCliConfigDir('pi')
  const models = readJsonObject(join(dir, 'models.json'))
  const settings = readJsonObject(join(dir, 'settings.json'))
  const providers = objectValue(models?.providers)
  if (!providers) return null
  const preferred = stringValue(settings?.defaultProvider)
  const entries = Object.entries(providers)
  const [id, provider] = entries.find(([key]) => key === preferred) ?? entries[0] ?? []
  const providerObject = objectValue(provider)
  if (!id || !providerObject) return null
  const modelList = Array.isArray(providerObject.models) ? providerObject.models : []
  const firstModel = objectValue(modelList[0])
  return importedProfile(
    '本机默认配置',
    firstString(providerObject.baseUrl, providerObject.baseURL, providerObject.base_url),
    firstString(providerObject.apiKey, providerObject.api_key),
    firstString(settings?.defaultModel, firstModel?.id)
  )
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim().replace(/\s+#.*$/, '').trim()
  if (!trimmed) return ''
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function topLevelYamlBlock(content: string, key: string): string {
  const lines = content.split(/\r?\n/)
  const out: string[] = []
  let active = false
  for (const line of lines) {
    if (!active) {
      if (new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(?:#.*)?$`).test(line)) {
        active = true
      }
      continue
    }
    if (/^\S/.test(line)) break
    out.push(line)
  }
  return out.join('\n')
}

function yamlBlockValue(block: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = block.match(new RegExp(`^\\s+${escaped}\\s*:\\s*(.+?)\\s*$`, 'm'))
  return match ? unquoteYaml(match[1]) : undefined
}

function importHermesProfile(): CliProfilePatch | null {
  const dir = systemCliConfigDir('hermes')
  const config = readText(join(dir, 'config.yaml')) ?? ''
  const env = readDotenv(join(dir, '.env'))
  const modelBlock = topLevelYamlBlock(config, 'model')
  const baseUrl = firstString(yamlBlockValue(modelBlock, 'base_url'), env.OPENAI_BASE_URL)
  const configApiKey = yamlBlockValue(modelBlock, 'api_key')
  const apiKeyEnvMatch = configApiKey?.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)
  const apiKey = firstString(
    apiKeyEnvMatch ? env[apiKeyEnvMatch[1]] : configApiKey,
    env.AGENTLAUNCHER_OPENAI_API_KEY,
    env.OPENAI_API_KEY
  )
  const model = firstString(yamlBlockValue(modelBlock, 'default'), yamlBlockValue(modelBlock, 'model'))
  const provider = yamlBlockValue(modelBlock, 'provider')
  if (!baseUrl && !apiKey && !model && !provider) return null
  return {
    name: '本机 Hermes 配置',
    providerId: baseUrl ? inferProviderId(baseUrl) : provider || 'custom',
    baseUrl,
    apiKey,
    model
  }
}

function readExistingProfile(cliId: CliId): CliProfilePatch | null {
  if (cliId === 'claude-code') return importClaudeProfile()
  if (cliId === 'codex') return importCodexProfile()
  if (cliId === 'opencode') return importOpencodeProfile()
  if (cliId === 'pi') return importPiProfile()
  if (cliId === 'hermes') return importHermesProfile()
  return null
}

function ensureOneCliImported(cliId: CliId): boolean {
  if (getPrefs(cliId).systemConfigImportChecked || hasApiProfile(cliId)) return false

  const profile = readExistingProfile(cliId)
  markSystemConfigImportChecked(cliId)
  if (!profile) return false

  const cfg = addProfile(cliId, profile)
  const created = cfg.clis[cliId].profiles.at(-1)
  if (created) setActiveProfile(cliId, created.id)
  return true
}

export function ensureSystemConfigImported(): void {
  for (const cliId of CLI_IDS) {
    try {
      ensureOneCliImported(cliId)
    } catch {
      markSystemConfigImportChecked(cliId)
    }
  }
}
