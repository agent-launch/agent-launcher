import { useEffect, useRef } from 'react'
import { Terminal, type IWindowsPty } from '@xterm/xterm'
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
  onExit?: (code: number) => boolean | void
}

function readVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const CODEX_TERMINAL_THEME = {
  background: '#151821',
  foreground: '#f7f8ff',
  cursor: '#f7f8ff',
  cursorAccent: '#151821',
  selectionBackground: 'rgba(187, 201, 237, 0.24)',
  black: '#252a35',
  red: '#ff8a8a',
  green: '#a8d46f',
  yellow: '#e8c778',
  blue: '#8db7ff',
  magenta: '#d1a3ff',
  cyan: '#7fd6c2',
  white: '#e3e6f0',
  brightBlack: '#747b8e',
  brightRed: '#ffb0a8',
  brightGreen: '#c8ea90',
  brightYellow: '#f2da9a',
  brightBlue: '#b2ccff',
  brightMagenta: '#e0c2ff',
  brightCyan: '#a3e6d8',
  brightWhite: '#ffffff'
}

function terminalTheme(cliId: CliId) {
  if (cliId === 'codex') return CODEX_TERMINAL_THEME
  return {
    background: readVar('--terminal-background', '#1e1e1e'),
    foreground: readVar('--terminal-foreground', '#cccccc'),
    cursor: readVar('--terminal-cursor', '#cccccc'),
    cursorAccent: readVar('--terminal-cursor-accent', '#1e1e1e'),
    selectionBackground: readVar('--terminal-selection-background', '#264f78'),
    black: readVar('--terminal-black', '#000000'),
    red: readVar('--terminal-red', '#cd3131'),
    green: readVar('--terminal-green', '#0dbc79'),
    yellow: readVar('--terminal-yellow', '#e5e510'),
    blue: readVar('--terminal-blue', '#2472c8'),
    magenta: readVar('--terminal-magenta', '#bc3fbc'),
    cyan: readVar('--terminal-cyan', '#11a8cd'),
    white: readVar('--terminal-white', '#e5e5e5'),
    brightBlack: readVar('--terminal-bright-black', '#666666'),
    brightRed: readVar('--terminal-bright-red', '#f14c4c'),
    brightGreen: readVar('--terminal-bright-green', '#23d18b'),
    brightYellow: readVar('--terminal-bright-yellow', '#f5f543'),
    brightBlue: readVar('--terminal-bright-blue', '#3b8eea'),
    brightMagenta: readVar('--terminal-bright-magenta', '#d670d6'),
    brightCyan: readVar('--terminal-bright-cyan', '#29b8db'),
    brightWhite: readVar('--terminal-bright-white', '#e5e5e5')
  }
}

function windowsPtyInfo(): IWindowsPty | undefined {
  return window.api.getWindowsPtyInfo?.() ?? undefined
}

export function TerminalView({ cliId, mode, cwd, resumeId, sessionKey, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  // Keep the latest translator in a ref so the once-per-session effect (which
  // intentionally excludes deps) always reads the current locale.
  const t = useT()
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const windowsPty = windowsPtyInfo()
    const term = new Terminal({
      ...(windowsPty ? { windowsPty } : {}),
      fontFamily: readVar('--font-family-mono', 'monospace'),
      fontSize: 13,
      lineHeight: 1.25,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      rescaleOverlappingGlyphs: true,
      scrollback: 10000,
      scrollOnUserInput: true,
      smoothScrollDuration: 0,
      theme: terminalTheme(cliId)
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    let ptyId: string | null = null
    let disposed = false
    const offs: Array<() => void> = []

    offs.push(
      window.api.pty.onData((id, data) => {
        if (id === ptyId) {
          term.write(data)
        }
      })
    )
    offs.push(
      window.api.pty.onExit((id, code) => {
        if (id === ptyId) {
          const shouldWriteExit = onExit?.(code) !== false
          if (shouldWriteExit) term.write(`\r\n\x1b[90m${tRef.current('terminal.exited', { code })}\x1b[0m\r\n`)
        }
      })
    )

    term.onData((d) => ptyId && window.api.pty.write(ptyId, d))

    const copySelection = () => {
      const selection = term.getSelection()
      if (!selection) return false
      try {
        window.api.clipboard.writeText(selection)
        return true
      } catch {
        return false
      }
    }
    const pasteClipboard = () => {
      if (!ptyId) return
      try {
        const text = window.api.clipboard.readText()
        if (text) window.api.pty.write(ptyId, text)
      } catch {
        /* clipboard access may be unavailable in some system policies */
      }
    }
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const shortcut = event.ctrlKey || event.metaKey
      if (!shortcut || event.altKey) return true
      const key = event.key.toLowerCase()
      if (key === 'c') {
        if (term.hasSelection()) {
          copySelection()
          event.preventDefault()
          return false
        }
        return true
      }
      if (key === 'v') {
        pasteClipboard()
        event.preventDefault()
        return false
      }
      return true
    })

    const startTimer = window.setTimeout(() => {
      if (disposed) return
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
    }, 0)

    const onResize = () => {
      fit.fit()
      if (ptyId) window.api.pty.resize(ptyId, term.cols, term.rows)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(host)

    return () => {
      disposed = true
      window.clearTimeout(startTimer)
      ro.disconnect()
      offs.forEach((off) => off())
      if (ptyId) window.api.pty.kill(ptyId)
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  useEffect(() => {
    const applyTheme = () => {
      const term = termRef.current
      if (term) term.options.theme = terminalTheme(cliId)
    }
    const observer = new MutationObserver(applyTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    applyTheme()
    return () => observer.disconnect()
  }, [cliId])

  return (
    <div
      ref={hostRef}
      className="h-full min-w-0 w-full overflow-hidden bg-[var(--terminal-background)] p-3"
      style={cliId === 'codex' ? { background: CODEX_TERMINAL_THEME.background } : undefined}
    />
  )
}
