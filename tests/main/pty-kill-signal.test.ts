import { describe, expect, it, vi } from 'vitest'
import { withIsolatedHome } from '../helpers/isolated-main'

function fakeWebContents() {
  return { isDestroyed: () => false, send: vi.fn() } as any
}

describe('killSession signal choice', () => {
  it("kills a gemini session's whole process group with SIGKILL, skipping gemini-cli's own exit-time cleanup", async () => {
    // gemini-cli's shebang wrapper re-execs itself as a *child* process (to
    // raise --max-old-space-size), so the pty's direct child is only that
    // thin wrapper — the real gemini-cli process is its child. Killing just
    // proc.pid leaves that real process orphaned, still running its own
    // (catchable) exit cleanup. node-pty starts its child in a new session,
    // so proc.pid doubles as the process group id — must kill the group.
    // Windows doesn't support custom signals or negative pids, so pty.ts
    // skips the group-kill there entirely — nothing to test on that platform.
    if (process.platform === 'win32') return
    await withIsolatedHome(async () => {
      const procKill = vi.fn()
      vi.doMock('@lydell/node-pty', () => ({
        spawn: vi.fn(() => ({
          onData: vi.fn(),
          onExit: vi.fn(),
          kill: procKill,
          resize: vi.fn(),
          write: vi.fn(),
          pid: 4242
        }))
      }))
      const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

      const { setInstallState } = await import('../../src/main/store')
      const { createSession, killSession } = await import('../../src/main/pty')

      setInstallState('gemini', { installed: true, binPath: '/usr/local/bin/gemini' })

      const id = await createSession(fakeWebContents(), {
        cliId: 'gemini',
        mode: 'cli',
        cwd: '/tmp'
      })
      killSession(id)

      expect(processKill).toHaveBeenCalledWith(-4242, 'SIGKILL')
      expect(procKill).not.toHaveBeenCalled()

      processKill.mockRestore()
      vi.doUnmock('@lydell/node-pty')
    })
  })

  it('falls back to killing just the pty process if group-kill fails', async () => {
    // Windows doesn't support custom signals or negative pids, so pty.ts
    // skips the group-kill there entirely — nothing to test on that platform.
    if (process.platform === 'win32') return
    await withIsolatedHome(async () => {
      const procKill = vi.fn()
      vi.doMock('@lydell/node-pty', () => ({
        spawn: vi.fn(() => ({
          onData: vi.fn(),
          onExit: vi.fn(),
          kill: procKill,
          resize: vi.fn(),
          write: vi.fn(),
          pid: 4244
        }))
      }))
      const processKill = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH')
      })

      const { setInstallState } = await import('../../src/main/store')
      const { createSession, killSession } = await import('../../src/main/pty')

      setInstallState('gemini', { installed: true, binPath: '/usr/local/bin/gemini' })

      const id = await createSession(fakeWebContents(), {
        cliId: 'gemini',
        mode: 'cli',
        cwd: '/tmp'
      })
      killSession(id)

      expect(processKill).toHaveBeenCalledWith(-4244, 'SIGKILL')
      expect(procKill).toHaveBeenCalledWith('SIGKILL')

      processKill.mockRestore()
      vi.doUnmock('@lydell/node-pty')
    })
  })

  it("leaves other CLIs on node-pty's default signal", async () => {
    await withIsolatedHome(async () => {
      const kill = vi.fn()
      vi.doMock('@lydell/node-pty', () => ({
        spawn: vi.fn(() => ({
          onData: vi.fn(),
          onExit: vi.fn(),
          kill,
          resize: vi.fn(),
          write: vi.fn(),
          pid: 4243
        }))
      }))
      const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

      const { setInstallState } = await import('../../src/main/store')
      const { createSession, killSession } = await import('../../src/main/pty')

      setInstallState('claude-code', { installed: true, binPath: '/usr/local/bin/claude' })

      const id = await createSession(fakeWebContents(), {
        cliId: 'claude-code',
        mode: 'cli',
        cwd: '/tmp'
      })
      killSession(id)

      expect(kill).toHaveBeenCalledTimes(1)
      expect(kill).toHaveBeenCalledWith()
      expect(processKill).not.toHaveBeenCalled()

      processKill.mockRestore()
      vi.doUnmock('@lydell/node-pty')
    })
  })
})
