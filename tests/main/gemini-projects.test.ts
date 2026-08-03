import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withIsolatedHome, writeJson, writeText } from '../helpers/isolated-main'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const isWin = process.platform === 'win32'

describe('decodeFlattenedPath', () => {
  // Windows 8.3 short names (e.g. RUNNER~1) cannot be reconciled with the
  // long names returned by readdirSync via pure string matching, so this
  // round-trip is only reliable on paths that do not contain short names.
  it.skipIf(isWin)('round-trips a real directory path through Claude Code flattening', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { __testing } = await import('../../src/main/gemini-projects')
      const dir = join(home, 'repos', 'known_repo')
      mkdirSync(dir, { recursive: true })
      const encoded = dir.replace(/[^A-Za-z0-9]/g, '-')
      expect(__testing.decodeFlattenedPath(encoded)).toContain(dir)
    })
  })
})

/** A minimal gemini-cli ChatRecordingService session file. */
function writeGeminiChat(
  file: string,
  sessionId: string,
  firstUserMessage: string,
  lastUpdated: string
): void {
  const header = {
    sessionId,
    startTime: lastUpdated,
    lastUpdated,
    kind: 'main'
  }
  const patch = {
    $set: {
      messages: [
        {
          id: 'msg-1',
          type: 'user',
          timestamp: lastUpdated,
          content: firstUserMessage
        },
        {
          id: 'msg-2',
          type: 'gemini',
          timestamp: lastUpdated,
          content: 'ok'
        }
      ],
      lastUpdated
    }
  }
  writeText(file, [JSON.stringify(header), JSON.stringify(patch)].join('\n') + '\n')
}

describe('gemini project directory resolution', () => {
  it('reads the project path from a slug bucket marker and the registry', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { geminiProjectResolver } = await import('../../src/main/gemini-projects')
      const state = join(home, '.gemini')
      const marked = join(state, 'tmp', 'port-scan')
      const registryOnly = join(state, 'tmp', 'ssh-manager')
      mkdirSync(marked, { recursive: true })
      mkdirSync(registryOnly, { recursive: true })
      writeText(join(marked, '.project_root'), '/work/port-scan\n')
      writeJson(join(state, 'projects.json'), {
        projects: { '/work/ssh-manager': 'ssh-manager' }
      })

      const resolver = geminiProjectResolver(state)
      expect(resolver.resolve(marked, 'port-scan')).toBe('/work/port-scan')
      expect(resolver.resolve(registryOnly, 'ssh-manager')).toBe('/work/ssh-manager')
      expect(resolver.resolve(join(state, 'tmp', 'nope'), 'nope')).toBeUndefined()
    })
  })

  it.skipIf(isWin)(
    'recovers a legacy sha256 bucket from a sibling of a Claude Code project',
    async () => {
      await withIsolatedHome(async ({ home }) => {
        const { geminiProjectResolver } = await import('../../src/main/gemini-projects')
        // Claude Code has only seen `known`; gemini's bucket is for its sibling,
        // which the sibling scan reaches and the hash confirms.
        const known = join(home, 'repos', 'known_repo')
        const sibling = join(home, 'repos', 'other-repo')
        mkdirSync(known, { recursive: true })
        mkdirSync(sibling, { recursive: true })
        const encoded = known.replace(/[^A-Za-z0-9]/g, '-')
        mkdirSync(join(home, '.claude', 'projects', encoded), { recursive: true })

        const state = join(home, '.gemini')
        const bucket = join(state, 'tmp', sha256(sibling))
        mkdirSync(bucket, { recursive: true })

        expect(geminiProjectResolver(state).resolve(bucket, sha256(sibling))).toBe(sibling)
      })
    }
  )

  it('leaves an unmatchable legacy bucket unassociated rather than guessing', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { geminiProjectResolver } = await import('../../src/main/gemini-projects')
      const state = join(home, '.gemini')
      const hash = sha256('/somewhere/never-seen')
      const bucket = join(state, 'tmp', hash)
      mkdirSync(bucket, { recursive: true })

      expect(geminiProjectResolver(state).resolve(bucket, hash)).toBeUndefined()
    })
  })

  it('tags listed gemini sessions with their bucket directory', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { setInstallState } = await import('../../src/main/store')
      const { listSessions } = await import('../../src/main/sessions-history')
      setInstallState('gemini', { installed: true, binPath: '/usr/local/bin/gemini' })

      const tmp = join(home, '.gemini', 'tmp')
      const withCwd = join(tmp, 'port-scan')
      const withoutCwd = join(tmp, 'a'.repeat(64))
      writeText(join(withCwd, '.project_root'), '/work/port-scan')
      writeGeminiChat(
        join(withCwd, 'chats', 'session-1.jsonl'),
        's-1',
        '扫端口',
        '2025-07-07T10:00:00.000Z'
      )
      writeGeminiChat(
        join(withoutCwd, 'chats', 'session-2.jsonl'),
        's-2',
        'hello',
        '2025-07-07T11:00:00.000Z'
      )

      const sessions = await listSessions('gemini')
      expect(sessions.find((s) => s.id === 's-1')?.cwd).toBe('/work/port-scan')
      expect(sessions.find((s) => s.id === 's-2')?.cwd).toBeUndefined()
    })
  })

  it('attributes a session shared across buckets to its newest bucket', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { setInstallState } = await import('../../src/main/store')
      const { listSessions } = await import('../../src/main/sessions-history')
      setInstallState('gemini', { installed: true, binPath: '/usr/local/bin/gemini' })

      const tmp = join(home, '.gemini', 'tmp')
      const older = join(tmp, 'older')
      const newer = join(tmp, 'newer')
      writeText(join(older, '.project_root'), '/work/older')
      writeText(join(newer, '.project_root'), '/work/newer')
      writeGeminiChat(
        join(older, 'chats', 'session-old.jsonl'),
        'dup',
        'first',
        '2025-07-07T10:00:00.000Z'
      )
      writeGeminiChat(
        join(newer, 'chats', 'session-new.jsonl'),
        'dup',
        'later',
        '2025-07-08T10:00:00.000Z'
      )

      const sessions = await listSessions('gemini')
      expect(sessions.filter((s) => s.id === 'dup')).toHaveLength(1)
      expect(sessions.find((s) => s.id === 'dup')?.cwd).toBe('/work/newer')
    })
  })
})
