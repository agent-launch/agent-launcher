import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store/app'
import { CLIS } from '@/data/clis'
import { Button } from '@/components/ui/Button'
import { TerminalView } from '@/components/terminal/TerminalView'
import { ConfigView } from '@/components/config/ConfigView'
import { CliIcon } from '@/components/CliIcon'
import { Sidebar } from '@/components/shell/Sidebar'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { ChatView } from '@/components/chat/ChatView'
import { useT } from '@/i18n'
import type { AppConfig, CliId, SessionInfo } from '@shared/types'

/** In-UI chat is implemented for every supported CLI. */
const CHAT_CLIS = new Set<CliId>(['claude-code', 'codex', 'opencode', 'pi'])

interface ActiveTerminal {
  key: string
  mode: 'cli' | 'shell'
  cwd?: string
  resumeId?: string
}

export function Shell() {
  const t = useT()
  const activeCli = useAppStore((s) => s.activeCli)
  const renderTranscript = useAppStore((s) => s.renderTranscript)
  const active = CLIS.find((c) => c.id === activeCli) ?? CLIS[0]

  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [cwd, setCwd] = useState<string>('')
  const [view, setView] = useState<'run' | 'config'>('run')
  const [terminal, setTerminal] = useState<ActiveTerminal | null>(null)
  const [transcriptFor, setTranscriptFor] = useState<SessionInfo | null>(null)
  const [chatFor, setChatFor] = useState<{ key: string; cwd?: string; resumeId?: string } | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

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

  const chatSupported = CHAT_CLIS.has(active.id as CliId)

  const installed = cfg?.install[active.id as CliId]?.installed ?? false

  const pickDir = async () => {
    const dir = await window.api.pickDir()
    if (dir) setCwd(dir)
  }

  const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  const start = (mode: 'cli' | 'shell') =>
    setTerminal({ key: newKey(), mode, cwd: cwd || undefined })

  // Start a fresh in-UI chat (programmatic mode) in the chosen project dir.
  const startChat = () => setChatFor({ key: newKey(), cwd: cwd || undefined })

  // Open a terminal resuming a session (or fresh when no id), closing chat/transcript.
  const openTerminal = (resumeId?: string, dir?: string) => {
    setTranscriptFor(null)
    setChatFor(null)
    setTerminal({ key: newKey(), mode: 'cli', cwd: dir ?? cwd ?? undefined, resumeId })
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

  // CLI exited — drop the dead terminal, return to the list (which refetches).
  const onTerminalExit = () => setTerminal(null)

  const fmtTime = (ms: number) => {
    const d = new Date(ms)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="flex h-full overflow-hidden">
      <SettingsModal />
      <Sidebar cfg={cfg} />

      {/* Main pane */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border-weak px-4">
          <div className="flex gap-1">
            {(['run', 'config'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`no-drag rounded-md px-2.5 py-1 text-[13px] ${
                  view === v
                    ? 'bg-surface-weak text-text-strong'
                    : 'text-text-base hover:text-text-strong'
                }`}
              >
                {v === 'run' ? t('shell.tabRun') : t('shell.tabConfig')}
              </button>
            ))}
          </div>
          {view === 'run' && (
            <button
              onClick={pickDir}
              className="no-drag rounded-md bg-surface-weak px-2 py-1 text-[12px] text-text-base hover:text-text-strong"
              title={t('shell.pickDir')}
            >
              {cwd || t('shell.pickDirEmpty')}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Chip label={active.name} color={active.accent} />
            <Chip label={installed ? t('sidebar.installed') : t('sidebar.notInstalled')} />
          </div>
        </div>

        {view === 'config' ? (
          <div className="flex-1 overflow-y-auto bg-base">
            <ConfigView cliId={active.id as CliId} />
          </div>
        ) : (
          <div className="relative flex-1 bg-base">
            {terminal ? (
              <div className="absolute inset-0 p-2">
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
                  onOpenTerminal={(rid) => openTerminal(rid, chatFor.cwd)}
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
              <div className="flex h-full w-full flex-col gap-4 overflow-y-auto px-6 py-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <span className="text-[12px] font-medium uppercase tracking-wide text-text-weak">
                      {t('shell.history')}
                    </span>
                    <button
                      onClick={refreshSessions}
                      className="text-[12px] text-text-weak hover:text-text-strong"
                    >
                      {t('shell.refresh')}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => start('shell')}>
                      {t('shell.openTerminal')}
                    </Button>
                    {renderTranscript && chatSupported ? (
                      <Button onClick={startChat} disabled={!installed}>
                        {installed ? t('chat.start') : t('shell.installFirst')}
                      </Button>
                    ) : (
                      <Button onClick={() => start('cli')} disabled={!installed}>
                        {installed ? t('shell.launch', { name: active.name }) : t('shell.installFirst')}
                      </Button>
                    )}
                  </div>
                </div>

                {loadingSessions ? (
                  <div className="px-1 text-[12px] text-text-weak">{t('shell.loadingSessions')}</div>
                ) : sessions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border-weak px-4 py-6 text-center text-[12px] text-text-weak">
                    {t('shell.noHistory', { name: active.name })}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => resume(s)}
                        className="flex w-full items-center gap-3 rounded-lg border border-border-weak bg-surface px-3 py-2 text-left hover:border-border-selected"
                        title={t('shell.resumeTitle')}
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
                          <CliIcon cliId={active.id as CliId} size={15} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-text-strong">{s.name}</div>
                          <div className="truncate text-[11px] text-text-weak">
                            {fmtTime(s.updatedAt)}
                            {s.cwd ? ` · ${s.cwd}` : ''}
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] text-text-weak">{t('shell.resume')}</span>
                      </button>
                    ))}
                  </div>
                )}
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
    <span className="flex items-center gap-1.5 rounded-full border border-border-weak px-2.5 py-1 text-[12px] text-text-base">
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {label}
    </span>
  )
}
