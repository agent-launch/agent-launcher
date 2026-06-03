import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useT } from '@/i18n'
import type { CliId } from '@shared/types'

interface Props {
  cliId: CliId
  mode: 'cli' | 'shell'
  cwd?: string
  /** Resume a saved CLI session instead of starting fresh. */
  resumeId?: string
  /** Bump to force a fresh session (e.g. restart / switch CLI). */
  sessionKey: string | number
  onExit?: (code: number) => void
}

function readVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function TerminalView({ cliId, mode, cwd, resumeId, sessionKey, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  // Keep the latest translator in a ref so the once-per-session effect (which
  // intentionally excludes deps) always reads the current locale.
  const t = useT()
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: readVar('--font-family-mono', 'monospace'),
      fontSize: 13,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      theme: {
        background: readVar('--background-base', '#101010'),
        foreground: readVar('--text-strong', '#ededed'),
        cursor: readVar('--accent', '#2f6bff')
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    let ptyId: string | null = null
    let disposed = false
    const offs: Array<() => void> = []

    offs.push(
      window.api.pty.onData((id, data) => {
        if (id === ptyId) term.write(data)
      })
    )
    offs.push(
      window.api.pty.onExit((id, code) => {
        if (id === ptyId) {
          term.write(`\r\n\x1b[90m${tRef.current('terminal.exited', { code })}\x1b[0m\r\n`)
          onExit?.(code)
        }
      })
    )

    term.onData((d) => ptyId && window.api.pty.write(ptyId, d))

    window.api.pty
      .create({ cliId, mode, cwd, resumeId, cols: term.cols, rows: term.rows })
      .then((id) => {
        if (disposed) {
          window.api.pty.kill(id)
          return
        }
        ptyId = id
        term.focus()
      })
      .catch((e: Error) => {
        term.write(`\r\n\x1b[31m${tRef.current('terminal.launchFailed', { error: e.message })}\x1b[0m\r\n`)
      })

    const onResize = () => {
      fit.fit()
      if (ptyId) window.api.pty.resize(ptyId, term.cols, term.rows)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(host)

    return () => {
      disposed = true
      ro.disconnect()
      offs.forEach((off) => off())
      if (ptyId) window.api.pty.kill(ptyId)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  return <div ref={hostRef} className="h-full w-full" />
}
