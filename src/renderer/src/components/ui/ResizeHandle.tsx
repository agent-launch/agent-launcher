import { useRef } from 'react'

interface Props {
  /** Current size (px). */
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  /** Called if released below collapseThreshold. */
  onCollapse?: () => void
  collapseThreshold?: number
  /** Fired on drag start/end so the parent can disable width transitions. */
  onDragStart?: () => void
  onDragEnd?: () => void
}

/**
 * A draggable edge handle (ported from opencode's ResizeHandle). Sits on the
 * right edge of the sidebar; drag to resize, release below threshold to collapse.
 * An accent line fades in on hover/active (see .resize-handle in index.css).
 */
export function ResizeHandle({
  size,
  min,
  max,
  onResize,
  onCollapse,
  collapseThreshold = 0,
  onDragStart,
  onDragEnd
}: Props) {
  const current = useRef(size)
  const raf = useRef<number | null>(null)

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startSize = size
    current.current = startSize
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    onDragStart?.()

    const onMove = (ev: MouseEvent) => {
      current.current = Math.min(max, Math.max(min, startSize + (ev.clientX - startX)))
      // Coalesce updates to one per frame so we never paint faster than display.
      if (raf.current == null) {
        raf.current = requestAnimationFrame(() => {
          raf.current = null
          onResize(current.current)
        })
      }
    }
    const onUp = () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (raf.current != null) {
        cancelAnimationFrame(raf.current)
        raf.current = null
      }
      onResize(current.current)
      onDragEnd?.()
      if (onCollapse && collapseThreshold > 0 && current.current < collapseThreshold) onCollapse()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return <div className="resize-handle no-drag" onMouseDown={onMouseDown} />
}
