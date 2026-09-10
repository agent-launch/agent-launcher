import { useEffect, useRef } from 'react'
import {
  Terminal,
  type IBuffer,
  type IBufferCell,
  type IBufferLine,
  type IDisposable,
  type IWindowsPty
} from '@xterm/xterm'
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

function terminalTheme() {
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

type XtermCompositionCore = {
  _core?: {
    _syncTextArea?: () => void
    viewport?: {
      syncScrollArea?: (immediate?: boolean) => void
      _ignoreNextScrollEvent?: boolean
    }
    _compositionHelper?: {
      compositionstart?: () => void
      updateCompositionElements?: (dontRecurse?: boolean) => void
    }
  }
}

function syncTerminalScrollArea(term: Terminal): void {
  try {
    const viewport = (term as unknown as XtermCompositionCore)._core?.viewport
    // Keep this deferred: xterm's immediate path can leave its next-scroll
    // suppression armed after a large ConPTY write and swallow user scrolling.
    viewport?.syncScrollArea?.()
    requestAnimationFrame(() => {
      if (viewport) viewport._ignoreNextScrollEvent = false
    })
  } catch {
    /* xterm internals can change between minor versions */
  }
}

function patchImeCompositionStart(term: Terminal): () => void {
  const core = (term as unknown as XtermCompositionCore)._core
  const helper = core?._compositionHelper
  const original = helper?.compositionstart
  if (!core?._syncTextArea || !helper || typeof original !== 'function') return () => {}

  const patched = () => {
    // Match xterm.js #5759: sync the helper textarea before composition starts,
    // then immediately refresh composition elements so IME anchoring uses the
    // latest cursor instead of placeholder/hint text position.
    try {
      core._syncTextArea?.()
    } catch {
      /* xterm internals can change between minor versions */
    }
    original.call(helper)
    try {
      helper.updateCompositionElements?.()
    } catch {
      /* xterm internals can change between minor versions */
    }
  }
  helper.compositionstart = patched
  return () => {
    if (helper.compositionstart === patched) helper.compositionstart = original
  }
}

type TerminalImeAnchor = {
  row: number
  column: number
}

const PAINTED_CURSOR_CLIS = new Set<CliId>(['claude-code', 'pi'])
const PROMPT_MARKER_CHARS = new Set(['>', '\u276f', '\u203a', '\u2192'])

function clampCell(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max - 1, 0))
}

function visibleLine(buffer: IBuffer, row: number): IBufferLine | undefined {
  return buffer.getLine(buffer.baseY + row)
}

function cellChars(cell: IBufferCell): string {
  return cell.getChars() || ' '
}

function isSpaceCell(cell: IBufferCell | undefined): boolean {
  if (!cell || cell.getWidth() === 0) return false
  const chars = cellChars(cell)
  return chars === ' ' || chars === '\u00a0'
}

function findLineContentEndColumn(
  line: IBufferLine,
  startColumn: number,
  cols: number
): number | null {
  const maxColumn = Math.min(line.length, cols)
  for (let column = maxColumn - 1; column >= startColumn; column--) {
    const cell = line.getCell(column)
    if (!cell || cell.getWidth() === 0 || isSpaceCell(cell)) continue
    return column + Math.max(cell.getWidth(), 1)
  }
  return null
}

function findPaintedCursorColumn(line: IBufferLine, cols: number): number | null {
  const maxColumn = Math.min(line.length, cols)
  for (let column = 0; column < maxColumn; column++) {
    const cell = line.getCell(column)
    if (!cell || cell.getWidth() === 0 || !cell.isInverse()) continue
    return column
  }
  return null
}

function resolvePromptMarkerColumn(line: IBufferLine, cols: number): number | null {
  const maxColumn = Math.min(line.length, cols)
  for (let column = 0; column < maxColumn - 1; column++) {
    const marker = line.getCell(column)
    if (!marker || marker.getWidth() === 0 || !PROMPT_MARKER_CHARS.has(cellChars(marker))) continue

    const nextColumn = column + Math.max(marker.getWidth(), 1)
    if (nextColumn >= maxColumn || !isSpaceCell(line.getCell(nextColumn))) continue

    const inputColumn = nextColumn + 1
    return findLineContentEndColumn(line, inputColumn, cols) ?? inputColumn
  }
  return null
}

function nearbyRows(row: number, rows: number): number[] {
  const out: number[] = []
  for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
    const candidate = row + offset
    if (candidate >= 0 && candidate < rows && !out.includes(candidate)) out.push(candidate)
  }
  return out
}

function resolvePaintedCursorImeAnchor(args: {
  buffer: IBuffer
  rows: number
  cols: number
  cursorX: number
  cursorY: number
}): TerminalImeAnchor | null {
  const cursorLooksParked = args.cursorX >= Math.max(args.cols - 8, Math.floor(args.cols * 0.8))
  if (!cursorLooksParked) return null

  for (const row of nearbyRows(args.cursorY, args.rows)) {
    const line = visibleLine(args.buffer, row)
    if (!line) continue

    const paintedColumn = findPaintedCursorColumn(line, args.cols)
    if (paintedColumn !== null && paintedColumn < args.cursorX) {
      return { row, column: paintedColumn }
    }

    const promptColumn = resolvePromptMarkerColumn(line, args.cols)
    if (promptColumn !== null && promptColumn < args.cursorX) {
      return { row, column: clampCell(promptColumn, args.cols) }
    }
  }

  return null
}

