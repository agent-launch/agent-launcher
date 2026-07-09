import { describe, expect, it } from 'vitest'
import { codexTargetTriple, nodeDistName, opencodePlatformKey } from '../../src/main/install/platform'
import { decodeProcessOutput, lastLines, windowsShellTarget } from '../../src/main/process'
import type { PlatformInfo } from '../../src/shared/types'

describe('platform and process helpers', () => {
  it('maps supported platforms to CLI package naming conventions', () => {
    const darwinArm: PlatformInfo = { os: 'darwin', arch: 'arm64', platformKey: 'darwin-arm64' }
    const linuxX64: PlatformInfo = { os: 'linux', arch: 'x64', platformKey: 'linux-x64' }
    const winX64: PlatformInfo = { os: 'win32', arch: 'x64', platformKey: 'win32-x64' }

    expect(codexTargetTriple(darwinArm)).toBe('aarch64-apple-darwin')
    expect(codexTargetTriple(linuxX64)).toBe('x86_64-unknown-linux-musl')
    expect(codexTargetTriple(winX64)).toBe('x86_64-pc-windows-msvc')
    expect(opencodePlatformKey(winX64)).toBe('windows-x64')
    expect(nodeDistName(winX64, '24.0.0')).toEqual({ file: 'node-v24.0.0-win-x64.zip', ext: 'zip' })
    expect(nodeDistName(darwinArm, '24.0.0')).toEqual({ file: 'node-v24.0.0-darwin-arm64.tar.gz', ext: 'tar.gz' })
  })

  it('keeps non-Windows process helpers simple on the current platform', () => {
    expect(windowsShellTarget('tool.cmd', ['a b'])).toEqual({ file: 'tool.cmd', args: ['a b'] })
    expect(decodeProcessOutput(Buffer.from('hello'))).toBe('hello')
    expect(lastLines('a\nb\nc\n', 2)).toBe('b\nc')
  })
})
