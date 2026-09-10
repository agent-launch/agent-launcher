import { describe, expect, it, vi } from 'vitest'
import { embeddedTerminalArgs, embeddedTerminalEnv } from '../../src/main/embedded-terminal'
import { CodexInterruptGuard, codexTuiIsClosing } from '../../src/main/pty-compat'

describe('embedded terminal scrollback arguments', () => {
  it('uses Codex inline mode for supported Windows installs', () => {
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: 'codex-cli 0.144.6',
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen'])

    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: '0.79.0',
        platform: 'win32'
      })
    ).toEqual([])
  })

  it('uses Codex inline mode across supported versions', () => {
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: '0.80.0',
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen'])
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: '0.144.6',
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen'])
  })

  it('uses OpenCode mini mode for supported Windows installs', () => {
    expect(
      embeddedTerminalArgs({
        cliId: 'opencode',
        version: 'v1.17.10',
        platform: 'win32'
      })
    ).toEqual(['--mini'])

    expect(
      embeddedTerminalArgs({
        cliId: 'opencode',
        version: '1.18.2',
        platform: 'win32'
      })
    ).toEqual(['--mini'])

    expect(
      embeddedTerminalArgs({
        cliId: 'opencode',
        version: '1.17.9',
        platform: 'win32'
      })
    ).toEqual([])
  })

  it('leaves primary-screen Pi and non-Windows launches unchanged', () => {
    expect(embeddedTerminalArgs({ cliId: 'pi', version: '0.77.0', platform: 'win32' })).toEqual([])
    expect(
      embeddedTerminalArgs({ cliId: 'codex', version: '0.144.6', platform: 'darwin' })
    ).toEqual([])
  })

  it('enables current inline modes when a system-linked version was not recorded', () => {
    expect(embeddedTerminalArgs({ cliId: 'codex', version: undefined, platform: 'win32' })).toEqual(
      ['--no-alt-screen']
    )
    expect(
      embeddedTerminalArgs({ cliId: 'opencode', version: 'system', platform: 'win32' })
    ).toEqual(['--mini'])
  })

  it('disables plugin startup only for affected Windows Codex resumes', () => {
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: '0.144.6',
        resume: true,
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen', '--disable', 'plugins'])
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: '0.139.0',
        resume: true,
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen'])
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: 'system',
        resume: true,
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen', '--disable', 'plugins'])
    expect(
      embeddedTerminalArgs({
        cliId: 'codex',
        version: '0.144.6',
        resume: true,
        platform: 'darwin'
      })
    ).toEqual([])
  })
})

describe('embedded terminal environment', () => {
  it('disables Claude alternate-screen rendering only in its Windows embedded terminal', () => {
    expect(
      embeddedTerminalEnv({ cliId: 'claude-code', env: { KEEP: 'yes' }, platform: 'win32' })
    ).toMatchObject({
      KEEP: 'yes',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      CLICOLOR: '1',
      CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1'
    })
    expect(
      embeddedTerminalEnv({ cliId: 'claude-code', env: {}, platform: 'darwin' })
        .CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    ).toBeUndefined()
    expect(
      embeddedTerminalEnv({ cliId: 'codex', env: {}, platform: 'win32' })
        .CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    ).toBeUndefined()
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
