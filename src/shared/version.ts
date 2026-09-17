/** First Codex release whose macOS binaries are signed; older ones are the
 * builds Gatekeeper reports as "damaged". */
export const CODEX_MACOS_MIN_SAFE_VERSION = '0.135.0'

/** Loose semver-ish comparison shared by the updater and the CLI status UI. */
export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a).split(/[.-]/)
  const right = normalizeVersion(b).split(/[.-]/)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i += 1) {
    const aa = left[i] ?? '0'
    const bb = right[i] ?? '0'
    const an = /^\d+$/.test(aa) ? Number(aa) : Number.NaN
    const bn = /^\d+$/.test(bb) ? Number(bb) : Number.NaN
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      if (an > bn) return 1
      if (an < bn) return -1
      continue
    }
    if (aa > bb) return 1
    if (aa < bb) return -1
  }

  return 0
}

/** True only when `version` is a real, parseable version at or above `min`.
 * Unknown/placeholder versions ("system", undefined) are never "at least". */
export function isVersionAtLeast(version: string | undefined, min: string): boolean {
  if (!version || !/^\d+\.\d+/.test(normalizeVersion(version))) return false
  return compareVersions(version, min) >= 0
}
