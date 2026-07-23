import { describe, expect, it } from 'vitest'
import { chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { commandSearchCandidates } from '../../src/main/install/installer'
import { decodeProcessOutput, lastLines, windowsShellTarget } from '../../src/main/process'
import { withIsolatedHome, writeText } from '../helpers/isolated-main'

describe('platform and process helpers', () => {
  it('wraps Windows batch scripts and leaves other platforms unchanged', () => {
    const target = windowsShellTarget('tool.cmd', ['a b'])
    if (process.platform === 'win32') {
      expect(target).toEqual({
        file: process.env.COMSPEC || 'cmd.exe',
        args: ['/d', '/s', '/c', 'call tool.cmd "a b"']
      })
    } else {
      expect(target).toEqual({ file: 'tool.cmd', args: ['a b'] })
    }
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
