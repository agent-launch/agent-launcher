import { describe, expect, it } from 'vitest'
import { embeddedScrollbackArgs } from '../../src/main/embedded-terminal'

describe('embedded terminal scrollback arguments', () => {
  it('uses Codex inline mode for supported Windows installs', () => {
    expect(
      embeddedScrollbackArgs({
        cliId: 'codex',
        version: 'codex-cli 0.144.6',
        autoApprove: false,
        platform: 'win32'
      })
    ).toEqual(['--no-alt-screen'])

    expect(
      embeddedScrollbackArgs({
        cliId: 'codex',
        version: '0.79.0',
        autoApprove: false,
        platform: 'win32'
      })
    ).toEqual([])
  })

  it('uses OpenCode mini mode without changing auto-approval semantics', () => {
    expect(
      embeddedScrollbackArgs({
        cliId: 'opencode',
        version: 'v1.17.10',
        autoApprove: false,
        platform: 'win32'
      })
    ).toEqual(['--mini'])

    expect(
      embeddedScrollbackArgs({
        cliId: 'opencode',
        version: '1.18.2',
        autoApprove: true,
        platform: 'win32'
      })
    ).toEqual([])

    expect(
      embeddedScrollbackArgs({
        cliId: 'opencode',
        version: '1.17.9',
        autoApprove: false,
        platform: 'win32'
      })
    ).toEqual([])
  })

  it('leaves primary-screen Pi and non-Windows launches unchanged', () => {
    expect(
      embeddedScrollbackArgs({ cliId: 'pi', version: '0.77.0', autoApprove: false, platform: 'win32' })
    ).toEqual([])
    expect(
      embeddedScrollbackArgs({ cliId: 'codex', version: '0.144.6', autoApprove: false, platform: 'darwin' })
    ).toEqual([])
  })

  it('enables current inline modes when a system-linked version was not recorded', () => {
    expect(
      embeddedScrollbackArgs({ cliId: 'codex', version: undefined, autoApprove: false, platform: 'win32' })
    ).toEqual(['--no-alt-screen'])
    expect(
      embeddedScrollbackArgs({ cliId: 'opencode', version: 'system', autoApprove: false, platform: 'win32' })
    ).toEqual(['--mini'])
  })
})
