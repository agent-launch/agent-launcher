import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent
} from 'react'
import {
  Gauge,
  FolderOpen,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react'
import { useAppStore, type ShellView } from '@/store/app'
import { CLIS } from '@/data/clis'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { TerminalView } from '@/components/terminal/TerminalView'
import { ConfigView } from '@/components/config/ConfigView'
import { CliIcon } from '@/components/CliIcon'
import { Sidebar } from '@/components/shell/Sidebar'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsSidebar } from '@/components/settings/SettingsSidebar'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { ChatView } from '@/components/chat/ChatView'
import { useT } from '@/i18n'
import { ENABLE_CHAT_HISTORY_RENDERING } from '@/features'
import type { SettingsTab } from '@/components/settings/settingsTabs'
import type { AppConfig, CliId, SessionInfo } from '@shared/types'

/** In-UI chat is implemented for every supported CLI. */
const CHAT_CLIS = new Set<CliId>(['claude-code', 'codex', 'opencode', 'pi'])
const MAC_SIDEBAR_TOGGLE_LEFT = 82
const MAC_COLLAPSED_TAB_INSET = MAC_SIDEBAR_TOGGLE_LEFT + 24
const SHELL_FRAME_PADDING = 0
const SESSION_LOADING_DELAY_MS = 180

type WorkspaceTabKind = 'terminal' | 'chat' | 'transcript'

interface WorkspaceTab {
  id: string
  cliId: CliId
  kind: WorkspaceTabKind
  title: string
  cwd?: string
  resumeId?: string
  session?: SessionInfo
  mode?: 'cli' | 'shell'
  status: 'running' | 'idle' | 'exited'
}

interface SessionState {
  cliId: CliId | null
  items: SessionInfo[]
  loaded: boolean
}

