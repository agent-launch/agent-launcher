import { describe, expect, it } from 'vitest'
import {
  reconcileNewSessionTabs,
  findVanishedSessionTabs,
  closeTabsById,
  type ReconcilableTab
} from '../../src/renderer/src/components/shell/reconcileTabs'
import type { SessionInfo } from '../../src/shared/types'

function tab(overrides: Partial<ReconcilableTab> & { id: string }): ReconcilableTab {
  return {
    cliId: 'gemini',
    kind: 'terminal',
    cwd: '/repo',
    status: 'running',
    createdAt: 0,
    ...overrides
  }
}

function session(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
  return { cliId: 'gemini', name: 'session', updatedAt: 0, cwd: '/repo', ...overrides }
}

describe('reconcileNewSessionTabs', () => {
  it('backfills resumeId on a resumeId-less tab once its session appears in history', () => {
    // Reproduces the bug reported for issue #1684: "New Session" opens a
    // tab with no resumeId (the CLI hasn't assigned one yet); once the CLI
    // persists the session and it shows up in the history list, resuming
    // that same session from the list should reuse this tab — which only
    // works if the tab's resumeId gets backfilled here first.
    const tabs = [tab({ id: 'tab-1', createdAt: 1000 })]
    const sessions = [session({ id: 'sess-1', updatedAt: 1500 })]
    const patches = reconcileNewSessionTabs(tabs, 'gemini', sessions)
    expect(patches.get('tab-1')).toBe('sess-1')
  })

  it('ignores sessions that started before the tab was opened', () => {
    const tabs = [tab({ id: 'tab-1', createdAt: 2000 })]
    const sessions = [session({ id: 'sess-old', updatedAt: 1000 })]
    expect(reconcileNewSessionTabs(tabs, 'gemini', sessions).size).toBe(0)
  })

  it('ignores sessions in a different cwd', () => {
    const tabs = [tab({ id: 'tab-1', cwd: '/repo-a', createdAt: 1000 })]
    const sessions = [session({ id: 'sess-1', cwd: '/repo-b', updatedAt: 1500 })]
    expect(reconcileNewSessionTabs(tabs, 'gemini', sessions).size).toBe(0)
  })

  it('does not touch a tab that already has a resumeId', () => {
    const tabs = [tab({ id: 'tab-1', resumeId: 'already-resumed', createdAt: 1000 })]
    const sessions = [session({ id: 'sess-1', updatedAt: 1500 })]
    expect(reconcileNewSessionTabs(tabs, 'gemini', sessions).size).toBe(0)
  })

  it('does not touch an exited tab', () => {
    const tabs = [tab({ id: 'tab-1', status: 'exited', createdAt: 1000 })]
    const sessions = [session({ id: 'sess-1', updatedAt: 1500 })]
    expect(reconcileNewSessionTabs(tabs, 'gemini', sessions).size).toBe(0)
  })

  it('ignores a different cliId', () => {
    const tabs = [tab({ id: 'tab-1', cliId: 'gemini', createdAt: 1000 })]
    const sessions = [session({ id: 'sess-1', cliId: 'codex', updatedAt: 1500 })]
    expect(reconcileNewSessionTabs(tabs, 'codex', sessions).size).toBe(0)
  })

  it("does not double-claim a session already used as another tab's resumeId", () => {
    const tabs = [
      tab({ id: 'tab-already-resumed', resumeId: 'sess-1' }),
      tab({ id: 'tab-new', createdAt: 1000 })
    ]
    const sessions = [session({ id: 'sess-1', updatedAt: 1500 })]
    expect(reconcileNewSessionTabs(tabs, 'gemini', sessions).size).toBe(0)
  })

  it('matches the earliest eligible session when several could fit one tab', () => {
    const tabs = [tab({ id: 'tab-1', createdAt: 1000 })]
    const sessions = [
      session({ id: 'sess-later', updatedAt: 3000 }),
      session({ id: 'sess-earlier', updatedAt: 1500 })
    ]
    expect(reconcileNewSessionTabs(tabs, 'gemini', sessions).get('tab-1')).toBe('sess-earlier')
  })

  it('matches multiple resumeId-less tabs to distinct sessions without collision', () => {
    const tabs = [tab({ id: 'tab-1', createdAt: 1000 }), tab({ id: 'tab-2', createdAt: 2000 })]
    const sessions = [
      session({ id: 'sess-1', updatedAt: 1200 }),
      session({ id: 'sess-2', updatedAt: 2200 })
    ]
    const patches = reconcileNewSessionTabs(tabs, 'gemini', sessions)
    expect(patches.get('tab-1')).toBe('sess-1')
    expect(patches.get('tab-2')).toBe('sess-2')
  })

  it('only reconciles terminal and chat tabs, not transcript tabs', () => {
    const tabs = [tab({ id: 'tab-1', kind: 'transcript', createdAt: 1000 })]
    const sessions = [session({ id: 'sess-1', updatedAt: 1500 })]
    expect(reconcileNewSessionTabs(tabs, 'gemini', sessions).size).toBe(0)
  })
})

