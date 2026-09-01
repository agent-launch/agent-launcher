import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'

const SELECT_MENU_ANIMATION_MS = 120

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export function Select<T extends string>({
  options,
  value,
  onChange,
  className = 'w-[146px]',
  menuClassName = ''
}: {
  options: SelectOption<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
  menuClassName?: string
}) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )
  const selected = options[selectedIndex] ?? options[0]

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }

    if (!mounted) return
    const timeout = window.setTimeout(() => setMounted(false), SELECT_MENU_ANIMATION_MS)
    return () => window.clearTimeout(timeout)
  }, [mounted, open])

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

  const commit = (nextValue: T) => {
    onChange(nextValue)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!options.length) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = (selectedIndex + direction + options.length) % options.length
      onChange(options[nextIndex].value)
      setOpen(true)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen((current) => !current)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
        className={`flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-surface/95 px-3 text-left text-[13px] font-medium text-text-strong shadow-[0_1px_1px_rgba(0,0,0,0.04)] outline-none transition-[background,border-color,box-shadow] ${
          open
            ? 'border-border-selected shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]'
            : 'border-border-weak hover:border-border-selected/70 hover:bg-surface'
        }`}
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-text-weak transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {mounted && (
        <div
          id={listboxId}
          role="listbox"
          data-state={open ? 'open' : 'closed'}
          className={`ui-select-menu absolute right-0 top-[calc(100%+6px)] z-50 w-full overflow-hidden rounded-lg border border-border-weak bg-stronger p-1 text-[13px] shadow-[0_8px_18px_rgba(0,0,0,0.08),0_1px_4px_rgba(0,0,0,0.05)] ${menuClassName}`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => commit(option.value)}
              className={`flex h-8 w-full items-center rounded-md px-2.5 text-left transition-colors ${
                option.value === value
                  ? 'bg-[var(--button-primary-base)] text-[var(--button-primary-text)] shadow-[var(--shadow-sm)]'
                  : 'text-text-base hover:bg-selection hover:text-text-strong'
              }`}
            >
              <span className="min-w-0 truncate">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
