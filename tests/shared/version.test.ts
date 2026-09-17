import { describe, expect, it } from 'vitest'
import { compareVersions, isKnownVersionBelow, isVersionAtLeast } from '../../src/shared/version'

describe('shared version helpers', () => {
  it('compares loosely, ranking prereleases above their release like the updater does', () => {
    expect(compareVersions('0.154.0', '0.135.0')).toBe(1)
    expect(compareVersions('v0.135.0', '0.135.0')).toBe(0)
    expect(compareVersions('0.135.0-rc.1', '0.135.0')).toBe(1)
  })

  it('isVersionAtLeast only accepts parseable versions', () => {
    expect(isVersionAtLeast('0.154.0', '0.135.0')).toBe(true)
    expect(isVersionAtLeast('v0.154.0', '0.135.0')).toBe(true)
    expect(isVersionAtLeast('0.154.0-alpha.1', '0.135.0')).toBe(true)
    expect(isVersionAtLeast('0.154', '0.135.0')).toBe(true)
    expect(isVersionAtLeast('0.135.0', '0.135.0')).toBe(true)
    expect(isVersionAtLeast('0.120.9', '0.135.0')).toBe(false)
    for (const unknown of ['system', '-', '', undefined]) {
      expect(isVersionAtLeast(unknown, '0.135.0')).toBe(false)
    }
  })

  it('isKnownVersionBelow never guesses for unknown versions', () => {
    expect(isKnownVersionBelow('0.120.9', '0.135.0')).toBe(true)
    expect(isKnownVersionBelow('0.135.0', '0.135.0')).toBe(false)
    expect(isKnownVersionBelow('0.154.0', '0.135.0')).toBe(false)
    for (const unknown of ['system', '-', '', undefined]) {
      expect(isKnownVersionBelow(unknown, '0.135.0')).toBe(false)
    }
  })
})
