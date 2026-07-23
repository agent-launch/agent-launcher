import { afterEach, describe, expect, it, vi } from 'vitest'
import { testProfileConnection } from '../../src/main/profile-connectivity'

describe('profile connectivity test', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends a real Codex Responses request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"output":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(testProfileConnection('codex', {
      baseUrl: 'https://relay.example/api/v1/',
      apiKey: 'sk-openai',
      model: 'gpt-test'
    })).resolves.toEqual({ kind: 'generation', ok: true, code: 'ok', status: 200 })
    expect(fetchMock).toHaveBeenLastCalledWith(
      new URL('https://relay.example/api/v1/responses'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-openai',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          model: 'gpt-test',
          input: 'Reply with OK.',
          max_output_tokens: 16,
          stream: false
        }),
        redirect: 'manual'
      })
    )
  })

  it('sends real Anthropic Messages and OpenAI Chat Completions requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"content":[]}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"choices":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(testProfileConnection('claude-code', {
      baseUrl: 'https://relay.example/anthropic',
      apiKey: 'sk-anthropic',
      defaultModel: 'claude-test'
    })).resolves.toEqual({ kind: 'generation', ok: true, code: 'ok', status: 200 })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL('https://relay.example/anthropic/v1/messages'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-anthropic',
          'anthropic-version': '2023-06-01',
          'x-api-key': 'sk-anthropic'
        }),
        body: JSON.stringify({
          model: 'claude-test',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Reply with OK.' }]
        })
      })
    )

    await expect(testProfileConnection('opencode', {
      baseUrl: 'https://relay.example/v1',
      apiKey: 'sk-openai',
      model: 'chat-test'
    })).resolves.toEqual({ kind: 'generation', ok: true, code: 'ok', status: 200 })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL('https://relay.example/v1/chat/completions'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'chat-test',
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 1,
          stream: false
        })
      })
    )
  })

  it.each([
    [401, 'unauthorized'],
    [402, 'payment_required'],
    [403, 'forbidden'],
    [400, 'bad_request'],
    [404, 'unsupported_api'],
    [405, 'unsupported_api'],
    [422, 'bad_request'],
    [429, 'rate_limited'],
    [503, 'server_error'],
    [418, 'http_error']
  ] as const)('maps HTTP %s to %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))
    await expect(testProfileConnection('codex', {
      baseUrl: 'https://relay.example/v1',
      apiKey: 'secret',
      model: 'test-model'
    })).resolves.toEqual({ kind: 'generation', ok: false, code, status })
  })

  it('rejects missing, malformed, and non-HTTP configuration without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(testProfileConnection('codex', { baseUrl: '', apiKey: '' }))
      .resolves.toEqual({ kind: 'generation', ok: false, code: 'invalid_config' })
    await expect(testProfileConnection('codex', {
      baseUrl: 'file:///tmp/key',
      apiKey: 'secret',
      model: 'test-model'
    }))
      .resolves.toEqual({ kind: 'generation', ok: false, code: 'invalid_url' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a successful HTTP response with an incompatible body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    await expect(testProfileConnection('codex', {
      baseUrl: 'https://relay.example/v1',
      apiKey: 'secret',
      model: 'test-model'
    })).resolves.toEqual({ kind: 'generation', ok: false, code: 'invalid_response', status: 200 })
  })

  it('distinguishes timeouts from other network errors', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))

    const pending = testProfileConnection('codex', {
      baseUrl: 'https://relay.example/v1',
      apiKey: 'secret',
      model: 'test-model'
    }, 20)
    await vi.advanceTimersByTimeAsync(21)
    await expect(pending).resolves.toEqual({ kind: 'generation', ok: false, code: 'timeout' })

    vi.useRealTimers()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(testProfileConnection('codex', {
      baseUrl: 'https://relay.example/v1',
      apiKey: 'secret',
      model: 'test-model'
    })).resolves.toEqual({ kind: 'generation', ok: false, code: 'network_error' })
  })
})
