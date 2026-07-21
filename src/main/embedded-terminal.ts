import type { CliId } from '@shared/types'

interface EmbeddedTerminalArgsOptions {
  cliId: CliId
  version?: string
  autoApprove: boolean
  resume?: boolean
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
 * Compatibility arguments used only by Windows' embedded xterm. Version-gated
 * modes preserve scrollback, while resume-only arguments avoid startup paths
 * that cannot reliably initialize inside ConPTY. External terminals keep each
 * CLI's normal behavior.
 */
export function embeddedTerminalArgs({
  cliId,
  version,
  autoApprove,
  resume = false,
  platform = process.platform
}: EmbeddedTerminalArgsOptions): string[] {
  if (platform !== 'win32') return []

  // Codex 0.80.0 introduced --no-alt-screen specifically to preserve the
  // terminal emulator's scrollback.
  if (cliId === 'codex') {
    const args = versionAtLeast(version, [0, 80, 0]) !== false ? ['--no-alt-screen'] : []

    // Current Codex releases can block thread/resume before the first frame
    // while Windows plugin startup tasks reconcile Desktop-managed plugins.
    // Scope the workaround to affected embedded resumes so fresh sessions and
    // non-Windows terminals retain plugin support.
    if (resume && versionAtLeast(version, [0, 140, 0]) !== false) {
      args.push('--disable', 'plugins')
    }
    return args
  }

  // OpenCode 1.17.10 introduced its primary-screen split-footer UI. In current
  // releases the `--mini` shortcut does not forward `--auto`, so retain the
  // full TUI when auto-approval is enabled instead of silently changing its
  // permission behavior.
  if (cliId === 'opencode' && !autoApprove && versionAtLeast(version, [1, 17, 10]) !== false) return ['--mini']

  // Pi already renders on the primary screen, so xterm's normal scrollback is
  // available without a CLI flag.
  return []
}
