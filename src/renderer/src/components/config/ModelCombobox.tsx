import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Loader2, Search } from 'lucide-react'
import { useModelDiscovery } from './useModelDiscovery'
import { useT } from '@/i18n'
import type { CliId, ModelDiscoveryRequest } from '@shared/types'

export function ModelCombobox({
  cliId,
  request,
  value,
  onChange,
  placeholder
}: {
  cliId: CliId
  request: ModelDiscoveryRequest
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const t = useT()
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = `${id}-listbox`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const { models, fetching, error, fetch } = useModelDiscovery(cliId, request)

  // Filter by the current query (matches id or display name).
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = normalizedQuery
    ? models.filter(
        (model) =>
          model.id.toLowerCase().includes(normalizedQuery) ||
          model.name.toLowerCase().includes(normalizedQuery)
      )
    : models

  const openDropdown = async () => {
    if (!request.baseUrl?.trim() || !request.apiKey?.trim()) return
    setOpen(true)
    await fetch()
  }

  const select = (modelId: string) => {
    onChange(modelId)
    setQuery(modelId)
    setOpen(false)
    inputRef.current?.blur()
  }

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // Reset the query to the controlled value when the dropdown closes.
  useEffect(() => {
    if (!open) setQuery(value)
  }, [open, value])

  const canFetch = Boolean(request.baseUrl?.trim() && request.apiKey?.trim())
  const emptyMessage = error
    ? `${t(`config.modelDiscovery.${error.code}`) ?? error.code}${error.detail ? ` - ${error.detail}` : ''}`
    : t('config.modelDiscovery.empty')

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          value={open ? query : value}
          onChange={(event) => {
            const next = event.target.value
            setQuery(next)
            onChange(next)
            if (!open) setOpen(true)
          }}
          onFocus={() => {
            setQuery(value)
            if (canFetch) void openDropdown()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          className="selectable h-10 w-full rounded-md border border-border-weak bg-surface px-3 pr-9 text-[13px] text-text-strong outline-none focus:border-border-selected"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            if (open) {
              setOpen(false)
            } else {
              setQuery(value)
              void openDropdown()
              inputRef.current?.focus()
            }
          }}
          disabled={!canFetch}
          className="absolute right-0 top-0 grid h-10 w-9 place-items-center text-text-weak hover:text-text-strong disabled:pointer-events-none disabled:opacity-35"
          aria-label={open ? t('common.close') : t('config.modelDiscovery.open')}
        >
          {fetching ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ChevronDown
              size={14}
              className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            />
          )}
        </button>
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute top-[calc(100%+6px)] z-50 w-full overflow-hidden rounded-lg border border-border-weak bg-stronger p-1 text-[13px] shadow-[0_8px_18px_rgba(0,0,0,0.08),0_1px_4px_rgba(0,0,0,0.05)]"
        >
          {fetching && !models.length ? (
            <div className="flex items-center gap-2 px-3 py-6 text-text-weak">
              <Loader2 size={13} className="animate-spin" />
              <span>{t('config.modelDiscovery.fetching')}</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-5 text-center text-[12px] text-text-weak">
              <Search size={14} className="mx-auto mb-1.5" />
              {emptyMessage}
            </div>
          ) : (
            <div className="max-h-[260px] overflow-y-auto">
              {filtered.map((model) => {
                const active = value === model.id
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => select(model.id)}
                    className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                      active
                        ? 'bg-[var(--button-primary-base)] text-[var(--button-primary-text)] shadow-[var(--shadow-sm)]'
                        : 'text-text-base hover:bg-selection hover:text-text-strong'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px]">{model.name}</span>
                    {model.name !== model.id && (
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-weak">
                        {model.id}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
