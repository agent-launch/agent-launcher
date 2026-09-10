import type { ProfileConnectionCode } from '@shared/types'

export function providerResponseCode(status: number): ProfileConnectionCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 402) return 'payment_required'
  if (status === 400 || status === 422) return 'bad_request'
  if (status === 404 || status === 405) return 'unsupported_api'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  return 'http_error'
}

/** Pull a short human-readable message out of an error response body. */
export async function providerErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.text()).trim()
    if (!text) return undefined
    let message = text
    try {
      const payload: unknown = JSON.parse(text)
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const record = payload as Record<string, unknown>
        const error = record.error
        if (
          error &&
          typeof error === 'object' &&
          typeof (error as Record<string, unknown>).message === 'string'
        ) {
          message = (error as Record<string, unknown>).message as string
        } else if (typeof error === 'string') {
          message = error
        } else if (typeof record.message === 'string') {
          message = record.message
        }
      }
    } catch {
      // Not JSON; keep the raw text.
    }
    message = message.replace(/\s+/g, ' ').trim()
    if (!message) return undefined
    return message.length > 300 ? `${message.slice(0, 300)}…` : message
  } catch {
    return undefined
  }
}
