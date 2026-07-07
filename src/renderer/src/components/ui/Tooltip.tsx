import type { ReactNode } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

export function Tooltip({
  content,
  children,
  side = 'top'
}: {
  content?: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  if (!content) return children

  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={120}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={7}
            collisionPadding={8}
            className="tooltip-content no-drag z-[150] max-w-[260px] rounded-md border border-border-base bg-stronger px-2 py-1.5 text-[12px] leading-snug text-text-strong shadow-[var(--shadow-md)]"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-[var(--background-stronger)]" width={9} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
