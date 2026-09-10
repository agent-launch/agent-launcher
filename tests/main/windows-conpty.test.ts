import { describe, expect, it } from 'vitest'
import {
  BUNDLED_CONPTY_BUILD_NUMBER,
  useBundledConpty,
  windowsBuildNumber
} from '../../src/shared/windows-conpty'

describe('windowsBuildNumber', () => {
  it('parses the build out of os.release()', () => {
    expect(windowsBuildNumber('10.0.19045')).toBe(19045)
    expect(windowsBuildNumber('10.0.22631')).toBe(22631)
  })

  it('returns undefined for unparseable releases', () => {
    expect(windowsBuildNumber('')).toBeUndefined()
    expect(windowsBuildNumber('10.0')).toBeUndefined()
    expect(windowsBuildNumber('10.0.beta')).toBeUndefined()
  })
})

describe('useBundledConpty', () => {
  it('targets Windows 10 builds whose in-box ConPTY repaints instead of scrolling', () => {
    expect(useBundledConpty(19041)).toBe(true) // Windows 10 2004
    expect(useBundledConpty(19045)).toBe(true) // Windows 10 22H2
  })

  it('keeps Windows 11 on the in-box ConPTY, which already scrolls correctly', () => {
    expect(useBundledConpty(22000)).toBe(false)
    expect(useBundledConpty(22631)).toBe(false)
    expect(useBundledConpty(26100)).toBe(false)
  })

  it('skips builds too old for the bundled OpenConsole and unknown builds', () => {
    expect(useBundledConpty(18363)).toBe(false) // Windows 10 1909
    expect(useBundledConpty(undefined)).toBe(false)
  })
})

describe('BUNDLED_CONPTY_BUILD_NUMBER', () => {
  it('is modern enough to disable xterm legacy-ConPTY workarounds (>= 21376)', () => {
    expect(BUNDLED_CONPTY_BUILD_NUMBER).toBeGreaterThanOrEqual(21376)
  })
})