function resolveImeAnchor(term: Terminal, cliId: CliId): TerminalImeAnchor {
  const buffer = term.buffer.active
  const cursorX = clampCell(buffer.cursorX, term.cols)
  const cursorY = clampCell(buffer.cursorY, term.rows)

  if (PAINTED_CURSOR_CLIS.has(cliId)) {
    const paintedAnchor = resolvePaintedCursorImeAnchor({
      buffer,
      rows: term.rows,
      cols: term.cols,
      cursorX,
      cursorY
    })
    if (paintedAnchor) return paintedAnchor
  }

  return { row: cursorY, column: cursorX }
}

function installImeTextareaAnchorSync(term: Terminal, cliId: CliId): () => void {
  const element = term.element
  const textarea = term.textarea
  const compositionView = element?.querySelector<HTMLElement>('.composition-view')
  const screen = element?.querySelector<HTMLElement>('.xterm-screen')
  if (!element || !textarea || !screen) return () => {}

  const sync = () => {
    if (term.cols <= 0 || term.rows <= 0) return
    const rect = screen.getBoundingClientRect()
    const cellWidth = rect.width / term.cols
    const cellHeight = rect.height / term.rows
    if (
      !Number.isFinite(cellWidth) ||
      !Number.isFinite(cellHeight) ||
      !(cellWidth > 0) ||
      !(cellHeight > 0)
    )
      return

    const { row, column } = resolveImeAnchor(term, cliId)
    const left = `${column * cellWidth}px`
    const top = `${row * cellHeight}px`
    const height = `${Math.max(cellHeight, 1)}px`

    textarea.style.left = left
    textarea.style.top = top
    textarea.style.width = `${Math.max(cellWidth, 1)}px`
    textarea.style.height = height
    textarea.style.lineHeight = height

    if (compositionView) {
      compositionView.style.left = left
      compositionView.style.top = top
      compositionView.style.height = height
      compositionView.style.lineHeight = height
    }
  }

  const syncSoon = () => {
    sync()
    window.setTimeout(() => {
      if (textarea.isConnected) sync()
    }, 0)
  }

  const disposables: IDisposable[] = [
    term.onCursorMove(sync),
    term.onRender(sync),
    term.onResize(sync)
  ]
  element.addEventListener('keydown', sync, true)
  element.addEventListener('compositionstart', syncSoon)
  element.addEventListener('compositionupdate', syncSoon)
  return () => {
    disposables.forEach((disposable) => disposable.dispose())
    element.removeEventListener('keydown', sync, true)
    element.removeEventListener('compositionstart', syncSoon)
    element.removeEventListener('compositionupdate', syncSoon)
  }
}

export function TerminalView({ cliId, mode, cwd, resumeId, sessionKey, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const isWindows = window.api.platform === 'win32'
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
      theme: terminalTheme()
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    host.replaceChildren()
    term.open(host)
    const removeImeCompositionPatch = patchImeCompositionStart(term)
    const removeImeTextareaAnchorSync = installImeTextareaAnchorSync(term, cliId)
    fit.fit()

    const syncScrollArea = () => {
      // Codex and OpenCode insert history with terminal scroll regions. xterm
      // can update its buffer before refreshing the virtual scrollbar height.
      if (isWindows) syncTerminalScrollArea(term)
    }
    const parsedDisposable = term.onWriteParsed(syncScrollArea)

    let ptyId: string | null = null
    let disposed = false
    const offs: Array<() => void> = []

    offs.push(
      window.api.pty.onData((id, data) => {
        if (id === ptyId) {
          const debugWindow = window as typeof window & { __terminalOutput?: string[] }
          debugWindow.__terminalOutput ??= []
          debugWindow.__terminalOutput.push(data)
          term.write(data)
        }
      })
    )
    offs.push(
      window.api.pty.onExit((id, code) => {
        if (id === ptyId) {
          const shouldWriteExit = onExit?.(code) !== false
          if (shouldWriteExit)
            term.write(`\r\n\x1b[90m${tRef.current('terminal.exited', { code })}\x1b[0m\r\n`)
        }
      })
    )

    term.onData((d) => {
      const debugWindow = window as typeof window & { __terminalWrites?: string[] }
      debugWindow.__terminalWrites ??= []
      debugWindow.__terminalWrites.push(d)
      if (ptyId) window.api.pty.write(ptyId, d)
    })

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
          term.write(
            `\r\n\x1b[31m${tRef.current('terminal.launchFailed', { error: e.message })}\x1b[0m\r\n`
          )
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
      parsedDisposable.dispose()
      offs.forEach((off) => off())
      removeImeCompositionPatch()
      removeImeTextareaAnchorSync()
      if (ptyId) window.api.pty.kill(ptyId)
      term.dispose()
      host.replaceChildren()
      termRef.current = null
    }
    // The terminal lifecycle is keyed by sessionKey; changing callback identities must not recreate the PTY.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  useEffect(() => {
    const applyTheme = () => {
      const term = termRef.current
      if (term) term.options.theme = terminalTheme()
    }
    const observer = new MutationObserver(applyTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    applyTheme()
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={`agent-terminal h-full min-w-0 w-full overflow-hidden bg-[var(--terminal-background)] p-3${isWindows ? ' agent-terminal--windows' : ''}`}
    >
      {/* FitAddon measures xterm's direct parent and does not account for padding on that parent. */}
      <div ref={hostRef} className="h-full min-h-0 min-w-0 w-full overflow-hidden" />
    </div>
  )
}
