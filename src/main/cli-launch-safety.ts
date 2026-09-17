import type { CliId, CliInstallState } from '@shared/types'
import { CODEX_MACOS_MIN_SAFE_VERSION, isVersionAtLeast } from '@shared/version'

export { CODEX_MACOS_MIN_SAFE_VERSION }

/** Keep every main-process launch path on the same actionable message. The
 * "outdated" wording is only true for Codex builds older than the first
 * signed release; a newer build that is still blocked needs a different fix. */
export function macosSecurityManualUpdateMessage(cliId: CliId, version?: string): string {
  if (cliId === 'codex') {
    if (isVersionAtLeast(version, CODEX_MACOS_MIN_SAFE_VERSION)) {
      return `macOS has blocked this Codex CLI install (${version}) because the binary is quarantined without a valid signature or was flagged by Gatekeeper. Please uninstall it and reinstall from the official installation docs.`
    }
    return `Your Codex CLI is outdated, so macOS flags it as damaged and won't open it. Please uninstall it and install version ${CODEX_MACOS_MIN_SAFE_VERSION} or later.`
  }
  return `macOS has blocked ${cliId}. Please uninstall it manually and install a current version.`
}

/** A blocked Codex must never be spawned merely to find out whether it works:
 * XProtect's false-positive dialog is itself triggered by that first spawn. */
export function cliLaunchBlockMessage(
  cliId: CliId,
  install: CliInstallState,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (platform === 'darwin' && install.launchBlockedReason === 'macos-security') {
    return macosSecurityManualUpdateMessage(cliId, install.version)
  }
  return undefined
}

export function assertCliLaunchAllowed(cliId: CliId, install: CliInstallState): void {
  const message = cliLaunchBlockMessage(cliId, install)
  if (message) throw new Error(message)
}
