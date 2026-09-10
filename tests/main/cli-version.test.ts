import { describe, expect, it } from 'vitest'
import { parseCliVersion, probeCliVersion } from '../../src/main/cli-version'

describe('CLI version probing', () => {
  it('normalizes the version output formats used by embedded CLIs', () => {
    expect(parseCliVersion('codex-cli 0.144.6')).toBe('0.144.6')
    expect(parseCliVersion('v1.18.4\r\n')).toBe('1.18.4')
    expect(parseCliVersion('1.17.10')).toBe('1.17.10')
  })

  it('rejects output without a semantic version', () => {
    expect(parseCliVersion('system')).toBeUndefined()
    expect(parseCliVersion('1.18')).toBeUndefined()
  })

  it('reads the version from the executable that will actually run', async () => {
    await expect(probeCliVersion(process.execPath)).resolves.toBe(process.versions.node)
  })
})
