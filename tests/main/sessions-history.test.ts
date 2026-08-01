import { existsSync, readFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withIsolatedHome, writeJson, writeJsonl, writeText } from '../helpers/isolated-main'

describe('sessions history and transcripts', () => {
  it('reads gemini sessions from chats/*.jsonl, not the legacy logs.json', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { listSessions, readTranscript, resumeArgs } =
        await import('../../src/main/sessions-history')
      const projectDir = join(home, '.gemini', 'tmp', 'my-project')
      writeText(join(projectDir, '.project_root'), '/Users/tester/my-project')

      // Header + first-message shape verified against a real gemini-cli
      // install; the "gemini" role type and resumability/ignored-content
      // rules below are copied from gemini-cli's own bundled source (see
      // parseGeminiChatFile's comment). The multi-$set accumulation shape
      // itself (whether $set replaces vs. appends messages) is still
      // untested against a real multi-turn exchange, hence the id-dedup
      // approach that's tolerant of either.
      writeJsonl(join(projectDir, 'chats', 'session-2026-07-22T04-25-247f2185.jsonl'), [
        {
          sessionId: '247f2185-f58d-4847-bcca-227f7b325f81',
          projectHash: 'e719f6418e79f37ee3f4d03bef0a3a1e56a800108c0a87b132da8760824b1264',
          startTime: '2026-07-22T04:25:09.902Z',
          lastUpdated: '2026-07-22T04:25:09.902Z',
          kind: 'main'
        },
        {
          $set: {
            messages: [
              {
                id: 'ctx-msg',
                timestamp: '2026-07-22T04:25:09.903Z',
                type: 'user',
                content: [{ text: '<session_context>\nignored setup text\n</session_context>' }]
              },
              {
                id: 'real-question',
                timestamp: '2026-07-22T04:25:20.000Z',
                type: 'user',
                content: [{ text: 'What does this repo do?' }]
              }
            ],
            lastUpdated: '2026-07-22T04:25:20.000Z'
          }
        },
        {
          $set: {
            messages: [
              {
                id: 'model-reply',
                timestamp: '2026-07-22T04:25:21.000Z',
                type: 'gemini',
                content: [{ text: 'It is a CLI launcher.' }]
              }
            ],
            lastUpdated: '2026-07-22T04:25:21.000Z'
          }
        }
      ])

      // A stale logs.json entry with an unrelated id — must NOT be what gets
      // surfaced, since it's exactly the kind of legacy entry that produced
      // "Invalid session identifier" on resume in the original bug report.
      writeJson(join(projectDir, 'logs.json'), [
        {
          sessionId: 'stale-legacy-id-not-resumable',
          timestamp: '2026-07-01T00:00:00.000Z',
          message: 'an old, unrelated prompt'
        }
      ])

      const sessions = await listSessions('gemini')
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({
        id: '247f2185-f58d-4847-bcca-227f7b325f81',
        name: 'What does this repo do?',
        cwd: '/Users/tester/my-project'
      })

      expect(resumeArgs('gemini', sessions[0].id)).toEqual(['--resume', sessions[0].id])

      const transcript = await readTranscript('gemini', sessions[0].id)
      expect(transcript.messages).toEqual([
        {
          role: 'user',
          parts: [{ kind: 'text', text: 'What does this repo do?' }],
          ts: new Date('2026-07-22T04:25:20.000Z').getTime()
        },
        {
          role: 'assistant',
          parts: [{ kind: 'text', text: 'It is a CLI launcher.' }],
          ts: new Date('2026-07-22T04:25:21.000Z').getTime()
        }
      ])
    })
  })

  it('hides a gemini session that never got past the auto-injected context message', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { listSessions } = await import('../../src/main/sessions-history')
      const projectDir = join(home, '.gemini', 'tmp', 'empty-project')

      // Exact shape observed on a real machine: a session started (e.g. hit
      // an auth/trust prompt) but the user never actually asked anything, so
      // gemini-cli's own --list-sessions/--resume treat it as not resumable.
      writeJsonl(join(projectDir, 'chats', 'session-2026-07-30T21-09-39acce00.jsonl'), [
        {
          sessionId: '39acce00-1c4b-49f5-9814-69c7e53b55ac',
          startTime: '2026-07-30T21:09:46.170Z',
          lastUpdated: '2026-07-30T21:09:46.170Z',
          kind: 'main'
        },
        {
          $set: {
            messages: [
              {
                id: 'ctx-msg',
                timestamp: '2026-07-30T21:09:46.171Z',
                type: 'user',
                content: [{ text: '<session_context>\nsetup only, no real question\n' }]
              }
            ],
            lastUpdated: '2026-07-30T21:09:46.171Z'
          }
        }
      ])

      expect(await listSessions('gemini')).toEqual([])
    })
  })

  it('reads a live message appended as a bare line, not wrapped in $set', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { listSessions, readTranscript } = await import('../../src/main/sessions-history')
      const projectDir = join(home, '.gemini', 'tmp', 'agent-launcher')
      writeText(join(projectDir, '.project_root'), 'D:\\a\\agent-launcher\\agent-launcher')

      // Verbatim shape captured from a real gemini-cli 0.53.1 run (fresh
      // install, `gemini -p "hello" --yolo --skip-trust`, real
      // chats/*.jsonl inspected directly on a GitHub Actions windows-latest
      // runner): the "hello" line is a bare {id, type, content} record, NOT
      // wrapped in $set — only the context-injection line and the metadata
      // resave use $set. An earlier version of parseGeminiChatFile only
      // looked inside $set.messages, so this line was silently dropped and
      // the session looked contentless (see the comment above
      // parseGeminiChatFile).
      writeJsonl(join(projectDir, 'chats', 'session-2026-08-01T00-16-de76c90b.jsonl'), [
        {
          sessionId: 'de76c90b-0a7c-4295-9df2-17f914ca4668',
          projectHash: '4c41897800f26c19076d552a595a13ac1bf9e078bec2b98b791e00cae121727e',
          startTime: '2026-08-01T00:16:33.369Z',
          lastUpdated: '2026-08-01T00:16:33.369Z',
          kind: 'main'
        },
        {
          $set: {
            messages: [
              {
                id: 'd04923d38bb0f6017037e74183378ef4',
                timestamp: '2026-08-01T00:16:33.371Z',
                type: 'user',
                content: [
                  { text: '<session_context>\nThis is the Gemini CLI.\n</session_context>' }
                ]
              }
            ],
            lastUpdated: '2026-08-01T00:16:33.371Z'
          }
        },
        {
          id: '1d338b41-8c34-4041-a950-362e94bca360',
          timestamp: '2026-08-01T00:16:33.826Z',
          type: 'user',
          content: [{ text: 'hello' }]
        },
        { $set: { lastUpdated: '2026-08-01T00:16:33.827Z' } }
      ])

      const sessions = await listSessions('gemini')
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({
        id: 'de76c90b-0a7c-4295-9df2-17f914ca4668',
        name: 'hello'
      })

      const transcript = await readTranscript('gemini', sessions[0].id)
      expect(transcript.messages).toEqual([
        {
          role: 'user',
          parts: [{ kind: 'text', text: 'hello' }],
          ts: new Date('2026-08-01T00:16:33.826Z').getTime()
        }
      ])
    })
  })

  it('deletes a gemini session by the 1-based startTime-ascending index gemini-cli itself expects', async () => {
    // The fake `gemini` binary below is a #!/bin/sh script; Windows has no
    // shebang support, so this is skipped there like the other fake-binary
    // process tests in this repo (see platform-process.test.ts).
    if (process.platform === 'win32') return
    await withIsolatedHome(async ({ home }) => {
      const { chmodSync, mkdirSync, writeFileSync: writeFile } = await import('node:fs')
      const { paths } = await import('../../src/main/sandbox')
      const { setInstallState } = await import('../../src/main/store')
      const { deleteSession } = await import('../../src/main/sessions-history')

      const projectDir = join(home, '.gemini', 'tmp', 'my-project')
      // A real, existing directory — Node's spawn needs `cwd` to actually
      // exist or it fails with ENOENT before the command even runs.
      const realProjectCwd = join(home, 'workspace')
      mkdirSync(realProjectCwd, { recursive: true })
      writeText(join(projectDir, '.project_root'), realProjectCwd)

      const chatEntry = (sessionId: string, isoTime: string, text: string) => [
        { sessionId, startTime: isoTime, lastUpdated: isoTime, kind: 'main' },
        {
          $set: {
            messages: [{ id: 'm1', timestamp: isoTime, type: 'user', content: [{ text }] }],
            lastUpdated: isoTime
          }
        }
      ]
      // Older session first, newer second — startTime-ascending index of the
      // second (newer) one should be 2.
      writeJsonl(
        join(projectDir, 'chats', 'session-a.jsonl'),
        chatEntry(
          '11111111-1111-1111-1111-111111111111',
          '2026-07-01T00:00:00.000Z',
          'first question'
        )
      )
      writeJsonl(
        join(projectDir, 'chats', 'session-b.jsonl'),
        chatEntry(
          '22222222-2222-2222-2222-222222222222',
          '2026-07-02T00:00:00.000Z',
          'second question'
        )
      )

      // Stand-in for the real `gemini` binary: records its argv + cwd instead
      // of actually running gemini-cli (no real install/API key needed to
      // verify the index/cwd this code computes and passes).
      mkdirSync(paths.cliInstall('gemini'), { recursive: true })
      const fakeGeminiPath = join(paths.cliInstall('gemini'), 'fake-gemini.sh')
      const recordPath = join(paths.cliInstall('gemini'), 'invocation.json')
      // Plain text (cwd on line 1, one arg per line after) rather than JSON —
      // no escaping/trailing-comma bookkeeping needed in a throwaway shell script.
      writeFile(
        fakeGeminiPath,
        `#!/bin/sh\nprintf '%s\\n' "$PWD" > "${recordPath}"\nfor a in "$@"; do printf '%s\\n' "$a" >> "${recordPath}"; done\nexit 0\n`
      )
      chmodSync(fakeGeminiPath, 0o755)
      setInstallState('gemini', { installed: true, source: 'system', binPath: fakeGeminiPath })

      const result = await deleteSession('gemini', '22222222-2222-2222-2222-222222222222')
      expect(result).toMatchObject({ ok: true, deletedCount: 1 })

      const { realpathSync } = await import('node:fs')
      const [recordedCwd, ...recordedArgs] = readFileSync(recordPath, 'utf8').trim().split('\n')
      // Compare canonical paths — macOS resolves $PWD through the
      // /var -> /private/var symlink, which is unrelated to what's tested here.
      expect(realpathSync(recordedCwd)).toBe(realpathSync(realProjectCwd))
      expect(recordedArgs).toEqual(['--delete-session', '2'])
    })
  })

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
