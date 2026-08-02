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

/**
 * A tab's own backing session file can disappear out from under it without
 * the tab closing — most notably, gemini-cli deletes its own session file
 * on process exit if it judges the conversation "not resumable"
 * (deleteCurrentSessionIfNotResumableAsync in its own ChatRecordingService),
 * which can fire even for a session that had real content, if gemini-cli's
 * in-memory tracking of that session drifted from what's on disk (observed
 * after a resume). The tab itself keeps running and showing its last
 * rendered output either way, so without checking, nothing signals that
 * this conversation is no longer saved.
 *
 * Returns the set of tab ids whose resumeId no longer has a matching entry
 * in the freshly-fetched session list for this cliId. The chosen behavior is
 * to close these tabs (see closeVanishedSessionTabs in Shell.tsx) — keeping
 * open tabs and history in sync takes priority over preserving a tab the app
 * can't actually guarantee still corresponds to anything recoverable, since
 * the app doesn't control when the CLI deletes its own files.
 */
export function findVanishedSessionTabs<T extends ReconcilableTab>(
  tabs: T[],
  cliId: CliId,
  sessions: SessionInfo[]
): Set<string> {
  const liveIds = new Set(sessions.map((s) => s.id))
  const vanished = new Set<string>()
  for (const tab of tabs) {
    if (tab.cliId !== cliId || !tab.resumeId || tab.status === 'exited') continue
    if (!liveIds.has(tab.resumeId)) vanished.add(tab.id)
  }
  return vanished
}

/**
 * Removes the given tab ids and, if the currently active tab was among
 * them, picks a fallback the same way closing a tab by hand does: the tab
 * that was just before it, else the first remaining tab, else none. Pure —
 * callers apply `tabs`/`activeTabId` to state and, if `activatedCliId` is
 * set, also switch the active CLI to match the fallback tab.
 */
export function closeTabsById<T extends ReconcilableTab>(
  tabs: T[],
  activeTabId: string | null,
  idsToClose: Set<string>
): { tabs: T[]; activeTabId: string | null; activatedCliId?: CliId } {
  if (idsToClose.size === 0) return { tabs, activeTabId }
  const next = tabs.filter((tab) => !idsToClose.has(tab.id))
  if (!activeTabId || !idsToClose.has(activeTabId)) {
    return { tabs: next, activeTabId }
  }
  const closedIndex = tabs.findIndex((tab) => tab.id === activeTabId)
  const fallback = next[Math.max(0, closedIndex - 1)] ?? next[0] ?? null
  return {
    tabs: next,
    activeTabId: fallback?.id ?? null,
    activatedCliId: fallback?.cliId
  }
}
