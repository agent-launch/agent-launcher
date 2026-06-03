import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useT } from '@/i18n'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

/** Centered dialog with a dimmed backdrop (opencode-style). Esc / backdrop closes. */
export function Modal({ open, onClose, title, children }: Props) {
  const t = useT()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onMouseDown={onClose}
      style={{ background: 'rgba(0,0,0,0.45)' }}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border-weak bg-stronger shadow-[var(--shadow-md)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-weak px-5">
          <h2 className="text-[15px] font-semibold text-text-strong">{title}</h2>
          <button
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-text-weak hover:bg-surface-weak hover:text-text-strong"
            title={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}
