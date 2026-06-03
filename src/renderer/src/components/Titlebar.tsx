import { useEffect, useState } from 'react'

/**
 * Frameless-window titlebar. We keep the OS-native window controls
 * (mac traffic lights via titleBarStyle:'hidden', win/linux via
 * titleBarOverlay) and only render a draggable strip + branding here,
 * padding each side to clear the native controls.
 */
export function Titlebar() {
  const [platform, setPlatform] = useState<NodeJS.Platform>('linux')

  useEffect(() => {
    setPlatform(window.api?.platform ?? 'linux')
  }, [])

  const isMac = platform === 'darwin'

  return (
    <div
      className="drag-region flex h-10 shrink-0 items-center bg-strong"
      style={{
        paddingLeft: isMac ? '78px' : '12px',
        // Leave room for the Windows/Linux overlay controls on the right.
        paddingRight: isMac ? '12px' : '140px'
      }}
    >
      {!isMac && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-text-strong">
          <span
            className="grid size-5 place-items-center rounded-md text-[11px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            A
          </span>
          AgentLauncher
        </div>
      )}
    </div>
  )
}
