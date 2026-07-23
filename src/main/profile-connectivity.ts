import type {
  CliId,
  CliProfilePatch,
  ProfileConnectionCode,
  ProfileConnectionResult
} from '@shared/types'

const DEFAULT_TIMEOUT_MS = 30_000
const TEST_PROMPT = 'Reply with OK.'

function result(
  value: Omit<ProfileConnectionResult, 'kind'>
): ProfileConnectionResult {
  return { kind: 'generation', ...value }
}

function generationUrl(cliId: CliId, baseUrl: string): URL | null {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const basePath = url.pathname.replace(/\/+$/, '')
    const suffix = cliId === 'claude-code'
      ? basePath.endsWith('/v1') ? '/messages' : '/v1/messages'
      : cliId === 'codex' ? '/responses' : '/chat/completions'
    url.pathname = `${basePath}${suffix}` || suffix
    url.search = ''
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function responseCode(status: number): ProfileConnectionCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 402) return 'payment_required'
  if (status === 400 || status === 422) return 'bad_request'
  if (status === 404 || status === 405) return 'unsupported_api'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  return 'http_error'
}

function requestBody(cliId: CliId, model: string): Record<string, unknown> {
  if (cliId === 'claude-code') {
    return {
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: TEST_PROMPT }]
    }
  }
  if (cliId === 'codex') {
    return {
      model,
      input: TEST_PROMPT,
      max_output_tokens: 16,
      stream: false
    }
  }
  return {
    model,
    messages: [{ role: 'user', content: TEST_PROMPT }],
    max_tokens: 1,
    stream: false
  }
}

async function hasExpectedResponse(response: Response, cliId: CliId): Promise<boolean> {
  try {
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
    const record = payload as Record<string, unknown>
    if (cliId === 'claude-code') return Array.isArray(record.content)
    if (cliId === 'codex') return Array.isArray(record.output)
    return Array.isArray(record.choices)
  } catch {
    return false
  }
}

export async function testProfileConnection(
  cliId: CliId,
  profile: CliProfilePatch,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ProfileConnectionResult> {
  const baseUrl = profile.baseUrl?.trim()
  const apiKey = profile.apiKey?.trim()
  const model = (cliId === 'claude-code' ? profile.defaultModel || profile.model : profile.model)?.trim()
  if (!baseUrl || !apiKey || !model) return result({ ok: false, code: 'invalid_config' })

  const url = generationUrl(cliId, baseUrl)
  if (!url) return result({ ok: false, code: 'invalid_url' })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
  if (cliId === 'claude-code') {
    headers['anthropic-version'] = '2023-06-01'
    headers['x-api-key'] = apiKey
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody(cliId, model)),
      redirect: 'manual',
      signal: controller.signal
    })
    if (response.ok) {
      const valid = await hasExpectedResponse(response, cliId)
      return valid
        ? result({ ok: true, code: 'ok', status: response.status })
        : result({ ok: false, code: 'invalid_response', status: response.status })
    }
    return result({ ok: false, code: responseCode(response.status), status: response.status })
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return result({ ok: false, code: 'timeout' })
    }
    return result({ ok: false, code: 'network_error' })
  } finally {
    clearTimeout(timeout)
  }
}
