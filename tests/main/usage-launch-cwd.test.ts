import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { withIsolatedHome, writeJsonl } from '../helpers/isolated-main'

describe('usage scanning and launch cwd resolution', () => {
  it('aggregates recent token usage, costs, sessions, models, and daily buckets', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { addPriceEntry, setInstallState } = await import('../../src/main/store')
      const { readUsage } = await import('../../src/main/usage')
      const now = new Date().toISOString()
      const codexId = '22222222-3333-4444-5555-666666666666'
      const piFile = join(paths.cliConfig('pi'), 'sessions', 'repo', 'pi-usage.jsonl')

      setInstallState('claude-code', {
        installed: true,
        source: 'sandbox',
        binPath: join(paths.cliInstall('claude-code'), 'claude')
      })
      setInstallState('codex', {
        installed: true,
        source: 'sandbox',
        binPath: join(paths.cliInstall('codex'), 'codex')
      })
      setInstallState('pi', {
        installed: true,
        source: 'sandbox',
        binPath: join(paths.cliInstall('pi'), 'pi')
      })

      addPriceEntry('claude-code', {
        name: 'Claude Sonnet',
        model: 'claude-3-5-sonnet',
        inputPerMillion: 3,
        outputPerMillion: 15,
        cacheReadPerMillion: 0.3,
        cacheWritePerMillion: 3.75
      })
      addPriceEntry('codex', {
        name: 'GPT 5',
        model: 'gpt-5',
        inputPerMillion: 1,
        outputPerMillion: 10,
        cacheReadPerMillion: 0.1
      })

      writeJsonl(join(paths.cliConfig('claude-code'), 'projects', 'repo', 'claude-usage.jsonl'), [
        { type: 'user', timestamp: now, message: { role: 'user', content: 'Count this session' } },
        {
          type: 'assistant',
          timestamp: now,
          message: {
            id: 'msg-1',
            role: 'assistant',
            model: 'claude-3-5-sonnet-20241022',
            usage: {
              input_tokens: 1000,
              output_tokens: 200,
              cache_read_input_tokens: 300,
              cache_creation_input_tokens: 100
            },
            content: 'Done'
          }
        },
        {
          type: 'assistant',
          timestamp: now,
          message: {
            id: 'msg-1',
            role: 'assistant',
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 1000,
              output_tokens: 250,
              cache_read_input_tokens: 300,
              cache_creation_input_tokens: 100
            },
            content: 'Final replacement'
          }
        }
      ])

      writeJsonl(
        join(paths.cliConfig('codex'), 'sessions', '2026', '07', '08', `rollout-${codexId}.jsonl`),
        [
          { type: 'session_meta', timestamp: now, payload: { session_id: codexId, cwd: '/repo' } },
          {
            type: 'event_msg',
            timestamp: now,
            payload: { type: 'user_message', message: 'Codex usage session' }
          },
          { type: 'turn_context', timestamp: now, payload: { model: 'gpt-5-2026-01-01' } },
          {
            type: 'event_msg',
            timestamp: now,
            payload: {
              type: 'token_count',
              info: {
                model: 'gpt-5-2026-01-01',
                total_token_usage: {
                  input_tokens: 500,
                  cached_input_tokens: 100,
                  output_tokens: 50
                }
              }
            }
          },
          {
            type: 'event_msg',
            timestamp: now,
            payload: {
              type: 'token_count',
              info: {
                model: 'gpt-5-2026-01-01',
                total_token_usage: {
                  input_tokens: 900,
                  cached_input_tokens: 150,
                  output_tokens: 90
                }
              }
            }
          }
        ]
      )

      writeJsonl(piFile, [
        { type: 'session', id: 'pi-usage', cwd: '/repo', name: 'Pi usage session' },
        { type: 'message', timestamp: now, message: { role: 'user', content: 'Pi question' } },
        {
          type: 'message',
          timestamp: now,
          message: {
            role: 'assistant',
            model: 'openai/gpt-pi-20260101',
            usage: { input: 30, output: 40, cache: { read: 5, write: 6 } },
            cost: 0.123
          }
        }
      ])

      const result = await readUsage(7, 7)

      expect(result.rangeDays).toBe(7)
      expect(result.summaryDays).toBe(7)
      expect(result.errors).toEqual([])
      expect(result.requestCount).toBe(4)
      expect(result.sessionCount).toBe(3)
      expect(result.tokens).toEqual({
        inputTokens: 1780,
        outputTokens: 380,
        cacheReadTokens: 455,
        cacheCreationTokens: 106,
        totalTokens: 2721
      })
      expect(result.cost.totalCost).toBe(0.13188)
      expect(result.byCli.find((item) => item.cliId === 'claude-code')).toMatchObject({
        requestCount: 1,
        sessionCount: 1,
        tokens: {
          inputTokens: 1000,
          outputTokens: 250,
          cacheReadTokens: 300,
          cacheCreationTokens: 100,
          totalTokens: 1650
        }
      })
      expect(result.byCli.find((item) => item.cliId === 'codex')).toMatchObject({
        requestCount: 2,
        sessionCount: 1,
        tokens: {
          inputTokens: 750,
          outputTokens: 90,
          cacheReadTokens: 150,
          cacheCreationTokens: 0,
          totalTokens: 990
        }
      })
      expect(result.byCli.find((item) => item.cliId === 'pi')).toMatchObject({
        requestCount: 1,
        sessionCount: 1,
        cost: { totalCost: 0.123 }
      })
      expect(result.byModel.map((item) => item.model)).toEqual([
        'claude-3-5-sonnet',
        'gpt-5',
        'gpt-pi'
      ])
      expect(result.daily).toHaveLength(7)
      expect(result.daily.at(-1)?.tokens.totalTokens).toBe(2721)
    })
  })

  it('uses a valid launch cwd and falls back to the home directory for stale paths', async () => {
    await withIsolatedHome(async ({ home }) => {
      vi.resetModules()
      vi.doMock('node:os', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:os')>()
        return { ...actual, homedir: () => home }
      })

      const cwd = join(home, 'workspace')
      mkdirSync(cwd, { recursive: true })
      const { resolveLaunchCwd } = await import('../../src/main/launch-cwd')

      expect(resolveLaunchCwd(cwd)).toBe(cwd)
      expect(resolveLaunchCwd(join(home, 'missing'))).toBe(home)
      expect(resolveLaunchCwd('   ')).toBe(home)
    })
  })
})
