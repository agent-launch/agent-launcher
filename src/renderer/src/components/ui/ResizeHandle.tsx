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
}

/**
 * A draggable edge handle (ported from opencode's ResizeHandle). Sits on the
 * right edge of the sidebar; drag to resize, release below threshold to collapse.
 * An accent line fades in on hover/active (see .resize-handle in index.css).
 */
export function ResizeHandle({ size, min, max, onResize, onCollapse, collapseThreshold = 0 }: Props) {
  const current = useRef(size)

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startSize = size
    current.current = startSize
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const onMove = (ev: MouseEvent) => {
      current.current = Math.min(max, Math.max(min, startSize + (ev.clientX - startX)))
      onResize(current.current)
    }
    const onUp = () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (onCollapse && collapseThreshold > 0 && current.current < collapseThreshold) onCollapse()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return <div className="resize-handle no-drag" onMouseDown={onMouseDown} />
}
