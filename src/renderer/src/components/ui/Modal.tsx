import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useT } from '@/i18n'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

const EXIT_ANIMATION_MS = 150

/** Centered dialog with a soft desktop backdrop. Esc / backdrop closes. */
export function Modal({ open, onClose, title, children }: Props) {
  const t = useT()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }

    const timer = window.setTimeout(() => setMounted(false), EXIT_ANIMATION_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-md ${
        open ? 'modal-backdrop--open' : 'modal-backdrop--closed'
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal-panel flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border-weak bg-stronger outline-none ${
          open ? 'modal-panel--open' : 'modal-panel--closed'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-weak px-5">
          <h2 id={titleId} className="min-w-0 truncate font-display text-[15px] font-semibold text-text-strong">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 shrink-0 place-items-center rounded-md text-text-weak transition-[background,color,transform] duration-150 hover:bg-surface-hover hover:text-text-strong active:scale-95"
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
