import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  discoverModels,
  modelDiscoveryUrl,
  parseModelDiscoveryResponse
} from '../../src/main/model-discovery'

describe('provider model discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('derives OpenAI and Gemini model endpoints while preserving query parameters', () => {
    expect(modelDiscoveryUrl('codex', 'https://relay.example/api/v1/?tenant=one')?.toString()).toBe(
      'https://relay.example/api/v1/models?tenant=one'
    )
    expect(modelDiscoveryUrl('codex', 'https://relay.example/api')?.toString()).toBe(
      'https://relay.example/api/v1/models'
    )
    expect(modelDiscoveryUrl('gemini', 'https://gemini.example/gateway')?.toString()).toBe(
      'https://gemini.example/gateway/v1beta/models'
    )
  })

  it('only accepts an explicit model endpoint on the Base URL origin', () => {
    expect(
      modelDiscoveryUrl(
        'claude-code',
        'https://router-link-beta.world3.ai/api',
        'https://router-link-beta.world3.ai/api/v1/models'
      )?.toString()
    ).toBe('https://router-link-beta.world3.ai/api/v1/models')
    expect(
      modelDiscoveryUrl(
        'claude-code',
        'https://api.moonshot.cn/anthropic',
        'https://api.moonshot.cn/v1/models'
      )?.toString()
    ).toBe('https://api.moonshot.cn/v1/models')
    expect(
      modelDiscoveryUrl(
        'claude-code',
        'https://relay.example/anthropic',
        'https://credentials.example/models'
      )?.toString()
    ).toBe('https://relay.example/anthropic/v1/models')
  })

  it('parses and deduplicates OpenAI, Anthropic, and string model lists', () => {
    expect(
      parseModelDiscoveryResponse(
        {
          data: [
            { id: 'model-b', display_name: 'Model B' },
            { id: 'model-a', name: 'Model A' },
            { id: 'model-a' },
            'model-c'
          ]
        },
        'codex'
      )
    ).toEqual([
      { id: 'model-b', name: 'Model B' },
      { id: 'model-a', name: 'Model A' },
      { id: 'model-c', name: 'model-c' }
    ])
    expect(parseModelDiscoveryResponse({ models: [{ slug: 'glm-test' }] }, 'codex')).toEqual([
      { id: 'glm-test', name: 'glm-test' }
    ])
  })

  it('normalizes Gemini resource names and display names', () => {
    expect(
      parseModelDiscoveryResponse(
        { models: [{ name: 'models/gemini-test', displayName: 'Gemini Test' }] },
        'gemini'
      )
    ).toEqual([{ id: 'gemini-test', name: 'Gemini Test' }])
  })

  it('uses protocol-specific authentication headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"data":[{"id":"claude-test"}]}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response('{"models":[{"name":"models/gemini-test"}]}', { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)

    await discoverModels('claude-code', {
      baseUrl: 'https://anthropic.example',
      apiKey: 'sk-claude'
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL('https://anthropic.example/v1/models'),
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-claude',
          'x-api-key': 'sk-claude',
          'anthropic-version': '2023-06-01'
        })
      })
    )

    await discoverModels('gemini', {
      baseUrl: 'https://gemini.example',
      apiKey: 'gemini-key'
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL('https://gemini.example/v1beta/models?key=gemini-key'),
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' })
      })
    )
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('Authorization')
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('x-goog-api-key')
  })

  it('returns discovered models and structured HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{"data":[{"id":"gpt-test"}]}', { status: 200 }))
        .mockResolvedValueOnce(new Response('{"error":{"message":"bad key"}}', { status: 401 }))
    )
    await expect(
      discoverModels('codex', {
        baseUrl: 'https://relay.example/v1',
        apiKey: 'secret'
      })
    ).resolves.toEqual({
      ok: true,
      code: 'ok',
      status: 200,
      models: [{ id: 'gpt-test', name: 'gpt-test' }]
    })
    await expect(
      discoverModels('codex', {
        baseUrl: 'https://relay.example/v1',
        apiKey: 'bad'
      })
    ).resolves.toEqual({
      ok: false,
      code: 'unauthorized',
      status: 401,
      detail: 'bad key'
    })
  })

  it('rejects invalid input and unrecognized successful responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(discoverModels('codex', { baseUrl: '', apiKey: '' })).resolves.toEqual({
      ok: false,
      code: 'invalid_config'
    })
    await expect(
      discoverModels('codex', { baseUrl: 'file:///tmp/models', apiKey: 'secret' })
    ).resolves.toEqual({ ok: false, code: 'invalid_url' })
    await expect(
      discoverModels('codex', { baseUrl: 'https://relay.example/v1', apiKey: 'secret' })
    ).resolves.toEqual({ ok: false, code: 'invalid_response', status: 200 })
  })

  it('distinguishes discovery timeouts from network failures', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
      )
    )
    const pending = discoverModels(
      'codex',
      { baseUrl: 'https://relay.example/v1', apiKey: 'secret' },
      20
    )
    await vi.advanceTimersByTimeAsync(21)
    await expect(pending).resolves.toEqual({ ok: false, code: 'timeout' })

    vi.useRealTimers()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(
      discoverModels('codex', { baseUrl: 'https://relay.example/v1', apiKey: 'secret' })
    ).resolves.toEqual({ ok: false, code: 'network_error' })
  })
})
