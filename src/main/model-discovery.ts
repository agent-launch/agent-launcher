import { providerErrorDetail, providerResponseCode } from './provider-http'
import type {
  CliId,
  DiscoveredModel,
  ModelDiscoveryRequest,
  ModelDiscoveryResult
} from '@shared/types'

const DEFAULT_TIMEOUT_MS = 10_000

function result(value: Omit<ModelDiscoveryResult, 'models'> & { models?: DiscoveredModel[] }) {
  return value
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** Derive the common discovery endpoint while preserving Base URL query parameters. */
export function modelDiscoveryUrl(
  cliId: CliId,
  baseUrl: string,
  explicitModelsUrl?: string
): URL | null {
  const base = httpUrl(baseUrl)
  if (!base) return null

  const explicit = explicitModelsUrl?.trim() ? httpUrl(explicitModelsUrl.trim()) : null
  if (explicit?.origin === base.origin) {
    explicit.hash = ''
    return explicit
  }

  const path = base.pathname.replace(/\/+$/, '')
  const versionPath = /\/v\d+(?:beta\d*)?$/i.test(path)
  if (versionPath) {
    base.pathname = `${path}/models`
  } else {
    const suffix = cliId === 'gemini' ? '/v1beta/models' : '/v1/models'
    base.pathname = `${path}${suffix}` || suffix
  }
  base.hash = ''
  return base
}

function isGeminiNativeModelsUrl(url: URL): boolean {
  return /\/v1beta\/models\/?$/i.test(url.pathname)
}

function geminiOpenAIModelsUrl(baseUrl: string, explicitModelsUrl?: string): URL | null {
  if (explicitModelsUrl?.trim()) return null
  const base = httpUrl(baseUrl)
  if (!base) return null
  const path = base.pathname.replace(/\/+$/, '')
  base.pathname = /\/v1beta$/i.test(path)
    ? `${path.replace(/\/v1beta$/i, '/v1')}/models`
    : /\/v1$/i.test(path)
      ? `${path}/models`
      : `${path}/v1/models`
  base.hash = ''
  return base
}

function discoveryHeaders(
  cliId: CliId,
  apiKey: string,
  geminiNative: boolean
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (cliId === 'claude-code') {
    headers.Authorization = `Bearer ${apiKey}`
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (cliId === 'gemini' && geminiNative) {
    // Auth is carried by the `?key=` query parameter set in discoverModels.
  } else {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

function recordString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

/** Parse common OpenAI, Anthropic, Gemini, and relay model-list shapes. */
export function parseModelDiscoveryResponse(payload: unknown, cliId: CliId): DiscoveredModel[] {
  const source = (() => {
    if (Array.isArray(payload)) return { list: payload, openAI: false }
    if (!payload || typeof payload !== 'object') return null
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) return { list: record.data, openAI: true }
    if (Array.isArray(record.models)) return { list: record.models, openAI: false }
    return null
  })()
  if (!source) return []

  const models: DiscoveredModel[] = []
  const seen = new Set<string>()
  for (const item of source.list) {
    if (typeof item === 'string') {
      const id = item.trim()
      if (cliId === 'gemini' && source.openAI && !/(^|\/)gemini-/i.test(id)) continue
      if (id && !seen.has(id)) {
        seen.add(id)
        models.push({ id, name: id })
      }
      continue
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue

    const record = item as Record<string, unknown>
    const rawId = recordString(record, 'id', 'slug') ?? recordString(record, 'name')
    if (!rawId) continue
    if (cliId === 'gemini' && source.openAI && !/(^|\/)gemini-/i.test(rawId)) continue
    const id = cliId === 'gemini' ? rawId.replace(/^models\//, '') : rawId
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = recordString(record, 'display_name', 'displayName', 'name') ?? id
    models.push({ id, name: cliId === 'gemini' ? name.replace(/^models\//, '') : name })
  }
  return models
}

export async function discoverModels(
  cliId: CliId,
  request: ModelDiscoveryRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ModelDiscoveryResult> {
  const baseUrl = request.baseUrl?.trim()
  const apiKey = request.apiKey?.trim()
  if (!baseUrl || !apiKey) return result({ ok: false, code: 'invalid_config' })

  const url = modelDiscoveryUrl(cliId, baseUrl, request.modelsUrl)
  if (!url) return result({ ok: false, code: 'invalid_url' })
  const fallbackUrl =
    cliId === 'gemini' && isGeminiNativeModelsUrl(url)
      ? geminiOpenAIModelsUrl(baseUrl, request.modelsUrl)
      : null
  const urls = fallbackUrl ? [url, fallbackUrl] : [url]

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (const [index, candidate] of urls.entries()) {
      const geminiNative = cliId === 'gemini' && isGeminiNativeModelsUrl(candidate)
      if (geminiNative) candidate.searchParams.set('key', apiKey)

      const response = await fetch(candidate, {
        method: 'GET',
        headers: discoveryHeaders(cliId, apiKey, geminiNative),
        redirect: 'manual',
        signal: controller.signal
      })
      if (!response.ok) {
        if (response.status === 404 && index < urls.length - 1) continue
        return result({
          ok: false,
          code: providerResponseCode(response.status),
          status: response.status,
          detail: await providerErrorDetail(response)
        })
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return result({ ok: false, code: 'invalid_response', status: response.status })
      }
      const models = parseModelDiscoveryResponse(payload, cliId)
      if (models.length) {
        return result({ ok: true, code: 'ok', status: response.status, models })
      }
      return result({ ok: false, code: 'invalid_response', status: response.status })
    }
    return result({ ok: false, code: 'invalid_response' })
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return result({ ok: false, code: 'timeout' })
    }
    return result({ ok: false, code: 'network_error' })
  } finally {
    clearTimeout(timeout)
  }
}
