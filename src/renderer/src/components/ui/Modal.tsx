import type { ReactNode, RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useT } from '@/i18n'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'default' | 'wide'
  initialFocusRef?: RefObject<HTMLElement | null>
}

/** Centered dialog with a soft desktop backdrop. Esc / backdrop closes. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'default',
  initialFocusRef
}: Props) {
  const t = useT()

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop fixed inset-0 z-[200] backdrop-blur-md" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            if (!initialFocusRef?.current) return
            event.preventDefault()
            initialFocusRef.current.focus()
          }}
          className="modal-panel fixed z-[201] flex max-h-[82vh] flex-col overflow-hidden rounded-xl border border-border-base bg-stronger/95 outline-none"
          style={size === 'wide' ? { width: 'min(calc(100vw - 48px), 48rem)' } : undefined}
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-weak bg-surface-weak/35 px-5">
            <Dialog.Title className="min-w-0 truncate font-display text-[15px] font-semibold text-text-strong">
              {title}
            </Dialog.Title>
            <button
              type="button"
              onClick={onClose}
              className="grid size-7 shrink-0 place-items-center rounded-md text-text-weak transition-[background,color,transform] duration-150 hover:bg-surface-hover hover:text-text-strong active:scale-95"
              aria-label={t('common.close')}
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex shrink-0 justify-end gap-2 border-t border-border-weak bg-surface-weak/35 px-5 py-3">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