export function Shell() {
  const t = useT()
  const activeCli = useAppStore((s) => s.activeCli)
  const setActiveCli = useAppStore((s) => s.setActiveCli)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const setShellView = useAppStore((s) => s.setShellView)
  const transcriptRenderingPreferred = useAppStore((s) => s.renderTranscript)
  const recentProjectDir = useAppStore((s) => s.recentProjectDir)
  const setRecentProjectDir = useAppStore((s) => s.setRecentProjectDir)
  const renderTranscript = ENABLE_CHAT_HISTORY_RENDERING && transcriptRenderingPreferred
  const active = CLIS.find((c) => c.id === activeCli) ?? CLIS[0]
  const activeCliId = active.id as CliId
  const isMac = window.api?.platform === 'darwin'

  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [view, setLocalView] = useState<ShellView>('run')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [settingsCheckUpdatesKey, setSettingsCheckUpdatesKey] = useState(0)
  const [tabs, setTabs] = useState<WorkspaceTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [sessionState, setSessionState] = useState<SessionState>({
    cliId: null,
    items: [],
    loaded: false
  })
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [showSessionLoading, setShowSessionLoading] = useState(false)
  const [openingTerminal, setOpeningTerminal] = useState(false)
  const [openingDashboard, setOpeningDashboard] = useState(false)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null)
  const [projectDragActive, setProjectDragActive] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const sidebarToggleGuardRef = useRef(0)
  const sessionLoadIdRef = useRef(0)
  const activeSessionRequestRef = useRef<string | null>(null)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null

  const setView = useCallback(
    (next: ShellView) => {
      setLocalView(next)
      setShellView(next)
    },
    [setShellView]
  )

  useEffect(() => {
    setShellView('run')
    return () => setShellView('run')
  }, [setShellView])

  // Reload config whenever we land on the run view (profiles may have changed).
  useEffect(() => {
    window.api.config.get().then(setCfg)
  }, [view, activeCli])

  // Read the CLI's own saved sessions (Claude/Codex conversation history).
  const refreshSessions = useCallback(async () => {
    const cliId = activeCliId
    if (activeSessionRequestRef.current) {
      void window.api.sessions.cancel(activeSessionRequestRef.current)
      activeSessionRequestRef.current = null
    }
    const loadId = sessionLoadIdRef.current + 1
    sessionLoadIdRef.current = loadId
    const requestId = `sessions-${cliId}-${loadId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    activeSessionRequestRef.current = requestId
    setSessionState((current) =>
      current.cliId === cliId ? current : { cliId, items: [], loaded: false }
    )
    setLoadingSessions(true)
    setShowSessionLoading(false)
    const loadingTimer = window.setTimeout(() => {
      if (sessionLoadIdRef.current === loadId) setShowSessionLoading(true)
    }, SESSION_LOADING_DELAY_MS)
    try {
      const nextSessions = await window.api.sessions.list(requestId, cliId)
      if (sessionLoadIdRef.current === loadId && nextSessions)
        setSessionState({ cliId, items: nextSessions, loaded: true })
    } catch {
      if (sessionLoadIdRef.current === loadId) {
        setSessionState({ cliId, items: [], loaded: true })
      }
    } finally {
      window.clearTimeout(loadingTimer)
      if (activeSessionRequestRef.current === requestId) {
        activeSessionRequestRef.current = null
      }
      if (sessionLoadIdRef.current === loadId) {
        setLoadingSessions(false)
        setShowSessionLoading(false)
      }
    }
  }, [activeCliId])

  useEffect(() => {
    if (view === 'run' && !activeTab) refreshSessions()
  }, [view, activeTab, refreshSessions])

  useEffect(() => {
    if (view === 'run' && !activeTab) return
    const requestId = activeSessionRequestRef.current
    if (!requestId) return
    activeSessionRequestRef.current = null
    sessionLoadIdRef.current += 1
    setLoadingSessions(false)
    setShowSessionLoading(false)
    void window.api.sessions.cancel(requestId)
  }, [view, activeTab])

  useEffect(() => {
    return () => {
      const requestId = activeSessionRequestRef.current
      if (requestId) void window.api.sessions.cancel(requestId)
      activeSessionRequestRef.current = null
    }
  }, [])

  const chatSupported = ENABLE_CHAT_HISTORY_RENDERING && CHAT_CLIS.has(activeCliId)

  const installed = cfg?.install[activeCliId]?.installed ?? false
  const showWorkspaceTabs = view === 'run' && (tabs.length > 0 || !!activeTab)
  const visibleSessions = sessionState.cliId === activeCliId ? sessionState.items : []
  const sessionsLoaded = sessionState.cliId === activeCliId && sessionState.loaded
  const showSessionSkeleton = showSessionLoading && !sessionsLoaded

  const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  const cliName = (cliId: CliId) => CLIS.find((c) => c.id === cliId)?.name ?? cliId
  const activateTab = useCallback(
    (tab: WorkspaceTab) => {
      setActiveTabId(tab.id)
      setActiveCli(tab.cliId)
      setView('run')
    },
    [setActiveCli, setView]
  )

  const openTab = (
    tab: Omit<WorkspaceTab, 'id' | 'status'> & {
      status?: WorkspaceTab['status']
    }
  ) => {
    const next: WorkspaceTab = {
      ...tab,
      id: newKey(),
      status: tab.status ?? (tab.kind === 'transcript' ? 'idle' : 'running')
    }
    setTabs((current) => [...current, next])
    activateTab(next)
  }

  const closeTab = useCallback(
    (id: string) => {
      const index = tabs.findIndex((tab) => tab.id === id)
      if (index < 0) return
      const next = tabs.filter((tab) => tab.id !== id)
      setTabs(next)
      if (activeTabId === id) {
        const fallback = next[Math.max(0, index - 1)] ?? next[0] ?? null
        setActiveTabId(fallback?.id ?? null)
        if (fallback) setActiveCli(fallback.cliId)
      }
    },
    [activeTabId, setActiveCli, tabs]
  )

  const markTabExited = useCallback((id: string) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, status: 'exited' } : tab)))
  }, [])

  const handleTerminalExit = useCallback(
    (id: string, code: number): boolean => {
      if (code !== 0) {
        markTabExited(id)
        return true
      }

      setTabs((current) => current.filter((tab) => tab.id !== id))
      if (activeTabId === id) setActiveTabId(null)
      setView('run')
      return false
    },
    [activeTabId, markTabExited, setView]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return
      const usesPrimaryModifier = isMac ? event.metaKey : event.ctrlKey
      if (!usesPrimaryModifier || event.altKey || event.shiftKey) return

      if (activeTabId && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        closeTab(activeTabId)
        return
      }

      if (!/^[1-9]$/.test(event.key)) return
      const tab = tabs[Number(event.key) - 1]
      if (!tab) return
      event.preventDefault()
      activateTab(tab)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activateTab, activeTabId, closeTab, isMac, tabs])

  const start = (mode: 'cli' | 'shell', cwd: string) =>
    openTab({
      cliId: activeCliId,
      kind: 'terminal',
      mode,
      cwd,
      title:
        mode === 'shell'
          ? t('shell.shellTabTitle')
          : t('shell.newSessionTitle', { name: active.name })
    })

  const startChat = (cwd: string) =>
    openTab({
      cliId: activeCliId,
      kind: 'chat',
      cwd,
      title: t('shell.newSessionTitle', { name: active.name })
    })

  const selectProjectDirectory = async (): Promise<string | null> => {
    const selected = await window.api.workspace.selectDirectory(recentProjectDir ?? undefined)
    if (selected) setRecentProjectDir(selected)
    return selected
  }

  const projectDirectoryForLaunch = async (): Promise<string | null> => {
    if (recentProjectDir) {
      const valid = await window.api.workspace.validateDirectory(recentProjectDir)
      if (valid) return valid
      setRecentProjectDir(null)
    }
    return selectProjectDirectory()
  }

  const startNewSession = async (directory?: string) => {
    const cwd = directory ?? (await projectDirectoryForLaunch())
    if (!cwd) return
    if (renderTranscript && chatSupported) startChat(cwd)
    else start('cli', cwd)
  }

  const acceptDroppedProject = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    setProjectDragActive(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    let candidate: string
    try {
      candidate = window.api.workspace.pathForFile(file)
    } catch {
      return
    }
    const directory = await window.api.workspace.validateDirectory(candidate)
    if (!directory) return
    setRecentProjectDir(directory)
    if (installed) void startNewSession(directory)
  }

  const backToHistory = () => {
    setActiveTabId(null)
    setView('run')
  }

  const openSettings = () => {
    setSettingsTab('general')
    setView('settings')
  }

  const toggleSidebarFromChrome = (event: SyntheticEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const now = Date.now()
    if (now - sidebarToggleGuardRef.current < 180) return
    sidebarToggleGuardRef.current = now
    toggleSidebar()
  }

  const stopChromePointer = (event: SyntheticEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }

  useEffect(() => {
    return window.api.app.onCheckUpdates?.(() => {
      setSettingsTab('about')
      setSettingsCheckUpdatesKey((key) => key + 1)
      setView('settings')
    })
  }, [setView])

  useEffect(() => {
    return window.api.app.onOpenAbout?.(() => {
      setSettingsTab('about')
      setView('settings')
    })
  }, [setView])

  const openExternalTerminal = async () => {
    setOpeningTerminal(true)
    try {
      await window.api.terminal.openExternal({
        cliId: activeCliId,
        mode: 'cli',
        cwd: recentProjectDir ?? undefined
      })
    } finally {
      setOpeningTerminal(false)
    }
  }

  const openDashboard = async () => {
    setOpeningDashboard(true)
    setDashboardError(null)
    setDashboardUrl(null)
    try {
      const result = await window.api.dashboard.launch(activeCliId)
      if (result.ok) {
        setDashboardUrl(result.url)
      } else {
        setDashboardError(result.error)
      }
    } finally {
      setOpeningDashboard(false)
    }
  }

  // Open a terminal resuming a session (or fresh when no id) in its own tab.
  const openTerminal = (cliId: CliId, resumeId?: string, dir?: string, title?: string) => {
    openTab({
      cliId,
      kind: 'terminal',
      mode: 'cli',
      cwd: dir,
      resumeId,
      title: title ?? t('shell.newSessionTitle', { name: cliName(cliId) })
    })
  }

  // Click a saved session. One clear path per mode:
  //  - UI mode + chat-capable CLI → open it in the chat view (history + continue).
  //  - UI mode + non-chat CLI → read-only transcript (defensive; all current CLIs chat).
  //  - terminal mode → resume straight in the terminal.
  const resume = (s: SessionInfo) => {
    const existing = tabs.find(
      (tab) => tab.cliId === s.cliId && tab.resumeId === s.id && tab.status !== 'exited'
    )
    if (existing) {
      activateTab(existing)
      return
    }

    if (renderTranscript && CHAT_CLIS.has(s.cliId)) {
      openTab({
        cliId: s.cliId,
        kind: 'chat',
        cwd: s.cwd,
        resumeId: s.id,
        session: s,
        title: s.name
      })
    } else if (renderTranscript) {
      openTab({
        cliId: s.cliId,
        kind: 'transcript',
        resumeId: s.id,
        session: s,
        title: s.name,
        status: 'idle'
      })
    } else {
      openTerminal(s.cliId, s.id, s.cwd, s.name)
    }
  }

  const confirmDeleteSession = async () => {
    if (!deleteTarget || deletingSessionId) return
    setDeletingSessionId(deleteTarget.id)
    setDeleteError(null)
    try {
      const result = await window.api.sessions.delete(deleteTarget.cliId, deleteTarget.id)
      if (!result.ok) {
        setDeleteError(
          t('shell.deleteSessionFailed', {
            error: result.error ?? 'Unknown error'
          })
        )
        return
      }
      setSessionState((current) => ({
        ...current,
        items: current.items.filter(
          (entry) => entry.cliId !== deleteTarget.cliId || entry.id !== deleteTarget.id
        )
      }))
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(
        t('shell.deleteSessionFailed', {
          error: error instanceof Error ? error.message : String(error)
        })
      )
    } finally {
      setDeletingSessionId(null)
    }
  }

  const fmtTime = (ms: number) => {
    const d = new Date(ms)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-base">
      {isMac && view !== 'settings' && (
        <button
          type="button"
          onPointerDown={toggleSidebarFromChrome}
          onMouseDown={stopChromePointer}
          onClick={stopChromePointer}
          className="no-drag absolute z-[120] grid size-6 place-items-center rounded-[5px] text-text-weak transition-colors hover:bg-[var(--selection-base)] hover:text-text-strong"
          style={{
            top: SHELL_FRAME_PADDING + 3,
            left: SHELL_FRAME_PADDING + MAC_SIDEBAR_TOGGLE_LEFT
          }}
          title={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          aria-label={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>
      )}
      <Modal
        open={!!deleteTarget}
        onClose={() => {
          if (deletingSessionId) return
          setDeleteTarget(null)
          setDeleteError(null)
        }}
        title={t('shell.deleteSessionTitle')}
      >
        <div className="space-y-4">
          <div>
            <p className="text-[14px] text-text-strong">
              {t('shell.deleteSessionMessage', {
                name: deleteTarget?.name ?? ''
              })}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-text-weak">
              {t('shell.deleteSessionHint')}
            </p>
          </div>
          {deleteError && (
            <div
              className="rounded-lg border border-dashed px-3 py-2 text-[12px]"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              {deleteError}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteTarget(null)
                setDeleteError(null)
              }}
              disabled={!!deletingSessionId}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={confirmDeleteSession}
              disabled={!!deletingSessionId}
              style={{ background: 'var(--danger)', color: '#fff' }}
            >
              {deletingSessionId
                ? t('shell.deleteSessionDeleting')
                : t('shell.deleteSessionConfirm')}
            </Button>
          </div>
        </div>
      </Modal>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {view === 'settings' ? (
          <SettingsSidebar
            activeTab={settingsTab}
            onSelectTab={setSettingsTab}
            onBack={() => setView('run')}
          />
        ) : (
          <Sidebar
            cfg={cfg}
            view={view}
            onSelectCli={() => {
              setActiveTabId(null)
              setView('run')
            }}
            onOpenSettings={openSettings}
          />
        )}

        {/* Main pane */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border-weak bg-stronger">
          <div className="relative min-h-0 flex-1 overflow-hidden bg-stronger">
            {view === 'settings' && (
              <div className="absolute inset-0 z-20 overflow-hidden">
                <SettingsPage tab={settingsTab} checkUpdatesKey={settingsCheckUpdatesKey} />
              </div>
            )}
            {view === 'config' && (
              <div className="absolute inset-0 z-20 overflow-y-auto">
                {isMac && (
                  <div className="drag-region absolute inset-x-0 top-0 h-4" aria-hidden="true" />
                )}
                <ConfigView
                  cliId={activeCliId}
                  onBack={() => {
                    setActiveTabId(null)
                    setView('run')
                  }}
                />
              </div>
            )}
            <div
              className={`absolute inset-0 flex min-h-0 flex-col transition-opacity duration-120 ${
                view === 'run' ? 'z-10 opacity-100' : 'z-0 pointer-events-none opacity-0'
              }`}
            >
              {showWorkspaceTabs && (
                <WorkspaceTabs
                  tabs={tabs}
                  activeTabId={activeTabId}
                  cliName={cliName}
                  onActivate={activateTab}
                  onClose={closeTab}
                  onNew={() => {
                    void startNewSession()
                  }}
                  newDisabled={!installed}
                  newTitle={installed ? t('shell.newTab') : t('shell.installFirst')}
                  closeTitle={t('shell.closeTab')}
                  runningLabel={t('shell.tabRunning')}
                  exitedLabel={t('shell.tabExited')}
                  backToHistoryLabel={t('shell.backToHistory')}
                  onBackToHistory={backToHistory}
                  leadingInset={isMac && sidebarCollapsed ? MAC_COLLAPSED_TAB_INSET : 0}
                />
              )}
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {tabs.map((tab) => {
                  const selected = tab.id === activeTabId
                  return (
                    <div
                      key={tab.id}
                      className={`absolute inset-0 ${
                        selected
                          ? 'visible pointer-events-auto z-10'
                          : 'invisible pointer-events-none z-0'
                      }`}
                      aria-hidden={!selected}
                    >
                      {tab.kind === 'terminal' ? (
                        <TerminalView
                          cliId={tab.cliId}
                          mode={tab.mode ?? 'cli'}
                          cwd={tab.cwd}
                          resumeId={tab.resumeId}
                          sessionKey={tab.id}
                          onExit={(code) => handleTerminalExit(tab.id, code)}
                        />
                      ) : tab.kind === 'chat' ? (
                        <ChatView
                          cliId={tab.cliId}
                          cwd={tab.cwd}
                          resumeId={tab.resumeId}
                          onBack={() => closeTab(tab.id)}
                        />
                      ) : tab.session ? (
                        <TranscriptView
                          cliId={tab.cliId}
                          sessionId={tab.session.id}
                          name={tab.session.name}
                          onResume={() =>
                            openTerminal(
                              tab.cliId,
                              tab.session?.id,
                              tab.session?.cwd,
                              tab.session?.name
                            )
                          }
                          onBack={() => closeTab(tab.id)}
                        />
                      ) : null}
                    </div>
                  )
                })}
                {!activeTab && (
                  <div
                    className={`relative mx-auto flex h-full min-h-0 w-full max-w-[980px] flex-col gap-3 px-5 py-4 transition-colors ${
                      projectDragActive ? 'bg-selection/35' : ''
                    }`}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      if (event.dataTransfer.types.includes('Files')) setProjectDragActive(true)
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'copy'
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node))
                        setProjectDragActive(false)
                    }}
                    onDrop={acceptDroppedProject}
                  >
                    {/* app-region: drag stays active even under opacity-0/pointer-events-none,
                      so only register drag regions while this view is actually shown. */}
                    {isMac && view === 'run' && (
                      <div
                        className="drag-region absolute inset-x-0 top-0 h-4"
                        aria-hidden="true"
                      />
                    )}
                    <div
                      className={`shrink-0 flex flex-wrap items-center justify-between gap-2.5 ${isMac && view === 'run' ? 'drag-region' : ''}`}
                    >
                      <div className="flex items-baseline gap-3">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-weak">
                          {t('shell.history')}
                        </span>
                        <button
                          onClick={refreshSessions}
                          disabled={loadingSessions}
                          className="no-drag text-[11px] text-text-weak transition-colors hover:text-text-strong disabled:cursor-default disabled:text-text-muted"
                        >
                          {loadingSessions ? t('shell.loadingSessions') : t('shell.refresh')}
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {activeCliId === 'hermes' && (
                          <Button
                            variant="secondary"
                            onClick={openDashboard}
                            disabled={openingDashboard || !installed}
                            title={dashboardError ?? undefined}
                          >
                            <Gauge size={13} />
                            {openingDashboard
                              ? t('shell.openingDashboard')
                              : t('shell.openDashboard')}
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          onClick={() => setView('config')}
                          title={t('shell.openAgentSettings', {
                            name: active.name
                          })}
                        >
                          <SlidersHorizontal size={13} />
                          {t('shell.agentSettings')}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={openExternalTerminal}
                          disabled={openingTerminal || !installed}
                        >
                          {t('shell.openTerminal')}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void selectProjectDirectory()}
                          title={recentProjectDir ?? t('shell.selectProject')}
                        >
                          <FolderOpen size={13} />
                          <span className="max-w-36 truncate">
                            {recentProjectDir ?? t('shell.selectProject')}
                          </span>
                        </Button>
                        <Button onClick={() => void startNewSession()} disabled={!installed}>
                          {installed ? t('shell.newSession') : t('shell.installFirst')}
                        </Button>
                      </div>
                    </div>

                    <ScrollFade
                      className="h-full min-h-0 overflow-y-auto pr-1"
                      ariaBusy={loadingSessions}
                      watchKey={`${activeCliId}:${visibleSessions.length}:${showSessionSkeleton ? 'loading' : 'loaded'}`}
                    >
                      {dashboardError && activeCliId === 'hermes' && (
                        <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                          {dashboardError}
                        </div>
                      )}
                      {dashboardUrl && activeCliId === 'hermes' && (
                        <div className="mb-3 rounded-md border border-border-weak bg-surface/85 px-3 py-2 text-[12px] text-text-base">
                          {t('shell.dashboardReady')}{' '}
                          <a
                            className="text-accent hover:underline"
                            href={dashboardUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {dashboardUrl}
                          </a>
                        </div>
                      )}
                      {showSessionSkeleton ? (
                        <SessionListSkeleton label={t('shell.loadingSessions')} />
                      ) : !sessionsLoaded ? null : visibleSessions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border-weak bg-surface/72 px-4 py-12 text-center text-[13px] text-text-weak shadow-[var(--shadow-card)]">
                          {t('shell.noHistory', { name: active.name })}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {visibleSessions.map((s) => (
                            <div
                              key={s.id}
                              className="group relative rounded-lg border border-border-weak bg-surface/92 text-left shadow-[var(--shadow-sm)] transition-[background,border-color,box-shadow] hover:border-border-base hover:bg-surface hover:shadow-[var(--shadow-card)]"
                            >
                              <button
                                onClick={() => resume(s)}
                                className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left"
                                title={t('shell.resumeTitle')}
                              >
                                <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border-weak bg-surface-weak text-text-strong group-hover:bg-selection">
                                  <CliIcon cliId={activeCliId} size={13} />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[12px] text-text-strong">
                                    {s.name}
                                  </div>
                                  <div className="truncate text-[10px] text-text-weak">
                                    {fmtTime(s.updatedAt)}
                                  </div>
                                </div>
                              </button>
                              <div className="pointer-events-none absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5 rounded-md bg-surface/95 p-0.5 opacity-0 ring-1 ring-border-weak transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    resume(s)
                                  }}
                                  className="grid size-6 place-items-center rounded-[5px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong focus:bg-surface-hover focus:text-text-strong"
                                  title={t('shell.resumeTitle')}
                                  aria-label={t('shell.resumeTitle')}
                                >
                                  <Play size={11} />
                                </button>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setDeleteError(null)
                                    setDeleteTarget(s)
                                  }}
                                  className="grid size-6 place-items-center rounded-[5px] text-text-muted transition-colors hover:bg-surface-hover hover:text-danger focus:bg-surface-hover focus:text-danger"
                                  title={t('shell.deleteSession')}
                                  aria-label={t('shell.deleteSession')}
                                  disabled={deletingSessionId === s.id}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollFade>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
      {view === 'run' && (
        <div className="no-drag flex h-7 shrink-0 items-center gap-2 border-t border-border-weak bg-base px-2.5 text-[11px]">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="grid size-4 shrink-0 place-items-center rounded-[4px]"
              style={{ color: active.accent }}
            >
              <CliIcon cliId={activeCliId} size={12} />
            </span>
            <span className="truncate font-medium text-text-strong">{active.name}</span>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <Chip label={active.name} color={active.accent} compact />
            <Chip label={installed ? t('sidebar.installed') : t('sidebar.notInstalled')} compact />
          </div>
        </div>
      )}
    </div>
  )
}

function Chip({
  label,
  color,
  compact = false
}: {
  label: string
  color?: string
  compact?: boolean
}) {
  return (
    <span
      className={`flex items-center gap-1 rounded-[4px] border border-border-weak bg-surface/70 leading-none text-text-base ${
        compact ? 'h-5 px-1.5 text-[11px]' : 'h-7 px-2.5 text-[12px]'
      }`}
    >
      {color && (
        <span
          className={`${compact ? 'size-1.5' : 'size-2'} rounded-full`}
          style={{ background: color }}
        />
      )}
      {label}
    </span>
  )
}

function ScrollFade({
  children,
  className,
  ariaBusy,
  watchKey
}: {
  children: React.ReactNode
  className?: string
  ariaBusy?: boolean
  watchKey?: string
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [showBottomFade, setShowBottomFade] = useState(false)

  const updateFade = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const remaining = el.scrollHeight - el.clientHeight - el.scrollTop
    setShowBottomFade(remaining > 2)
  }, [])

  useLayoutEffect(() => {
    updateFade()
  }, [updateFade, watchKey])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const resizeObserver = new ResizeObserver(updateFade)
    resizeObserver.observe(el)
    resizeObserver.observe(el.parentElement ?? el)
    updateFade()
    return () => resizeObserver.disconnect()
  }, [updateFade])

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={scrollerRef} className={className} aria-busy={ariaBusy} onScroll={updateFade}>
        {children}
      </div>
      <div
        className={`scroll-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 h-10 transition-opacity duration-150 ${
          showBottomFade ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  )
}

function WorkspaceTabs({
  tabs,
  activeTabId,
  cliName,
  onActivate,
  onClose,
  onNew,
  newDisabled,
  newTitle,
  closeTitle,
  runningLabel,
  exitedLabel,
  backToHistoryLabel,
  onBackToHistory,
  leadingInset
}: {
  tabs: WorkspaceTab[]
  activeTabId: string | null
  cliName: (cliId: CliId) => string
  onActivate: (tab: WorkspaceTab) => void
  onClose: (id: string) => void
  onNew: () => void
  newDisabled: boolean
  newTitle: string
  closeTitle: string
  runningLabel: string
  exitedLabel: string
  backToHistoryLabel: string
  onBackToHistory: () => void
  leadingInset: number
}) {
  const tabRefs = useRef(new Map<string, HTMLDivElement>())

  useLayoutEffect(() => {
    if (!activeTabId) return
    const tabEl = tabRefs.current.get(activeTabId)
    tabEl?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    })
  }, [activeTabId])

  return (
    <div
      className="drag-region relative flex h-8 shrink-0 items-end gap-0.5 border-b border-border-weak bg-base pr-1 transition-[padding-left] duration-180 ease-out"
      style={{ paddingLeft: leadingInset }}
    >
      {leadingInset > 0 && (
        <span
          aria-hidden="true"
          className="no-drag absolute inset-y-0 left-0 z-10"
          style={{ width: leadingInset }}
        />
      )}
      <div className="scrollbar-hidden flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId
          const isRunning = tab.status === 'running'
          const statusTitle =
            tab.status === 'exited' ? exitedLabel : isRunning ? runningLabel : cliName(tab.cliId)
          return (
            <div
              key={tab.id}
              ref={(node) => {
                if (node) {
                  tabRefs.current.set(tab.id, node)
                } else {
                  tabRefs.current.delete(tab.id)
                }
              }}
              className={`no-drag group flex h-8 min-w-[128px] max-w-[210px] shrink-0 items-center gap-1.5 rounded-t-[5px] border border-b-0 px-1.5 text-[11px] transition-[background,border-color,color,filter] ${
                selected
                  ? 'border-border-weak bg-stronger text-text-strong'
                  : 'border-border-weak/70 bg-surface-weak/55 text-text-weak hover:border-border-base hover:bg-surface/78 hover:text-text-strong'
              }`}
            >
              <button
                type="button"
                onClick={() => onActivate(tab)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                title={`${tab.title} · ${cliName(tab.cliId)}`}
              >
                <span className="grid size-4 shrink-0 place-items-center rounded-[4px] border border-border-weak bg-surface-weak">
                  <CliIcon cliId={tab.cliId} size={12} />
                </span>
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                <span className="grid size-3.5 shrink-0 place-items-center" title={statusTitle}>
                  <span
                    className={`size-1.5 rounded-full ${
                      tab.status === 'exited'
                        ? 'bg-text-muted'
                        : isRunning
                          ? 'bg-success'
                          : 'bg-border-base'
                    }`}
                  />
                </span>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.id)
                }}
                className="grid size-4.5 shrink-0 place-items-center rounded-[4px] text-text-muted opacity-65 transition-[background,color,opacity] hover:bg-surface-hover hover:text-text-strong group-hover:opacity-100"
                title={closeTitle}
                aria-label={closeTitle}
              >
                <X size={10} />
              </button>
            </div>
          )
        })}
      </div>
      {activeTabId && (
        <button
          type="button"
          onClick={onBackToHistory}
          className="no-drag mb-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium text-text-base transition-[background,color] hover:bg-surface-hover hover:text-text-strong"
          title={backToHistoryLabel}
          aria-label={backToHistoryLabel}
        >
          <History size={11} />
          {backToHistoryLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onNew}
        disabled={newDisabled}
        className="no-drag mb-0.5 grid size-6 shrink-0 place-items-center rounded-[5px] text-text-weak transition-[background,color] hover:bg-surface-hover hover:text-text-strong disabled:pointer-events-none disabled:opacity-45"
        title={newTitle}
        aria-label={newTitle}
      >
        <Plus size={13} />
      </button>
    </div>
  )
}

function SessionListSkeleton({ label }: { label: string }) {
  const rows = [
    { title: '50%', meta: 96 },
    { title: '40%', meta: 112 },
    { title: '60%', meta: 80 }
  ]

  return (
    <div className="space-y-1" role="status" aria-live="polite" aria-label={label}>
      {rows.map((row, index) => (
        <div
          key={`${row.title}-${row.meta}`}
          className="rounded-lg border border-border-weak bg-surface/86 px-2.5 py-1.5 shadow-[var(--shadow-sm)]"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border-weak bg-surface-weak">
              <span
                className="size-3 animate-pulse rounded bg-border-weak"
                style={{ animationDelay: `${index * 120}ms` }}
              />
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <span
                className="block h-2.5 animate-pulse rounded-full bg-surface-weak"
                style={{ width: row.title, animationDelay: `${index * 120}ms` }}
              />
              <span
                className="block h-2 animate-pulse rounded-full bg-surface-weak/70"
                style={{
                  width: row.meta,
                  animationDelay: `${index * 120 + 80}ms`
                }}
              />
            </div>
          </div>
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}
