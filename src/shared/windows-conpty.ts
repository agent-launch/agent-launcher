/**
 * Windows ConPTY compatibility, shared by main (pty spawn) and preload
 * (xterm's windowsPty hint) so both sides make the same decision.
 *
 * Windows 10's in-box ConPTY re-renders scroll-region scrolls (DECSTBM — how
 * Codex --no-alt-screen and OpenCode --mini push history out of the viewport)
 * as in-place absolute-cursor repaints, so xterm never accumulates scrollback.
 * Windows 11's conhost forwards them as real scrolls. node-pty ships the
 * Windows Terminal ConPTY (conpty.dll + OpenConsole.exe); opting into it on
 * Windows 10 gives embedded terminals the Windows 11 behavior.
 */

/** Windows 10 2004 — the oldest build the bundled OpenConsole supports. */
const BUNDLED_CONPTY_MIN_BUILD = 19041

/** Windows 11 RTM; its in-box ConPTY already forwards scrolling correctly. */
const WINDOWS_11_BUILD = 22000

/**
 * Build number reported to xterm.js while the bundled ConPTY is active. The
 * bundled conhost is newer than any in-box one; anything >= 21376 turns off
 * xterm's legacy-ConPTY wrapping workarounds.
 */
export const BUNDLED_CONPTY_BUILD_NUMBER = 22621

/** Parse the build number out of os.release() ("10.0.19045" -> 19045). */
export function windowsBuildNumber(release: string): number | undefined {
  const build = Number.parseInt(release.split('.')[2] || '', 10)
  return Number.isFinite(build) ? build : undefined
}

/** Whether this Windows build should run node-pty's bundled ConPTY. */
export function useBundledConpty(buildNumber: number | undefined): boolean {
  return (
    buildNumber !== undefined &&
    buildNumber >= BUNDLED_CONPTY_MIN_BUILD &&
    buildNumber < WINDOWS_11_BUILD
  )
}