describe('findVanishedSessionTabs', () => {
  it('flags a resumed tab whose session no longer appears in the fresh list', () => {
    // Reproduces a real, observed case: gemini-cli deletes its own session
    // file on process exit if it judges the conversation "not resumable"
    // (deleteCurrentSessionIfNotResumableAsync), which can fire even for a
    // session with real content if gemini-cli's own in-memory tracking
    // drifted from disk after a resume. The tab keeps running regardless,
    // so nothing else would tell the user this conversation isn't saved.
    const tabs = [tab({ id: 'tab-1', resumeId: 'sess-1' })]
    expect(findVanishedSessionTabs(tabs, 'gemini', [])).toEqual(new Set(['tab-1']))
  })

  it('does not flag a tab whose session is still present', () => {
    const tabs = [tab({ id: 'tab-1', resumeId: 'sess-1' })]
    const sessions = [session({ id: 'sess-1' })]
    expect(findVanishedSessionTabs(tabs, 'gemini', sessions).size).toBe(0)
  })

  it('ignores a tab with no resumeId — nothing to have vanished', () => {
    const tabs = [tab({ id: 'tab-1' })]
    expect(findVanishedSessionTabs(tabs, 'gemini', []).size).toBe(0)
  })

  it('ignores an exited tab even if its session is gone', () => {
    const tabs = [tab({ id: 'tab-1', resumeId: 'sess-1', status: 'exited' })]
    expect(findVanishedSessionTabs(tabs, 'gemini', []).size).toBe(0)
  })

  it('ignores tabs for a different cliId', () => {
    const tabs = [tab({ id: 'tab-1', cliId: 'codex', resumeId: 'sess-1' })]
    expect(findVanishedSessionTabs(tabs, 'gemini', []).size).toBe(0)
  })

  it('flags multiple vanished tabs independently', () => {
    const tabs = [
      tab({ id: 'tab-1', resumeId: 'sess-1' }),
      tab({ id: 'tab-2', resumeId: 'sess-2' }),
      tab({ id: 'tab-3', resumeId: 'sess-3' })
    ]
    const sessions = [session({ id: 'sess-2' })]
    expect(findVanishedSessionTabs(tabs, 'gemini', sessions)).toEqual(new Set(['tab-1', 'tab-3']))
  })
})

describe('closeTabsById', () => {
  it('removes the given tabs and leaves activeTabId untouched if it was not among them', () => {
    const tabs = [tab({ id: 'tab-1' }), tab({ id: 'tab-2' })]
    const result = closeTabsById(tabs, 'tab-2', new Set(['tab-1']))
    expect(result.tabs.map((t) => t.id)).toEqual(['tab-2'])
    expect(result.activeTabId).toBe('tab-2')
    expect(result.activatedCliId).toBeUndefined()
  })

  it('returns the same tabs array reference when nothing is closed', () => {
    const tabs = [tab({ id: 'tab-1' })]
    const result = closeTabsById(tabs, 'tab-1', new Set())
    expect(result.tabs).toBe(tabs)
  })

  it('falls back to the previous tab when the active tab is closed', () => {
    // Mirrors closeTab's own fallback rule (see Shell.tsx) so closing a
    // vanished-session tab behaves the same as the user closing it by hand.
    const tabs = [tab({ id: 'tab-1' }), tab({ id: 'tab-2' }), tab({ id: 'tab-3' })]
    const result = closeTabsById(tabs, 'tab-2', new Set(['tab-2']))
    expect(result.tabs.map((t) => t.id)).toEqual(['tab-1', 'tab-3'])
    expect(result.activeTabId).toBe('tab-1')
  })

  it('falls back to the first remaining tab when the closed active tab was first', () => {
    const tabs = [tab({ id: 'tab-1' }), tab({ id: 'tab-2' })]
    const result = closeTabsById(tabs, 'tab-1', new Set(['tab-1']))
    expect(result.activeTabId).toBe('tab-2')
  })

  it('falls back to no active tab when every tab is closed', () => {
    const tabs = [tab({ id: 'tab-1' })]
    const result = closeTabsById(tabs, 'tab-1', new Set(['tab-1']))
    expect(result.tabs).toEqual([])
    expect(result.activeTabId).toBeNull()
    expect(result.activatedCliId).toBeUndefined()
  })

  it("reports the fallback tab's cliId so the caller can switch the active CLI", () => {
    const tabs = [tab({ id: 'tab-1', cliId: 'codex' }), tab({ id: 'tab-2', cliId: 'gemini' })]
    const result = closeTabsById(tabs, 'tab-2', new Set(['tab-2']))
    expect(result.activatedCliId).toBe('codex')
  })
})
