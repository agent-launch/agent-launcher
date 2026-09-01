import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withIsolatedHome } from '../helpers/isolated-main'

describe('usage', () => {
  it('ConcatenatedJsonScanner produces same result as full-string parser', async () => {
    const { ConcatenatedJsonScanner, splitConcatenatedJsonObjects } =
      await import('../../src/main/usage')

    const text = `{
  "a": 1
}{
  "b": 2
}`
    const scanner = new ConcatenatedJsonScanner()
    const streamed: string[] = []
    for (const chunk of ['', text, '']) {
      streamed.push(...scanner.push(chunk))
    }
    scanner.flush()

    expect(streamed.map((s) => JSON.parse(s))).toEqual(
      splitConcatenatedJsonObjects(text).map((s) => JSON.parse(s))
    )
  })

  it('ConcatenatedJsonScanner handles objects split across arbitrary chunk boundaries', async () => {
    const { ConcatenatedJsonScanner } = await import('../../src/main/usage')

    const obj1 = JSON.stringify({ n: 1, text: 'a { b } "quoted" c' }, null, 2)
    const obj2 = JSON.stringify({ n: 2, nested: { value: 3 } }, null, 2)
    const text = obj1 + obj2

    for (let splitAt = 1; splitAt < text.length; splitAt++) {
      const scanner = new ConcatenatedJsonScanner()
      const out: string[] = []
      out.push(...scanner.push(text.slice(0, splitAt)))
      out.push(...scanner.push(text.slice(splitAt)))
      scanner.flush()
      expect(out).toHaveLength(2)
      expect(JSON.parse(out[0])).toEqual({ n: 1, text: 'a { b } "quoted" c' })
      expect(JSON.parse(out[1])).toEqual({ n: 2, nested: { value: 3 } })
    }
  })

  it('ConcatenatedJsonScanner discards oversized incomplete objects', async () => {
    const { ConcatenatedJsonScanner } = await import('../../src/main/usage')

    const scanner = new ConcatenatedJsonScanner(16)
    // Start an object and exceed the 16-byte buffer limit without closing it.
    const out = scanner.push('{ "a": "xxxxxxxxxxxx')
    expect(out).toEqual([])
    // After the oversized incomplete object is dropped, a subsequent complete
    // object should parse normally even with leading garbage.
    const out2 = scanner.push('garbage{ "b": 2 }')
    expect(out2).toHaveLength(1)
    expect(JSON.parse(out2[0])).toEqual({ b: 2 })
  })

  it('readUsage streams a large Gemini telemetry log without loading it whole', async () => {
    await withIsolatedHome(async () => {
      const { geminiUsageLogPath } = await import('../../src/main/config-paths')
      const { setUsageTrackingEnabled } = await import('../../src/main/store')
      const { readUsage } = await import('../../src/main/usage')

      setUsageTrackingEnabled('gemini', true)
      const logPath = geminiUsageLogPath()
      mkdirSync(dirname(logPath), { recursive: true })

      const event = {
        attributes: {
          'event.name': 'gemini_cli.api_response',
          'event.timestamp': new Date(Date.now() - 60_000).toISOString(),
          model: 'gemini-2.5-flash',
          input_token_count: 10,
          output_token_count: 1,
          thoughts_token_count: 0,
          cached_content_token_count: 0
        }
      }
      const objectText = JSON.stringify(event, null, 2)
      // Build a file larger than the 1MB read chunk size so objects span
      // chunk boundaries.
      const repeats = Math.ceil((2 * 1024 * 1024) / objectText.length) + 1
      writeFileSync(logPath, objectText.repeat(repeats))
      const fileSize = statSync(logPath).size
      expect(fileSize).toBeGreaterThan(1024 * 1024)

      const result = await readUsage(365, 30)
      const geminiCard = result.byCli.find((item) => item.cliId === 'gemini')
      expect(geminiCard?.requestCount).toBeGreaterThanOrEqual(repeats)
      expect(geminiCard?.tokens.totalTokens).toBeGreaterThanOrEqual(repeats * 11)
    })
  })

  it('rotateGeminiUsageLogIfNeeded rotates oversized log and readUsage still finds backup data', async () => {
    await withIsolatedHome(async () => {
      const { geminiUsageLogPath } = await import('../../src/main/config-paths')
      const { setUsageTrackingEnabled } = await import('../../src/main/store')
      const { readUsage, rotateGeminiUsageLogIfNeeded } = await import('../../src/main/usage')

      setUsageTrackingEnabled('gemini', true)
      const logPath = geminiUsageLogPath()
      mkdirSync(dirname(logPath), { recursive: true })

      const event = {
        attributes: {
          'event.name': 'gemini_cli.api_response',
          'event.timestamp': new Date(Date.now() - 60_000).toISOString(),
          model: 'gemini-2.5-flash',
          input_token_count: 100,
          output_token_count: 20,
          thoughts_token_count: 5,
          cached_content_token_count: 10
        }
      }
      const objectText = JSON.stringify(event, null, 2)
      const repeats = 5
      writeFileSync(logPath, objectText.repeat(repeats))

      rotateGeminiUsageLogIfNeeded(64, 2)

      expect(existsSync(logPath)).toBe(false)
      expect(existsSync(`${logPath}.1`)).toBe(true)

      const result = await readUsage(365, 30)
      const geminiCard = result.byCli.find((item) => item.cliId === 'gemini')
      expect(geminiCard).toMatchObject({
        requestCount: repeats,
        tokens: {
          inputTokens: 100 * repeats,
          outputTokens: 25 * repeats,
          cacheReadTokens: 10 * repeats,
          cacheCreationTokens: 0,
          totalTokens: 135 * repeats
        }
      })
    })
  })

  it('rotateGeminiUsageLogIfNeeded keeps at most the configured number of backups', async () => {
    await withIsolatedHome(async () => {
      const { geminiUsageLogPath } = await import('../../src/main/config-paths')
      const { rotateGeminiUsageLogIfNeeded } = await import('../../src/main/usage')

      const logPath = geminiUsageLogPath()
      mkdirSync(dirname(logPath), { recursive: true })

      const big = 'x'.repeat(128)
      writeFileSync(logPath, big)
      rotateGeminiUsageLogIfNeeded(64, 2)
      expect(existsSync(`${logPath}.1`)).toBe(true)

      writeFileSync(logPath, big)
      rotateGeminiUsageLogIfNeeded(64, 2)
      expect(existsSync(`${logPath}.1`)).toBe(true)
      expect(existsSync(`${logPath}.2`)).toBe(true)

      writeFileSync(logPath, big)
      rotateGeminiUsageLogIfNeeded(64, 2)
      expect(existsSync(`${logPath}.1`)).toBe(true)
      expect(existsSync(`${logPath}.2`)).toBe(true)
      expect(existsSync(`${logPath}.3`)).toBe(false)
    })
  })
})
