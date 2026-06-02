import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store/app'
import { CLIS } from '@/data/clis'
import { Button } from '@/components/ui/Button'
import { TerminalView } from '@/components/terminal/TerminalView'
import { ConfigView } from '@/components/config/ConfigView'
import { CliIcon } from '@/components/CliIcon'
import type { AppConfig, CliId, SessionInfo } from '@shared/types'

interface ActiveTerminal {
  key: string
  mode: 'cli' | 'shell'
  cwd?: string
  resumeId?: string
}

export function Shell() {
  const activeCli = useAppStore((s) => s.activeCli)
  const setActiveCli = useAppStore((s) => s.setActiveCli)
  const resetOnboarding = useAppStore((s) => s.resetOnboarding)
  const active = CLIS.find((c) => c.id === activeCli) ?? CLIS[0]

  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [cwd, setCwd] = useState<string>('')
  const [view, setView] = useState<'run' | 'config'>('run')
  const [terminal, setTerminal] = useState<ActiveTerminal | null>(null)
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
    if (view === 'run' && !terminal) refreshSessions()
  }, [view, terminal, refreshSessions])

  // Switching CLI closes the current terminal (back to that CLI's landing).
  useEffect(() => setTerminal(null), [activeCli])

  const installed = cfg?.install[active.id as CliId]?.installed ?? false

  const pickDir = async () => {
    const dir = await window.api.pickDir()
    if (dir) setCwd(dir)
  }

  const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  const start = (mode: 'cli' | 'shell') =>
    setTerminal({ key: newKey(), mode, cwd: cwd || undefined })

  // Resume a saved session — restores its previous conversation in the CLI.
  const resume = (s: SessionInfo) =>
    setTerminal({ key: newKey(), mode: 'cli', cwd: s.cwd, resumeId: s.id })

  // CLI exited — drop the dead terminal, return to the list (which refetches).
  const onTerminalExit = () => setTerminal(null)

  const fmtTime = (ms: number) => {
    const d = new Date(ms)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
            ) : (
              <div className="mx-auto flex h-full w-full max-w-lg flex-col items-center gap-6 overflow-y-auto px-8 py-10">
                <div className="text-center">
                  <div className="font-mono text-[13px] text-text-weak">
                    <span style={{ color: 'var(--accent)' }}>$</span> 准备运行 {active.name}
                  </div>
                  <p className="mt-1 text-[12px] text-text-weak">env 已由 app 注入，无需 export。</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Button onClick={() => start('cli')} disabled={!installed}>
                      {installed ? `启动 ${active.name}（新会话）` : '请先在引导中安装'}
                    </Button>
                    <Button variant="secondary" onClick={() => start('shell')}>
                      打开终端
                    </Button>
                  </div>
                </div>

                <div className="w-full">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-[12px] font-medium uppercase tracking-wide text-text-weak">
                      历史会话
                    </span>
                    <button
                      onClick={refreshSessions}
                      className="text-[12px] text-text-weak hover:text-text-strong"
                    >
                      刷新
                    </button>
                  </div>

                  {loadingSessions ? (
                    <div className="px-1 text-[12px] text-text-weak">读取中…</div>
                  ) : sessions.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border-weak px-4 py-6 text-center text-[12px] text-text-weak">
                      {active.id === 'gemini'
                        ? '该 CLI 暂不支持恢复历史会话'
                        : `还没有 ${active.name} 历史会话，启动一个新会话开始吧`}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {sessions.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => resume(s)}
                          className="flex w-full items-center gap-3 rounded-lg border border-border-weak bg-surface px-3 py-2 text-left hover:border-border-selected"
                          title="恢复这个会话"
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
                          <span className="shrink-0 text-[11px] text-text-weak">恢复 →</span>
                        </button>
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
    <span className="flex items-center gap-1.5 rounded-full border border-border-weak px-2.5 py-1 text-[12px] text-text-base">
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {label}
    </span>
  )
}
