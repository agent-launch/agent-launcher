import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store/app'
import { useSessionStore } from '@/store/sessions'
import { CLIS } from '@/data/clis'
import { Button } from '@/components/ui/Button'
import { TerminalView } from '@/components/terminal/TerminalView'
import { ConfigView } from '@/components/config/ConfigView'
import { CliIcon } from '@/components/CliIcon'
import type { AppConfig, CliId } from '@shared/types'

export function Shell() {
  const activeCli = useAppStore((s) => s.activeCli)
  const setActiveCli = useAppStore((s) => s.setActiveCli)
  const resetOnboarding = useAppStore((s) => s.resetOnboarding)
  const active = CLIS.find((c) => c.id === activeCli) ?? CLIS[0]

  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [cwd, setCwd] = useState<string>('')
  const [view, setView] = useState<'run' | 'config'>('run')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const sessions = useSessionStore((s) => s.sessions)
  const addSession = useSessionStore((s) => s.add)
  const setSessionStatus = useSessionStore((s) => s.setStatus)
  const removeSession = useSessionStore((s) => s.remove)

  const cliSessions = sessions.filter((s) => s.cliId === active.id)
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  // Reload config whenever we land on the run view (profiles may have changed).
  useEffect(() => {
    window.api.config.get().then(setCfg)
  }, [view, activeCli])

  // Leave the terminal when switching CLI; its PTY dies on unmount, so the
  // session is no longer running — retire it before returning to the landing.
  const activeRef = useRef<string | null>(null)
  activeRef.current = activeSessionId
  useEffect(() => {
    if (activeRef.current) setSessionStatus(activeRef.current, 'exited')
    setActiveSessionId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCli])

  const installed = cfg?.install[active.id as CliId]?.installed ?? false

  const pickDir = async () => {
    const dir = await window.api.pickDir()
    if (dir) setCwd(dir)
  }

  const shortCwd = (p?: string) => (p ? p.replace(/^.*[/\\]/, '') || p : '~')

  const start = (mode: 'cli' | 'shell') => {
    const label = `${mode === 'cli' ? active.name : 'Shell'} · ${shortCwd(cwd)}`
    const s = addSession({ cliId: active.id as CliId, mode, cwd: cwd || undefined, label })
    setActiveSessionId(s.id)
  }

  // Re-open a session from the list (spawns a fresh PTY with its config).
  const openSession = (id: string) => {
    setSessionStatus(id, 'running')
    setActiveSessionId(id)
  }

  // CLI process exited — drop the dead terminal and return to the list.
  const onTerminalExit = (code: number) => {
    if (activeSessionId) setSessionStatus(activeSessionId, 'exited', code)
    setActiveSessionId(null)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border-weak bg-strong">
        <div className="px-4 pb-2 pt-4 text-[12px] font-medium uppercase tracking-wide text-text-weak">
          CLI
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {CLIS.map((c) => {
            const selected = c.id === active.id
            const isInstalled = cfg?.install[c.id as CliId]?.installed
            return (
              <button
                key={c.id}
                onClick={() => setActiveCli(c.id)}
                className={`no-drag flex items-center gap-3 rounded-md px-2 py-2 text-left text-[14px] transition-colors ${
                  selected
                    ? 'bg-surface-weak text-text-strong'
                    : 'text-text-base hover:bg-surface-weak/60'
                }`}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
                  <CliIcon cliId={c.id as CliId} size={16} />
                </span>
                <span className="flex-1">{c.name}</span>
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: isInstalled ? 'var(--success)' : 'var(--border-base)' }}
                  title={isInstalled ? '已安装' : '未安装'}
                />
              </button>
            )
          })}
        </nav>

        <div className="mt-auto border-t border-border-weak p-3">
          <button
            onClick={resetOnboarding}
            className="no-drag w-full rounded-md px-2 py-1.5 text-left text-[12px] text-text-weak hover:bg-surface-weak hover:text-text-base"
          >
            重新运行引导（dev）
          </button>
        </div>
      </aside>

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
                {v === 'run' ? '运行' : '配置'}
              </button>
            ))}
          </div>
          {view === 'run' && (
            <button
              onClick={pickDir}
              className="no-drag rounded-md bg-surface-weak px-2 py-1 text-[12px] text-text-base hover:text-text-strong"
              title="选择项目目录"
            >
              {cwd || '~/选择项目目录'}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Chip label={active.name} color={active.accent} />
            <Chip label={installed ? '已安装' : '未安装'} />
          </div>
        </div>

        {view === 'config' ? (
          <div className="flex-1 overflow-y-auto bg-base">
            <ConfigView cliId={active.id as CliId} />
          </div>
        ) : (
          <div className="relative flex-1 bg-base">
            {activeSession ? (
              <div className="absolute inset-0 p-2">
                <TerminalView
                  cliId={activeSession.cliId}
                  mode={activeSession.mode}
                  cwd={activeSession.cwd}
                  sessionKey={activeSession.id}
                  onExit={onTerminalExit}
                />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
                <div className="text-center">
                  <div className="font-mono text-[13px] text-text-weak">
                    <span style={{ color: 'var(--accent)' }}>$</span> 准备运行 {active.name}
                  </div>
                  <p className="mt-1 text-[12px] text-text-weak">env 已由 app 注入，无需 export。</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Button onClick={() => start('cli')} disabled={!installed}>
                      {installed ? `启动 ${active.name}` : '请先在引导中安装'}
                    </Button>
                    <Button variant="secondary" onClick={() => start('shell')}>
                      打开终端
                    </Button>
                  </div>
                </div>

                {cliSessions.length > 0 && (
                  <div className="w-full max-w-md">
                    <div className="mb-2 px-1 text-[12px] font-medium uppercase tracking-wide text-text-weak">
                      Session 列表
                    </div>
                    <div className="space-y-1.5">
                      {cliSessions.map((s) => (
                        <div
                          key={s.id}
                          className="group flex items-center gap-3 rounded-lg border border-border-weak bg-surface px-3 py-2"
                        >
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{
                              background: s.status === 'running' ? 'var(--success)' : 'var(--border-base)'
                            }}
                            title={s.status === 'running' ? '运行中' : '已退出'}
                          />
                          <button
                            onClick={() => openSession(s.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="truncate text-[13px] text-text-strong">{s.label}</div>
                            <div className="text-[11px] text-text-weak">
                              {s.mode === 'cli' ? 'CLI' : '终端'}
                              {s.status === 'exited' && s.exitCode != null
                                ? ` · 退出码 ${s.exitCode}`
                                : ''}
                              {s.cwd ? ` · ${s.cwd}` : ''}
                            </div>
                          </button>
                          <button
                            onClick={() => removeSession(s.id)}
                            className="shrink-0 text-[12px] text-text-weak opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                            title="移除"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
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
