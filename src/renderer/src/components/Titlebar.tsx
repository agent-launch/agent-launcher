import { useEffect, useState } from 'react'

/**
 * Frameless-window titlebar. Keep native window controls and render only a
 * quiet draggable strip, matching Codex's sparse desktop chrome.
 */
export function Titlebar() {
  const [platform, setPlatform] = useState<NodeJS.Platform>('linux')

  useEffect(() => {
    setPlatform(window.api?.platform ?? 'linux')
  }, [])

  const isMac = platform === 'darwin'

  return (
    <div
      className="drag-region flex h-9 shrink-0 items-center border-b border-border-weak bg-base/95"
      style={{
        paddingLeft: isMac ? '78px' : '12px',
        // Leave room for the Windows/Linux overlay controls on the right.
        paddingRight: isMac ? '12px' : '140px'
      }}
    >
      {!isMac && (
        <div className="flex items-center gap-2 text-[13px] font-semibold text-text-strong">
          <span
            className="grid size-5 place-items-center rounded-[5px] bg-text-strong text-[11px] font-bold text-[var(--background-base)]"
          >
            A
          </span>
          AgentLauncher
        </div>
      )}
    </div>
  )
}
