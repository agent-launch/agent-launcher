import type { CliId, SessionInfo } from '@shared/types'

/** Minimal shape reconcileNewSessionTabs needs — kept separate from the
 * full WorkspaceTab type in Shell.tsx so this stays independently testable. */
export interface ReconcilableTab {
  id: string
  cliId: CliId
  kind: 'terminal' | 'chat' | 'transcript'
  cwd?: string
  resumeId?: string
  status: 'running' | 'idle' | 'exited'
  createdAt: number
}

/**
 * A tab opened via "New Session" starts with no resumeId — the CLI hasn't
 * assigned/persisted a session id yet, so there's nothing to record. Once
 * the session list refreshes and a new entry shows up for this cliId, this
 * matches it back onto the still-running tab that's most likely to be it
 * (same cwd, started at/after the tab was opened, not already claimed by
 * another tab) so that resuming it later from history reuses that tab
 * instead of opening a duplicate — the bug reported for issue #1684:
 * "若当前session已打开，从列表中恢复该session应定位在打开的tab中，目前是新开了一个tab".
 *
 * Matching by cwd+recency is a heuristic — there's no direct signal tying a
 * terminal-mode PTY session to the session id the CLI ends up persisting
 * for it.
 *
 * Returns a Map of tabId -> resumeId for tabs that should be updated; empty
 * if nothing matched. Pure function, no state — callers apply the patch.
 */
export function reconcileNewSessionTabs<T extends ReconcilableTab>(
  tabs: T[],
  cliId: CliId,
  sessions: SessionInfo[]
): Map<string, string> {
  const patches = new Map<string, string>()
  const claimed = new Set(tabs.map((tab) => tab.resumeId).filter((id): id is string => !!id))
  const candidates = tabs.filter(
    (tab) =>
      tab.cliId === cliId &&
      !tab.resumeId &&
      tab.status !== 'exited' &&
      (tab.kind === 'terminal' || tab.kind === 'chat')
  )
  for (const tab of candidates) {
    const match = sessions
      .filter((s) => !claimed.has(s.id) && s.cwd === tab.cwd && s.updatedAt >= tab.createdAt)
      .sort((a, b) => a.updatedAt - b.updatedAt)[0]
    if (!match) continue
    claimed.add(match.id)
    patches.set(tab.id, match.id)
  }
  return patches
}
