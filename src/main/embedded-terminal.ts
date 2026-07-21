import type { CliId } from '@shared/types'

interface EmbeddedScrollbackArgsOptions {
  cliId: CliId
  version?: string
  autoApprove: boolean
  platform?: NodeJS.Platform
}

function versionAtLeast(version: string | undefined, minimum: [number, number, number]): boolean | undefined {
  const match = version?.match(/(?:^|\D)(\d+)\.(\d+)\.(\d+)/)
  if (!match) return undefined

  const current = match.slice(1, 4).map(Number)
  for (let i = 0; i < minimum.length; i++) {
    if (current[i] !== minimum[i]) return current[i] > minimum[i]
  }
  return true
}

/**
 * Windows' embedded xterm needs CLIs to stay on the primary screen for native
 * scrollback to exist. Reject a documented inline mode only when the recorded
 * version is known to predate it: system-linked installs can legitimately have
 * no recorded version even though the active install strategy supplies a
 * current CLI. An external terminal keeps each CLI's normal UI.
 */
export function embeddedScrollbackArgs({
  cliId,
  version,
  autoApprove,
  platform = process.platform
}: EmbeddedScrollbackArgsOptions): string[] {
  if (platform !== 'win32') return []

  // Codex 0.80.0 introduced --no-alt-screen specifically to preserve the
  // terminal emulator's scrollback.
  if (cliId === 'codex' && versionAtLeast(version, [0, 80, 0]) !== false) return ['--no-alt-screen']

  // OpenCode 1.17.10 introduced its primary-screen split-footer UI. In current
  // releases the `--mini` shortcut does not forward `--auto`, so retain the
  // full TUI when auto-approval is enabled instead of silently changing its
  // permission behavior.
  if (cliId === 'opencode' && !autoApprove && versionAtLeast(version, [1, 17, 10]) !== false) return ['--mini']

  // Pi already renders on the primary screen, so xterm's normal scrollback is
  // available without a CLI flag.
  return []
}
