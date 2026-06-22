import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { Gauge, PanelLeftClose, PanelLeftOpen, Play, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/app'
import { CLIS } from '@/data/clis'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { TerminalView } from '@/components/terminal/TerminalView'
import { ConfigView } from '@/components/config/ConfigView'
import { CliIcon } from '@/components/CliIcon'
import { Sidebar } from '@/components/shell/Sidebar'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { ChatView } from '@/components/chat/ChatView'
import { useT } from '@/i18n'
import { ENABLE_CHAT_HISTORY_RENDERING } from '@/features'
import type { AppConfig, CliId, SessionInfo } from '@shared/types'

/** In-UI chat is implemented for every supported CLI. */
const CHAT_CLIS = new Set<CliId>(['claude-code', 'codex', 'opencode', 'pi'])
const MAC_SIDEBAR_TOGGLE_LEFT = 70

interface ActiveTerminal {
  key: string
  mode: 'cli' | 'shell'
  cwd?: string
  resumeId?: string
}

export function Shell() {
  const t = useT()
  const activeCli = useAppStore((s) => s.activeCli)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const transcriptRenderingPreferred = useAppStore((s) => s.renderTranscript)
  const renderTranscript = ENABLE_CHAT_HISTORY_RENDERING && transcriptRenderingPreferred
  const active = CLIS.find((c) => c.id === activeCli) ?? CLIS[0]
  const isMac = window.api?.platform === 'darwin'

  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [view, setView] = useState<'run' | 'config' | 'settings'>('run')
  const [settingsTab, setSettingsTab] = useState<'general' | 'about'>('general')
  const [settingsCheckUpdatesKey, setSettingsCheckUpdatesKey] = useState(0)
  const [terminal, setTerminal] = useState<ActiveTerminal | null>(null)
  const [transcriptFor, setTranscriptFor] = useState<SessionInfo | null>(null)
  const [chatFor, setChatFor] = useState<{ key: string; cwd?: string; resumeId?: string } | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [openingTerminal, setOpeningTerminal] = useState(false)
  const [openingDashboard, setOpeningDashboard] = useState(false)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const sidebarToggleGuardRef = useRef(0)

  // Reload config whenever we land on the run view (profiles may have changed).
  useEffect(() => {
    window.api.config.get().then(setCfg)
  }, [view, activeCli])

  // Read the CLI's own saved sessions (Claude/Codex conversation history).
  const refreshSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      setSessions(await window.api.sessions.list(active.id as CliId))
    } finally {
      setLoadingSessions(false)
    }
  }, [active.id])

  useEffect(() => {
    if (view === 'run' && !terminal && !chatFor && !transcriptFor) refreshSessions()
  }, [view, terminal, chatFor, transcriptFor, refreshSessions])

  // Switching CLI closes the current terminal/transcript/chat (back to landing).
  useEffect(() => {
    setTerminal(null)
    setTranscriptFor(null)
    setChatFor(null)
  }, [activeCli])

  const chatSupported = ENABLE_CHAT_HISTORY_RENDERING && CHAT_CLIS.has(active.id as CliId)

  const installed = cfg?.install[active.id as CliId]?.installed ?? false

  const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  const start = (mode: 'cli' | 'shell') =>
    setTerminal({ key: newKey(), mode })

  // Start a fresh in-UI chat (programmatic mode) with the CLI's default cwd.
  const startChat = () => setChatFor({ key: newKey() })

  const openSettings = () => {
    setTerminal(null)
    setTranscriptFor(null)
    setChatFor(null)
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
      setTerminal(null)
      setTranscriptFor(null)
      setChatFor(null)
      setSettingsTab('about')
      setSettingsCheckUpdatesKey((key) => key + 1)
      setView('settings')
    })
  }, [])

  useEffect(() => {
    return window.api.app.onOpenAbout?.(() => {
      setTerminal(null)
      setTranscriptFor(null)
      setChatFor(null)
      setSettingsTab('about')
      setView('settings')
    })
  }, [])

  const openExternalTerminal = async () => {
    setOpeningTerminal(true)
    try {
      await window.api.terminal.openExternal({
        cliId: active.id as CliId,
        mode: 'cli'
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
      const result = await window.api.dashboard.launch(active.id as CliId)
      if (result.ok) {
        setDashboardUrl(result.url)
      } else {
        setDashboardError(result.error)
      }
    } finally {
      setOpeningDashboard(false)
    }
  }

  // Open a terminal resuming a session (or fresh when no id), closing chat/transcript.
  const openTerminal = (resumeId?: string, dir?: string) => {
    setTranscriptFor(null)
    setChatFor(null)
    setTerminal({ key: newKey(), mode: 'cli', cwd: dir, resumeId })
  }

  // Click a saved session. One clear path per mode:
  //  - UI mode + chat-capable CLI → open it in the chat view (history + continue).
  //  - UI mode + non-chat CLI → read-only transcript (defensive; all current CLIs chat).
  //  - terminal mode → resume straight in the terminal.
  const resume = (s: SessionInfo) => {
    if (renderTranscript && CHAT_CLIS.has(s.cliId)) {
      setChatFor({ key: newKey(), cwd: s.cwd, resumeId: s.id })
    } else if (renderTranscript) {
      setTranscriptFor(s)
    } else {
      openTerminal(s.id, s.cwd)
    }
  }

  const confirmDeleteSession = async () => {
    if (!deleteTarget || deletingSessionId) return
    setDeletingSessionId(deleteTarget.id)
    setDeleteError(null)
    try {
      const deleteSession =
        window.api.sessions.remove ??
        window.api.sessions.delete
      if (!deleteSession) {
        throw new Error('会话删除 API 尚未加载，请重启应用窗口后重试')
      }
      const result = await deleteSession(deleteTarget.cliId, deleteTarget.id)
      if (!result.ok) {
        setDeleteError(
          t('shell.deleteSessionFailed', { error: result.error ?? 'Unknown error' })
        )
        return
      }
      setSessions((prev) =>
        prev.filter((entry) => entry.cliId !== deleteTarget.cliId || entry.id !== deleteTarget.id)
      )
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

  // CLI exited — drop the dead terminal, return to the list (which refetches).
  const onTerminalExit = () => setTerminal(null)

  const fmtTime = (ms: number) => {
    const d = new Date(ms)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="relative flex h-full overflow-hidden bg-base">
      {isMac && (
        <button
          type="button"
          onPointerDown={stopChromePointer}
          onMouseDown={stopChromePointer}
          onClick={toggleSidebarFromChrome}
          className="no-drag absolute top-1.5 z-50 grid size-7 place-items-center rounded-md text-text-weak transition-colors hover:bg-[var(--selection-base)] hover:text-text-strong"
          style={{ left: MAC_SIDEBAR_TOGGLE_LEFT }}
          title={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          aria-label={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
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
              {t('shell.deleteSessionMessage', { name: deleteTarget?.name ?? '' })}
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
              {deletingSessionId ? t('shell.deleteSessionDeleting') : t('shell.deleteSessionConfirm')}
            </Button>
          </div>
        </div>
      </Modal>
      <Sidebar cfg={cfg} view={view} onSelectCli={() => setView('run')} onOpenSettings={openSettings} />

      {/* Main pane */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-base">
        <div
          className={`flex shrink-0 items-center gap-3 bg-base/80 px-4 backdrop-blur-xl ${
            isMac ? 'h-10 pr-4' : 'h-11 border-b border-border-weak'
          }`}
          style={{ paddingLeft: isMac ? (sidebarCollapsed ? MAC_SIDEBAR_TOGGLE_LEFT + 38 : 20) : undefined }}
        >
          {view === 'settings' ? (
            <h1 className="font-display text-[15px] font-semibold text-text-strong">{t('settings.title')}</h1>
          ) : (
            <>
              <div className="flex gap-0.5 rounded-md border border-border-weak bg-surface/70 p-0.5 shadow-[0_1px_1px_rgba(0,0,0,0.04)]">
                {(['run', 'config'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`no-drag rounded-[5px] px-2.5 py-1 text-[13px] font-medium transition-colors ${
                      view === v
                        ? 'bg-[var(--button-primary-base)] text-[var(--button-primary-text)] shadow-[var(--shadow-sm)]'
                        : 'text-text-weak hover:text-text-strong'
                    }`}
                  >
                    {v === 'run' ? t('shell.tabRun') : t('shell.tabConfig')}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Chip label={active.name} color={active.accent} />
                <Chip label={installed ? t('sidebar.installed') : t('sidebar.notInstalled')} />
              </div>
            </>
          )}
        </div>

        {view === 'settings' ? (
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ background: 'var(--canvas-gradient)' }}>
            <SettingsPage initialTab={settingsTab} checkUpdatesKey={settingsCheckUpdatesKey} />
          </div>
        ) : view === 'config' ? (
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ background: 'var(--canvas-gradient)' }}>
            <ConfigView cliId={active.id as CliId} />
          </div>
        ) : (
          <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: 'var(--canvas-gradient)' }}>
            {terminal ? (
              <div className="absolute inset-0 p-3">
                <TerminalView
                  cliId={active.id as CliId}
                  mode={terminal.mode}
                  cwd={terminal.cwd}
                  resumeId={terminal.resumeId}
                  sessionKey={terminal.key}
                  onExit={onTerminalExit}
                />
              </div>
            ) : chatFor ? (
              <div className="absolute inset-0">
                <ChatView
                  key={chatFor.key}
                  cliId={active.id as CliId}
                  cwd={chatFor.cwd}
                  resumeId={chatFor.resumeId}
                  onBack={() => setChatFor(null)}
                />
              </div>
            ) : transcriptFor ? (
              <div className="absolute inset-0">
                <TranscriptView
                  cliId={active.id as CliId}
                  sessionId={transcriptFor.id}
                  name={transcriptFor.name}
                  onResume={() => openTerminal(transcriptFor.id, transcriptFor.cwd)}
                  onBack={() => setTranscriptFor(null)}
                />
              </div>
            ) : (
              <div className="mx-auto flex h-full min-h-0 w-full max-w-[980px] flex-col gap-4 px-7 py-6">
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text-weak">
                      {t('shell.history')}
                    </span>
                    <button
                      onClick={refreshSessions}
                      className="text-[12px] text-text-weak hover:text-text-strong"
                    >
                      {t('shell.refresh')}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {active.id === 'hermes' && (
                      <Button
                        variant="secondary"
                        onClick={openDashboard}
                        disabled={openingDashboard || !installed}
                        title={dashboardError ?? undefined}
                      >
                        <Gauge size={13} />
                        {openingDashboard ? t('shell.openingDashboard') : t('shell.openDashboard')}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={openExternalTerminal} disabled={openingTerminal || !installed}>
                      {t('shell.openTerminal')}
                    </Button>
                    {renderTranscript && chatSupported ? (
                      <Button onClick={startChat} disabled={!installed}>
                        {installed ? t('shell.newSession') : t('shell.installFirst')}
                      </Button>
                    ) : (
                      <Button onClick={() => start('cli')} disabled={!installed}>
                        {installed ? t('shell.newSession') : t('shell.installFirst')}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {dashboardError && active.id === 'hermes' && (
                    <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                      {dashboardError}
                    </div>
                  )}
                  {dashboardUrl && active.id === 'hermes' && (
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
                  {loadingSessions ? (
                    <div className="px-1 text-[13px] text-text-weak">{t('shell.loadingSessions')}</div>
                  ) : sessions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border-weak bg-surface/72 px-4 py-12 text-center text-[13px] text-text-weak shadow-[var(--shadow-card)]">
                      {t('shell.noHistory', { name: active.name })}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sessions.map((s) => (
                        <div
                          key={s.id}
                          className="group relative rounded-xl border border-border-weak bg-surface/92 text-left shadow-[var(--shadow-sm)] transition-[background,border-color,box-shadow] hover:border-border-base hover:bg-surface hover:shadow-[var(--shadow-card)]"
                        >
                          <button
                            onClick={() => resume(s)}
                            className="flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                            title={t('shell.resumeTitle')}
                          >
                            <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border-weak bg-surface-weak text-text-strong group-hover:bg-selection">
                              <CliIcon cliId={active.id as CliId} size={15} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] text-text-strong">{s.name}</div>
                              <div className="truncate text-[11px] text-text-weak">
                                {fmtTime(s.updatedAt)}
                              </div>
                            </div>
                          </button>
                          <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 gap-1 rounded-md bg-surface/95 p-1 opacity-0 ring-1 ring-border-weak transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                            <button
                              onClick={(event) => {
                                event.stopPropagation()
                                resume(s)
                              }}
                              className="grid size-7 place-items-center rounded-[5px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong focus:bg-surface-hover focus:text-text-strong"
                              title={t('shell.resumeTitle')}
                              aria-label={t('shell.resumeTitle')}
                            >
                              <Play size={13} />
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation()
                                setDeleteError(null)
                                setDeleteTarget(s)
                              }}
                              className="grid size-7 place-items-center rounded-[5px] text-text-muted transition-colors hover:bg-surface-hover hover:text-danger focus:bg-surface-hover focus:text-danger"
                              title={t('shell.deleteSession')}
                              aria-label={t('shell.deleteSession')}
                              disabled={deletingSessionId === s.id}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function Chip({ label, color }: { label: string; color?: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-border-weak bg-surface/80 px-2 py-0.5 text-[12px] text-text-base shadow-[0_1px_1px_rgba(0,0,0,0.03)]">
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {label}
    </span>
  )
}
