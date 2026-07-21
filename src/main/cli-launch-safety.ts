import type { CliId, CliInstallState } from '@shared/types'

export const CODEX_MACOS_MIN_SAFE_VERSION = '0.135.0'

/** Keep every main-process launch path on the same actionable message. */
export function macosSecurityManualUpdateMessage(cliId: CliId): string {
  if (cliId === 'codex') {
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
    return macosSecurityManualUpdateMessage(cliId)
  }
  return undefined
}

export function assertCliLaunchAllowed(cliId: CliId, install: CliInstallState): void {
  const message = cliLaunchBlockMessage(cliId, install)
  if (message) throw new Error(message)
}
