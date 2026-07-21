import { describe, expect, it, vi } from 'vitest'
import { embeddedTerminalArgs } from '../../src/main/embedded-terminal'
import { CodexInterruptGuard, codexTuiIsClosing } from '../../src/main/pty-compat'

describe('embedded terminal scrollback arguments', () => {
  it('uses Codex inline mode for supported Windows installs', () => {
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: 'codex-cli 0.144.6',
        autoApprove: false,
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen'])

    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: '0.79.0',
        autoApprove: false,
        platform: 'win32'
      })
    ).toEqual([])
  })

  it('uses OpenCode mini mode without changing auto-approval semantics', () => {
    expect(
      embeddedTerminalArgs({
        cliId: 'opencode',
        version: 'v1.17.10',
        autoApprove: false,
        platform: 'win32'
      })
    ).toEqual(['--mini'])

    expect(
      embeddedTerminalArgs({
        cliId: 'opencode',
        version: '1.18.2',
        autoApprove: true,
        platform: 'win32'
      })
    ).toEqual([])

    expect(
      embeddedTerminalArgs({
        cliId: 'opencode',
        version: '1.17.9',
        autoApprove: false,
        platform: 'win32'
      })
    ).toEqual([])
  })

  it('leaves primary-screen Pi and non-Windows launches unchanged', () => {
    expect(
      embeddedTerminalArgs({ cliId: 'pi', version: '0.77.0', autoApprove: false, platform: 'win32' })
    ).toEqual([])
    expect(
      embeddedTerminalArgs({ cliId: 'codex', version: '0.144.6', autoApprove: false, platform: 'darwin' })
    ).toEqual([])
  })

  it('enables current inline modes when a system-linked version was not recorded', () => {
    expect(
      embeddedTerminalArgs({ cliId: 'codex', version: undefined, autoApprove: false, platform: 'win32' })
    ).toEqual(['--no-alt-screen'])
    expect(
      embeddedTerminalArgs({ cliId: 'opencode', version: 'system', autoApprove: false, platform: 'win32' })
    ).toEqual(['--mini'])
  })

  it('disables plugin startup only for affected Windows Codex resumes', () => {
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: '0.144.6',
        autoApprove: false,
        resume: true,
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen', '--disable', 'plugins'])
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: '0.139.0',
        autoApprove: false,
        resume: true,
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen'])
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: 'system',
        autoApprove: false,
        resume: true,
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen', '--disable', 'plugins'])
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: '0.144.6',
        autoApprove: false,
        resume: true,
        platform: 'darwin'
      })
    ).toEqual([])
  })
})

describe('Codex PTY compatibility', () => {
  it('detects Codex shutdown output across chunks', () => {
    expect(codexTuiIsClosing('Shutting down...')).toBe(true)
    expect(codexTuiIsClosing('\x1b[?2004l\x1b[0 q')).toBe(true)
    expect(codexTuiIsClosing('\x1b[?2026h\x1b[?25l')).toBe(false)
  })

  it('forces a stalled interrupt and leaves active-turn output running', () => {
    vi.useFakeTimers()
    let forced = 0
    const guard = new CodexInterruptGuard({
      onForceExit: () => {
        forced += 1
      },
      settleMs: 5,
      watchdogMs: 15,
      exitGraceMs: 1
    })

    try {
      guard.arm()
      vi.advanceTimersByTime(15)
      expect(forced).toBe(1)
      expect(guard.pending).toBe(false)

      guard.arm()
      guard.observe('\x1b[?2026hactive turn interrupted')
      vi.advanceTimersByTime(20)
      expect(forced).toBe(1)
      expect(guard.pending).toBe(false)
    } finally {
      guard.clear()
      vi.useRealTimers()
    }
  })

  it('forces exit after Codex emits terminal teardown', () => {
    vi.useFakeTimers()
    let forced = false
    const guard = new CodexInterruptGuard({
      onForceExit: () => {
        forced = true
      },
      settleMs: 20,
      watchdogMs: 50,
      exitGraceMs: 1
    })

    try {
      guard.arm()
      guard.observe('\x1b[?200')
      guard.observe('4l\x1b[0 q')
      vi.advanceTimersByTime(1)
      expect(forced).toBe(true)
      expect(guard.pending).toBe(false)
    } finally {
      guard.clear()
      vi.useRealTimers()
    }
  })
})
