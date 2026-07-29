const CODEX_TUI_SHUTTING_DOWN = 'Shutting down...'
const BRACKETED_PASTE_DISABLE = '\x1b[?2004l'
const DEFAULT_SETTLE_MS = 500
const DEFAULT_WATCHDOG_MS = 2500
const DEFAULT_EXIT_GRACE_MS = 150

/** Signals emitted when Codex has left its interactive input loop. */
export function codexTuiIsClosing(output: string): boolean {
  return output.includes(CODEX_TUI_SHUTTING_DOWN) || output.includes(BRACKETED_PASTE_DISABLE)
}

interface CodexInterruptGuardOptions {
  onForceExit: () => void
  settleMs?: number
  watchdogMs?: number
  exitGraceMs?: number
}

/** Distinguishes an active-turn interrupt from a Codex TUI exit that stalls in ConPTY. */
export class CodexInterruptGuard {
  private readonly onForceExit: () => void
  private readonly settleMs: number
  private readonly watchdogMs: number
  private readonly exitGraceMs: number
  private output = ''
  private settleTimer?: ReturnType<typeof setTimeout>
  private watchdogTimer?: ReturnType<typeof setTimeout>

  constructor(options: CodexInterruptGuardOptions) {
    this.onForceExit = options.onForceExit
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS
    this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS
    this.exitGraceMs = options.exitGraceMs ?? DEFAULT_EXIT_GRACE_MS
  }

  get pending(): boolean {
    return this.watchdogTimer !== undefined
  }

  arm(): void {
    this.clear()
    this.output = ''
    this.watchdogTimer = setTimeout(() => this.forceExit(), this.watchdogMs)
  }

  observe(data: string): void {
    if (!this.pending) return
    this.output = `${this.output}${data}`.slice(-2048)
    if (codexTuiIsClosing(this.output)) {
      this.scheduleForceExit(this.exitGraceMs)
      return
    }

    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => this.clear(), this.settleMs)
  }

  clear(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer)
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.watchdogTimer = undefined
    this.settleTimer = undefined
    this.output = ''
  }

  private scheduleForceExit(delay: number): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer)
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = undefined
    this.watchdogTimer = setTimeout(() => this.forceExit(), delay)
  }

  private forceExit(): void {
    if (!this.pending) return
    this.clear()
    this.onForceExit()
  }
}
