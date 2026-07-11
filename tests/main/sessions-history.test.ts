import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withIsolatedHome, writeJson, writeJsonl } from '../helpers/isolated-main'

describe('sessions history and transcripts', () => {
  it('lists and reads JSONL-backed sessions across CLIs', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { paths } = await import('../../src/main/sandbox')
      const { setInstallState } = await import('../../src/main/store')
      const { listSessions, readTranscript } = await import('../../src/main/sessions-history')
      const codexId = '11111111-2222-3333-4444-555555555555'

      for (const cliId of ['claude-code', 'codex', 'opencode', 'pi', 'hermes'] as const) {
        setInstallState(cliId, { installed: true, source: 'sandbox', binPath: join(paths.cliInstall(cliId), cliId) })
      }

      writeJsonl(join(paths.cliConfig('claude-code'), 'projects', 'repo', 'claude-session.jsonl'), [
        {
          type: 'user',
          timestamp: '2026-07-08T01:00:00.000Z',
          cwd: '/repo',
          message: { role: 'user', content: '<system-reminder>ignore</system-reminder>\nBuild the feature' }
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
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file body' }] }
        }
      ])

      writeJsonl(join(paths.cliConfig('codex'), 'sessions', '2026', '07', '08', `rollout-2026-07-08-${codexId}.jsonl`), [
        { type: 'session_meta', payload: { session_id: codexId, cwd: '/repo' }, timestamp: '2026-07-08T02:00:00.000Z' },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Implement Codex support' }, timestamp: '2026-07-08T02:01:00.000Z' },
        {
          type: 'response_item',
          payload: { type: 'function_call', call_id: 'call-1', name: 'shell', arguments: '{"command":"pnpm test"}' },
          timestamp: '2026-07-08T02:02:00.000Z'
        },
        {
          type: 'response_item',
          payload: { type: 'function_call_output', call_id: 'call-1', output: 'passed' },
          timestamp: '2026-07-08T02:03:00.000Z'
        }
      ])
      writeJsonl(join(paths.cliConfig('codex'), 'session_index.jsonl'), [
        { id: codexId, thread_name: 'Implement Codex session index', updated_at: '2026-07-08T02:01:30.000Z' }
      ])

      const piFile = join(paths.cliConfig('pi'), 'sessions', 'repo', 'pi-session.jsonl')
      writeJsonl(piFile, [
        { type: 'session', id: 'pi-session', cwd: '/repo', name: 'Pi saved session' },
        { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Hello Pi' }] } },
        { type: 'message', message: { role: 'assistant', content: 'Hello user' } }
      ])

      writeJson(join(paths.cliConfig('opencode'), 'xdg-data', 'opencode', 'storage', 'session', 'open.json'), {
        id: 'open-session',
        directory: '/repo',
        title: 'OpenCode title',
        time: { updated: 1783476123 }
      })

      writeJsonl(join(paths.cliConfig('hermes'), 'sessions', 'hermes-session.jsonl'), [
        { type: 'session', id: 'hermes-session', title: 'Hermes title', cwd: '/repo', timestamp: '2026-07-08T04:00:00.000Z' },
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
      expect(piTranscript.messages.map((message) => message.parts[0].text)).toEqual(['Hello Pi', 'Hello user'])

      expect(home).toContain('agent-launcher-test-')
    })
  })

  it('maps resume args and deletes sessions defensively', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { paths } = await import('../../src/main/sandbox')
      const { setInstallState } = await import('../../src/main/store')
      const { deleteSession, resumeArgs } = await import('../../src/main/sessions-history')

      setInstallState('claude-code', { installed: true, source: 'sandbox', binPath: join(paths.cliInstall('claude-code'), 'claude') })
      setInstallState('pi', { installed: true, source: 'sandbox', binPath: join(paths.cliInstall('pi'), 'pi') })
      const claudeFile = join(paths.cliConfig('claude-code'), 'projects', 'repo', 'delete-me.jsonl')
      const agentFile = join(paths.cliConfig('claude-code'), 'projects', 'repo', 'agent-delete-me-worker.jsonl')
      writeJsonl(claudeFile, [{ type: 'user', message: { role: 'user', content: 'delete' } }])
      writeJsonl(agentFile, [{ type: 'assistant', message: { role: 'assistant', content: 'agent' } }])

      expect(resumeArgs('claude-code', 'abc')).toEqual(['--resume', 'abc'])
      expect(resumeArgs('codex', 'abc')).toEqual(['resume', 'abc'])
      expect(resumeArgs('opencode', 'abc')).toEqual(['--session', 'abc'])
      expect(resumeArgs('pi', 'abc')).toEqual(['--session', 'abc'])
      expect(resumeArgs('hermes', 'abc')).toEqual(['--resume', 'abc'])

      await expect(deleteSession('claude-code', 'delete-me')).resolves.toMatchObject({ ok: true, deletedCount: 2 })
      expect(existsSync(claudeFile)).toBe(false)
      expect(existsSync(agentFile)).toBe(false)

      const outside = join(home, 'outside.jsonl')
      writeJsonl(outside, [{ type: 'session' }])
      await expect(deleteSession('pi', outside)).resolves.toMatchObject({
        ok: false,
        cliId: 'pi',
        error: 'Invalid session path'
      })
    })
  })
})
