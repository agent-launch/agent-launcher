import { describe, expect, it, vi } from 'vitest'
import {
  compareVersions as gateCompare,
  evaluatePolicy,
  normalizeVersion as gateNormalize
} from '../../scripts/check-update-policy.mjs'

// app-update.ts touches electron at import time (app.getVersion() seeds its
// status snapshot); stub just enough of it to load the module.
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => {} },
  shell: { openExternal: async () => {} }
}))

const { compareVersions: clientCompare, normalizeVersion: clientNormalize } =
  await import('../../src/main/app-update')

// The gate's whole purpose is to predict what a shipped client concludes, so
// its copied comparator must agree with src/main/app-update.ts on every pair
// — including the deliberate non-semver quirk (prereleases rank ABOVE their
// release). If the client comparator ever changes, this is the test that
// forces the gate to follow.
const VERSION_PAIRS: Array<[string, string]> = [
  ['0.1.0', '0.1.0'],
  ['0.2.0', '0.1.0'],
  ['0.2.0-rc.1', '0.2.0'],
  ['0.2.0-rc.2', '0.2.0-rc.10'],
  ['v1.2.3', '1.2.3'],
  ['1.10.0', '1.9.0'],
  ['1.0.0-alpha', '1.0.0-beta'],
  ['1.0.0.1', '1.0.0'],
  ['10.0.0', '2.0.0'],
  [' 1.2.3 ', '1.2.3'],
  ['0.0.0', '99.99.99'],
  ['0.2.0-rc.1', '0.1.0']
]

describe('update-policy gate comparator parity', () => {
  it('agrees with the client comparator on every pair, both directions', () => {
    for (const [a, b] of VERSION_PAIRS) {
      expect(gateCompare(a, b), `compare(${a}, ${b})`).toBe(clientCompare(a, b))
      expect(gateCompare(b, a), `compare(${b}, ${a})`).toBe(clientCompare(b, a))
    }
  })

  it('agrees with the client on normalization', () => {
    for (const version of ['v1.2.3', 'V2.0.0', ' 0.1.0 ', '0.2.0-rc.1']) {
      expect(gateNormalize(version)).toBe(clientNormalize(version))
    }
  })

  it('keeps the deliberate non-semver ranking a client uses', () => {
    // A client on 0.2.0 with policy latestVersion 0.2.0-rc.1 WOULD see a
    // banner; the gate must rank the prerelease above the release too.
    expect(gateCompare('0.2.0-rc.1', '0.2.0')).toBe(1)
    expect(clientCompare('0.2.0-rc.1', '0.2.0')).toBe(1)
  })
})

describe('update-policy gate decisions', () => {
  it('passes when the policy matches the promoted release', () => {
    const result = evaluatePolicy({ latestVersion: '0.1.0', minVersion: '0.1.0' }, '0.1.0')
    expect(result.failures).toEqual([])
  })

  it('passes when the policy advertises nothing, promoted or not', () => {
    expect(evaluatePolicy({ force: false }, '0.1.0').failures).toEqual([])
    expect(evaluatePolicy({ force: false }, undefined).failures).toEqual([])
  })

  it('fails a latestVersion ahead of the promoted release', () => {
    const result = evaluatePolicy({ latestVersion: '0.2.0-rc.1' }, '0.1.0')
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('ahead of the last promoted release')
  })

  it('fails a minVersion ahead of the promoted release', () => {
    const result = evaluatePolicy({ latestVersion: '0.1.0', minVersion: '0.2.0' }, '0.1.0')
    expect(result.failures.some((f) => f.startsWith('minVersion 0.2.0 is ahead'))).toBe(true)
  })

  it('fails a policy whose minVersion exceeds its latestVersion', () => {
    const result = evaluatePolicy({ latestVersion: '0.1.0', minVersion: '0.9.0' }, '9.9.9')
    expect(result.failures.some((f) => f.includes('contradicts itself'))).toBe(true)
  })

  it('fails any advertised version when no release was ever promoted', () => {
    const result = evaluatePolicy({ latestVersion: '0.1.0' }, undefined)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('no promoted (non-prerelease) release')
  })
})
