import { describe, expect, it } from 'vitest'
import { chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { commandSearchCandidates } from '../../src/main/install/installer'
import { codexTargetTriple, nodeDistName, opencodePlatformKey } from '../../src/main/install/platform'
import { decodeProcessOutput, lastLines, windowsShellTarget } from '../../src/main/process'
import type { PlatformInfo } from '../../src/shared/types'
import { withIsolatedHome, writeText } from '../helpers/isolated-main'

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

  it('searches GUI-omitted npm locations directly', () => {
    if (process.platform === 'win32') return
    const candidates = commandSearchCandidates('npm')
    expect(candidates).toContain('/usr/local/bin/npm')
    expect(candidates).toContain('/opt/homebrew/bin/npm')
    expect(candidates).toContain(join(homedir(), '.local', 'bin', 'npm'))
    expect(candidates).toContain(join(homedir(), 'local', 'bin', 'npm'))
  })

  it('finds a user-local command even when the GUI PATH omits it', async () => {
    if (process.platform === 'win32') return
    await withIsolatedHome(async ({ home }) => {
      const command = join(home, 'local', 'bin', 'qa-npm')
      writeText(command, '#!/bin/sh\nexit 0\n')
      chmodSync(command, 0o755)
      const previousPath = process.env.PATH
      process.env.PATH = '/usr/bin:/bin'
      try {
        const { findSystemCommand } = await import('../../src/main/install/installer')
        expect(await findSystemCommand('qa-npm')).toBe(command)
      } finally {
        process.env.PATH = previousPath
      }
    })
  })
})
