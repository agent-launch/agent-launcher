import { describe, expect, it } from 'vitest'
import {
  reconcileNewSessionTabs,
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
