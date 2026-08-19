import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/i18n'
import type { CliId, DiscoveredModel, ModelDiscoveryRequest } from '@shared/types'

export function ModelDiscoveryPicker({
  cliId,
  request,
  currentModel,
  onSelect
}: {
  cliId: CliId
  request: ModelDiscoveryRequest
  currentModel: string
  onSelect: (model: string) => void
}) {
  const t = useT()
  const requestRef = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const [fetching, setFetching] = useState(false)
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<DiscoveredModel[]>([])
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const signature = JSON.stringify([
    cliId,
    request.baseUrl?.trim(),
    request.apiKey?.trim(),
    request.modelsUrl?.trim()
  ])

  useEffect(() => {
    requestRef.current += 1
    setFetching(false)
  }, [signature])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return models
    return models.filter(
      (model) =>
        model.id.toLowerCase().includes(normalized) || model.name.toLowerCase().includes(normalized)
    )
  }, [models, query])

  const fetchModels = async () => {
    if (!request.baseUrl?.trim()) {
      toast.error(t('config.baseUrlRequiredToast'))
      return
    }
    if (!request.apiKey?.trim()) {
      toast.error(t('config.apiKeyRequiredToast'))
      return
    }

    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setFetching(true)
    try {
      const result = await window.api.config.listModels(cliId, request)
      if (requestRef.current !== requestId) return
      if (!result.ok || !result.models?.length) {
        const message = `${t(`config.modelDiscovery.${result.code}`)}${result.detail ? ` - ${result.detail}` : ''}`
        toast.error(message)
        return
      }
      const current = currentModel.trim()
      setModels(result.models)
      setSelected(result.models.some((model) => model.id === current) ? current : '')
      setQuery('')
      setOpen(true)
    } catch {
      if (requestRef.current === requestId) {
        toast.error(t('config.modelDiscovery.network_error'))
      }
    } finally {
      if (requestRef.current === requestId) setFetching(false)
    }
  }

  const confirm = () => {
    if (!selected) return
    onSelect(selected)
    setOpen(false)
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={fetchModels} disabled={fetching}>
        {fetching ? <LoaderCircle className="animate-spin" size={13} /> : <RefreshCw size={13} />}
        {fetching ? t('config.modelDiscovery.fetching') : t('config.modelDiscovery.fetch')}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('config.modelDiscovery.title')}
        initialFocusRef={searchRef}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={confirm} disabled={!selected}>
              <Check size={13} />
              {t('config.modelDiscovery.use')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-[12px] text-text-weak">
          {t('config.modelDiscovery.count', { count: models.length })}
        </p>
        <label className="relative block">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('config.modelDiscovery.search')}
            className="selectable h-9 w-full rounded-md border border-border-weak bg-surface pl-9 pr-3 text-[13px] text-text-strong outline-none focus:border-border-selected"
          />
        </label>

        <div
          role="listbox"
          className="mt-3 max-h-[340px] overflow-y-auto rounded-md border border-border-weak bg-surface/72 p-1"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-text-weak">
              {t('config.modelDiscovery.empty')}
            </div>
          ) : (
            filtered.map((model) => {
              const active = selected === model.id
              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => setSelected(model.id)}
                  onDoubleClick={() => {
                    onSelect(model.id)
                    setOpen(false)
                  }}
                  className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                    active
                      ? 'bg-selection text-text-strong'
                      : 'text-text-base hover:bg-surface-hover hover:text-text-strong'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{model.name}</span>
                    {model.name !== model.id ? (
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-text-weak">
                        {model.id}
                      </span>
                    ) : null}
                  </span>
                  <span className="grid size-5 shrink-0 place-items-center text-text-strong">
                    {active ? <Check size={14} strokeWidth={2.5} /> : null}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </Modal>
    </>
  )
}
