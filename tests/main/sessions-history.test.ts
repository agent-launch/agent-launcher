import { existsSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withIsolatedHome, writeJson, writeJsonl } from '../helpers/isolated-main'

describe('sessions history and transcripts', () => {
  it('lists and reads JSONL-backed sessions across CLIs', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { systemCliConfigDir } = await import('../../src/main/config-paths')
      const { setInstallState } = await import('../../src/main/store')
      const { listSessions, readTranscript } = await import('../../src/main/sessions-history')
      const codexId = '11111111-2222-3333-4444-555555555555'

      for (const cliId of ['claude-code', 'codex', 'pi', 'hermes'] as const) {
        setInstallState(cliId, {
          installed: true,
          binPath: `/usr/local/bin/${cliId}`
        })
      }
      setInstallState('opencode', {
        installed: true,
        binPath: '/usr/local/bin/opencode'
      })

      writeJsonl(
        join(systemCliConfigDir('claude-code'), 'projects', 'repo', 'claude-session.jsonl'),
        [
          {
            type: 'user',
            timestamp: '2026-07-08T01:00:00.000Z',
            cwd: '/repo',
            message: {
              role: 'user',
              content: '<system-reminder>ignore</system-reminder>\nBuild the feature'
            }
          },
          {
            type: 'assistant',
            timestamp: '2026-07-08T01:01:00.000Z',
            message: {
              role: 'assistant',
              content: [
                { type: 'text', text: 'Sure' },
                { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/a.ts' } }
              ]
            }
          },
          {
            type: 'user',
            timestamp: '2026-07-08T01:02:00.000Z',
            message: {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file body' }]
            }
          }
        ]
      )

      writeJsonl(
        join(
          systemCliConfigDir('codex'),
          'sessions',
          '2026',
          '07',
          '08',
          `rollout-2026-07-08-${codexId}.jsonl`
        ),
        [
          {
            type: 'session_meta',
            payload: { session_id: codexId, cwd: '/repo' },
            timestamp: '2026-07-08T02:00:00.000Z'
          },
          {
            type: 'event_msg',
            payload: { type: 'user_message', message: 'Implement Codex support' },
            timestamp: '2026-07-08T02:01:00.000Z'
          },
          {
            type: 'response_item',
            payload: {
              type: 'function_call',
              call_id: 'call-1',
              name: 'shell',
              arguments: '{"command":"pnpm test"}'
            },
            timestamp: '2026-07-08T02:02:00.000Z'
          },
          {
            type: 'response_item',
            payload: { type: 'function_call_output', call_id: 'call-1', output: 'passed' },
            timestamp: '2026-07-08T02:03:00.000Z'
          }
        ]
      )
      writeJsonl(join(systemCliConfigDir('codex'), 'session_index.jsonl'), [
        {
          id: codexId,
          thread_name: 'Implement Codex session index',
          updated_at: '2026-07-08T02:01:30.000Z'
        }
      ])

      const piFile = join(systemCliConfigDir('pi'), 'sessions', 'repo', 'pi-session.jsonl')
      writeJsonl(piFile, [
        { type: 'session', id: 'pi-session', cwd: '/repo', name: 'Pi saved session' },
        {
          type: 'message',
          message: { role: 'user', content: [{ type: 'text', text: 'Hello Pi' }] }
        },
        { type: 'message', message: { role: 'assistant', content: 'Hello user' } }
      ])

      writeJson(join(home, '.local', 'share', 'opencode', 'storage', 'session', 'open.json'), {
        id: 'open-session',
        directory: '/repo',
        title: 'OpenCode title',
        time: { updated: 1783476123 }
      })

      writeJsonl(join(systemCliConfigDir('hermes'), 'sessions', 'hermes-session.jsonl'), [
        {
          type: 'session',
          id: 'hermes-session',
          title: 'Hermes title',
          cwd: '/repo',
          timestamp: '2026-07-08T04:00:00.000Z'
        },
        { role: 'user', content: 'Hello Hermes', timestamp: '2026-07-08T04:01:00.000Z' }
      ])

      await expect(listSessions('claude-code')).resolves.toMatchObject([
        { id: 'claude-session', cliId: 'claude-code', name: 'Build the feature', cwd: '/repo' }
      ])
      await expect(listSessions('codex')).resolves.toMatchObject([
        { id: codexId, cliId: 'codex', name: 'Implement Codex session index', cwd: '/repo' }
      ])
      await expect(listSessions('pi')).resolves.toMatchObject([
        { id: piFile, cliId: 'pi', name: 'Pi saved session', cwd: '/repo' }
      ])
      await expect(listSessions('opencode')).resolves.toMatchObject([
        { id: 'open-session', cliId: 'opencode', name: 'OpenCode title', cwd: '/repo' }
      ])
      await expect(listSessions('hermes')).resolves.toMatchObject([
        { id: 'hermes-session', cliId: 'hermes', name: 'Hermes title', cwd: '/repo' }
      ])

      const claudeTranscript = await readTranscript('claude-code', 'claude-session')
      expect(claudeTranscript.messages[0].parts[0].text).toBe('Build the feature')
      expect(claudeTranscript.messages[1].parts[1]).toMatchObject({
        kind: 'tool',
        tool: 'Read',
        detail: '/repo/a.ts',
        result: 'file body',
        status: 'completed'
      })

      const codexTranscript = await readTranscript('codex', codexId)
      expect(codexTranscript.messages[0].parts[0].text).toBe('Implement Codex support')
      expect(codexTranscript.messages[1].parts[0]).toMatchObject({
        kind: 'tool',
        tool: 'shell',
        detail: 'pnpm test',
        result: 'passed'
      })

      const piTranscript = await readTranscript('pi', piFile)
      expect(piTranscript.messages.map((message) => message.parts[0].text)).toEqual([
        'Hello Pi',
        'Hello user'
      ])

      expect(home).toContain('agent-launcher-test-')
    })
  })

  it('maps resume args and deletes sessions defensively', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { systemCliConfigDir } = await import('../../src/main/config-paths')
      const { setInstallState } = await import('../../src/main/store')
      const { deleteSession, resumeArgs } = await import('../../src/main/sessions-history')

      setInstallState('claude-code', {
        installed: true,
        binPath: '/usr/local/bin/claude'
      })
      setInstallState('pi', {
        installed: true,
        binPath: '/usr/local/bin/pi'
      })
      const claudeFile = join(
        systemCliConfigDir('claude-code'),
        'projects',
        'repo',
        'delete-me.jsonl'
      )
      const agentFile = join(
        systemCliConfigDir('claude-code'),
        'projects',
        'repo',
        'agent-delete-me-worker.jsonl'
      )
      writeJsonl(claudeFile, [{ type: 'user', message: { role: 'user', content: 'delete' } }])
      writeJsonl(agentFile, [
        { type: 'assistant', message: { role: 'assistant', content: 'agent' } }
      ])

      expect(resumeArgs('claude-code', 'abc')).toEqual(['--resume', 'abc'])
      expect(resumeArgs('codex', 'abc')).toEqual(['resume', 'abc'])
      expect(resumeArgs('opencode', 'abc')).toEqual(['--session', 'abc'])
      expect(resumeArgs('pi', 'abc')).toEqual(['--session', 'abc'])
      expect(resumeArgs('hermes', 'abc')).toEqual(['--resume', 'abc'])

      await expect(deleteSession('claude-code', 'delete-me')).resolves.toMatchObject({
        ok: true,
        deletedCount: 2
      })
      expect(existsSync(claudeFile)).toBe(false)
      expect(existsSync(agentFile)).toBe(false)

      const outside = join(home, 'outside.jsonl')
      writeJsonl(outside, [{ type: 'session' }])
      await expect(deleteSession('pi', outside)).resolves.toMatchObject({
        ok: false,
        cliId: 'pi',
        error: 'Invalid session path'
      })

      const nonSessionFile = join(systemCliConfigDir('pi'), 'sessions', 'repo', 'notes.txt')
      writeJsonl(nonSessionFile, [{ type: 'session' }])
      await expect(deleteSession('pi', nonSessionFile)).resolves.toMatchObject({
        ok: false,
        cliId: 'pi',
        error: 'Invalid session path'
      })
      expect(existsSync(nonSessionFile)).toBe(true)
    })
  })

  it('merges legacy sandbox sessions with standard-dir sessions for file-based CLIs', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { systemCliConfigDir } = await import('../../src/main/config-paths')
      const { setInstallState } = await import('../../src/main/store')
      const { deleteSession, listSessions, readTranscript } =
        await import('../../src/main/sessions-history')

      // Simulate a legacy app-managed install: the binary lives under the app's
      // managed root, so legacyManaged is true, but config/state now reads from
      // the standard dir AND the leftover legacy dir.
      setInstallState('claude-code', {
        installed: true,
        binPath: join(paths.cliInstall('claude-code'), 'claude')
      })

      const standardDir = systemCliConfigDir('claude-code')
      const legacyDir = paths.cliConfig('claude-code')

      writeJsonl(join(standardDir, 'projects', 'repo', 'standard-session.jsonl'), [
        {
          type: 'user',
          timestamp: '2026-07-08T01:00:00.000Z',
          cwd: '/repo',
          message: { role: 'user', content: 'Standard session' }
        }
      ])
      writeJsonl(join(legacyDir, 'projects', 'legacy', 'legacy-session.jsonl'), [
        {
          type: 'user',
          timestamp: '2026-07-08T02:00:00.000Z',
          cwd: '/legacy',
          message: { role: 'user', content: 'Legacy session' }
        }
      ])

      const sessions = await listSessions('claude-code')
      const ids = sessions.map((s) => s.id).sort()
      expect(ids).toEqual(['legacy-session', 'standard-session'])

      const legacyTranscript = await readTranscript('claude-code', 'legacy-session')
      expect(legacyTranscript.messages[0]?.parts[0]?.text).toBe('Legacy session')

      await expect(deleteSession('claude-code', 'legacy-session')).resolves.toMatchObject({
        ok: true,
        deletedCount: 1
      })
      expect(existsSync(join(legacyDir, 'projects', 'legacy', 'legacy-session.jsonl'))).toBe(false)
    })
  })

  it('uses the newest duplicate session and deletes every migrated copy', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { systemCliConfigDir } = await import('../../src/main/config-paths')
      const { deleteSession, listSessions, readTranscript } =
        await import('../../src/main/sessions-history')
      const oldTime = new Date('2026-07-08T01:00:00.000Z')
      const newTime = new Date('2026-07-08T02:00:00.000Z')

      const standardClaude = join(
        systemCliConfigDir('claude-code'),
        'projects',
        'repo',
        'duplicate-claude.jsonl'
      )
      const legacyClaude = join(
        paths.cliConfig('claude-code'),
        'projects',
        'repo',
        'duplicate-claude.jsonl'
      )
      writeJsonl(standardClaude, [
        {
          type: 'user',
          timestamp: oldTime.toISOString(),
          message: { role: 'user', content: 'Older Claude copy' }
        }
      ])
      writeJsonl(legacyClaude, [
        {
          type: 'user',
          timestamp: newTime.toISOString(),
          message: { role: 'user', content: 'Newer Claude copy' }
        }
      ])
      utimesSync(standardClaude, oldTime, oldTime)
      utimesSync(legacyClaude, newTime, newTime)

      const claudeSessions = (await listSessions('claude-code')).filter(
        (session) => session.id === 'duplicate-claude'
      )
      expect(claudeSessions).toMatchObject([{ name: 'Newer Claude copy' }])
      await expect(readTranscript('claude-code', 'duplicate-claude')).resolves.toMatchObject({
        messages: [{ parts: [{ text: 'Newer Claude copy' }] }]
      })
      await expect(deleteSession('claude-code', 'duplicate-claude')).resolves.toMatchObject({
        ok: true,
        deletedCount: 2
      })
      expect(existsSync(standardClaude)).toBe(false)
      expect(existsSync(legacyClaude)).toBe(false)

      const codexId = '33333333-4444-5555-6666-777777777777'
      const standardCodex = join(
        systemCliConfigDir('codex'),
        'sessions',
        '2026',
        '07',
        '08',
        `rollout-standard-${codexId}.jsonl`
      )
      const legacyCodex = join(
        paths.cliConfig('codex'),
        'sessions',
        '2026',
        '07',
        '08',
        `rollout-legacy-${codexId}.jsonl`
      )
      writeJsonl(standardCodex, [
        { type: 'session_meta', payload: { session_id: codexId, cwd: '/repo' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Older Codex copy' } }
      ])
      writeJsonl(legacyCodex, [
        { type: 'session_meta', payload: { session_id: codexId, cwd: '/repo' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Newer Codex copy' } }
      ])
      const standardCodexIndex = join(systemCliConfigDir('codex'), 'session_index.jsonl')
      const legacyCodexIndex = join(paths.cliConfig('codex'), 'session_index.jsonl')
      writeJsonl(standardCodexIndex, [{ id: codexId, thread_name: 'Standard Codex title' }])
      writeJsonl(legacyCodexIndex, [{ id: codexId, thread_name: 'Legacy Codex title' }])
      utimesSync(standardCodex, oldTime, oldTime)
      utimesSync(legacyCodex, newTime, newTime)
      utimesSync(standardCodexIndex, oldTime, oldTime)
      utimesSync(legacyCodexIndex, newTime, newTime)

      const codexSessions = (await listSessions('codex')).filter(
        (session) => session.id === codexId
      )
      expect(codexSessions).toMatchObject([{ name: 'Legacy Codex title' }])
      await expect(readTranscript('codex', codexId)).resolves.toMatchObject({
        messages: [{ parts: [{ text: 'Newer Codex copy' }] }]
      })
      await expect(deleteSession('codex', codexId)).resolves.toMatchObject({
        ok: true,
        deletedCount: 2
      })
      expect(existsSync(standardCodex)).toBe(false)
      expect(existsSync(legacyCodex)).toBe(false)

      const standardPi = join(systemCliConfigDir('pi'), 'sessions', 'repo', 'duplicate-pi.jsonl')
      const legacyPi = join(paths.cliConfig('pi'), 'sessions', 'repo', 'duplicate-pi.jsonl')
      writeJsonl(standardPi, [{ type: 'session', id: 'duplicate-pi', name: 'Older Pi copy' }])
      writeJsonl(legacyPi, [{ type: 'session', id: 'duplicate-pi', name: 'Newer Pi copy' }])
      utimesSync(standardPi, oldTime, oldTime)
      utimesSync(legacyPi, newTime, newTime)

      const piSessions = (await listSessions('pi')).filter(
        (session) => session.name === 'Newer Pi copy'
      )
      expect(piSessions).toHaveLength(1)
      expect(piSessions[0].id).toBe(legacyPi)
      await expect(deleteSession('pi', legacyPi)).resolves.toMatchObject({
        ok: true,
        deletedCount: 2
      })
      expect(existsSync(standardPi)).toBe(false)
      expect(existsSync(legacyPi)).toBe(false)
    })
  })
})
