import { describe, expect, it } from 'vitest'
import { compareVersions, isVersionAtLeast } from '../../src/shared/version'

describe('shared version helpers', () => {
  it('compares loosely and treats placeholders as unknown', () => {
    expect(compareVersions('0.154.0', '0.135.0')).toBe(1)
    expect(compareVersions('v0.135.0', '0.135.0')).toBe(0)
    expect(isVersionAtLeast('0.154.0', '0.135.0')).toBe(true)
    expect(isVersionAtLeast('0.135.0', '0.135.0')).toBe(true)
    expect(isVersionAtLeast('0.120.9', '0.135.0')).toBe(false)
    expect(isVersionAtLeast('system', '0.135.0')).toBe(false)
    expect(isVersionAtLeast(undefined, '0.135.0')).toBe(false)
  })
})
