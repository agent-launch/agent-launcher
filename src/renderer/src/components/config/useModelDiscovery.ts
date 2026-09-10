import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CliId,
  DiscoveredModel,
  ModelDiscoveryRequest,
  ProfileConnectionCode
} from '@shared/types'

export interface ModelDiscoveryError {
  code: ProfileConnectionCode
  detail?: string
}

export interface ModelDiscoveryFetchResult {
  ok: boolean
  error?: ModelDiscoveryError
}

export interface UseModelDiscoveryResult {
  models: DiscoveredModel[]
  fetching: boolean
  error: ModelDiscoveryError | null
  fetch: () => Promise<ModelDiscoveryFetchResult>
  reset: () => void
}

/** Shared model-discovery state + fetch for any UI surface (modal picker or
 * inline combobox). Refetches only when the request identity changes. */
export function useModelDiscovery(
  cliId: CliId,
  request: ModelDiscoveryRequest
): UseModelDiscoveryResult {
  const requestRef = useRef(0)
  const [models, setModels] = useState<DiscoveredModel[]>([])
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<ModelDiscoveryError | null>(null)

  const baseUrl = request.baseUrl?.trim()
  const apiKey = request.apiKey?.trim()
  const modelsUrl = request.modelsUrl?.trim()
  const signature = JSON.stringify([cliId, baseUrl, apiKey, modelsUrl])

  useEffect(() => {
    requestRef.current += 1
    setModels([])
    setFetching(false)
    setError(null)
  }, [signature])

  const fetch = useCallback(async (): Promise<ModelDiscoveryFetchResult> => {
    if (!baseUrl || !apiKey) {
      setError(null)
      return { ok: false }
    }

    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setFetching(true)
    setError(null)
    try {
      const result = await window.api.config.listModels(cliId, { baseUrl, apiKey, modelsUrl })
      if (requestRef.current !== requestId) return { ok: false }
      if (!result.ok || !result.models?.length) {
        const err = { code: result.code, detail: result.detail }
        setModels([])
        setError(err)
        return { ok: false, error: err }
      }
      setModels(result.models)
      return { ok: true }
    } catch {
      const err = { code: 'network_error' as const }
      if (requestRef.current === requestId) {
        setModels([])
        setError(err)
      }
      return { ok: false, error: err }
    } finally {
      if (requestRef.current === requestId) setFetching(false)
    }
  }, [cliId, baseUrl, apiKey, modelsUrl])

  const reset = useCallback(() => {
    requestRef.current += 1
    setModels([])
    setFetching(false)
    setError(null)
  }, [])

  return { models, fetching, error, fetch, reset }
}
