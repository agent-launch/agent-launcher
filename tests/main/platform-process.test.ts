import { describe, expect, it } from 'vitest'
import { chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
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

  it('puts an absolute command directory first for companion runtimes', async () => {
    const { envForCommand } = await import('../../src/main/system-path')
    const env = envForCommand('/Users/example/.local/bin/npm', { PATH: '/usr/bin:/bin' })
    expect(env.PATH?.split(delimiter)[0]).toBe('/Users/example/.local/bin')
  })

  it('runs env-node wrappers when Node sits beside a command omitted from GUI PATH', async () => {
    if (process.platform === 'win32') return
    await withIsolatedHome(async ({ home }) => {
      const binDir = join(home, '.local', 'bin')
      const node = join(binDir, 'node')
      const npm = join(binDir, 'npm')
      writeText(node, '#!/bin/sh\nprintf companion-node\n')
      writeText(npm, '#!/usr/bin/env node\n')
      chmodSync(node, 0o755)
      chmodSync(npm, 0o755)

      const { envForCommand } = await import('../../src/main/system-path')
      const { spawnProcess } = await import('../../src/main/process')
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawnProcess(npm, [], {
          env: envForCommand(npm, { PATH: '/usr/bin:/bin' }),
          stdio: ['ignore', 'pipe', 'pipe']
        })
        let stdout = ''
        child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
        child.on('error', reject)
        child.on('close', (code) =>
          code === 0 ? resolve(stdout) : reject(new Error(`wrapper exited ${code}`))
        )
      })

      expect(output).toBe('companion-node')
    })
  })

  it('recovers PATH from the login shell for GUI launches', async () => {
    if (process.platform === 'win32') return
    await withIsolatedHome(async ({ home }) => {
      const shell = join(home, 'fake-shell')
      writeText(
        shell,
        [
          '#!/bin/sh',
          "printf '__AGENT_LAUNCHER_ENV_START__\\n'",
          "printf 'PATH=/shell-managed/bin:/usr/bin\\n'",
          "printf '__AGENT_LAUNCHER_ENV_END__\\n'"
        ].join('\n')
      )
      chmodSync(shell, 0o755)

      const { buildSystemEnv, initializeSystemPath } = await import('../../src/main/system-path')
      await initializeSystemPath({ shell, timeoutMs: 5_000 })
      expect(buildSystemEnv({ PATH: '/gui-only/bin' }).PATH?.split(delimiter).slice(0, 2)).toEqual([
        '/shell-managed/bin',
        '/usr/bin'
      ])
    })
  })
})
