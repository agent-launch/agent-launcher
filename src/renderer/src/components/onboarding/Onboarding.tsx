import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app'
import { Button } from '@/components/ui/Button'
import { CLIS } from '@/data/clis'
import { PROVIDERS_BY_CLI, CATEGORY_LABEL } from '@/data/providers'
import type { CliId, DetectResult, InstallProgress } from '@shared/types'

const STEPS = ['欢迎', '检测环境', '自动安装', '配置中转', '开跑'] as const

export function Onboarding() {
  const complete = useAppStore((s) => s.completeOnboarding)
  const skip = useAppStore((s) => s.skipOnboarding)
  const [step, setStep] = useState(0)

  const last = step === STEPS.length - 1
  const next = () => (last ? complete() : setStep((s) => s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))

  return (
    <div className="flex h-full flex-col bg-base">
      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-border-weak bg-strong p-4 pt-6">
          <div className="mb-5 px-2 text-[13px] font-medium text-text-weak">首次设置</div>
          {STEPS.map((label, i) => {
            const done = i < step
            const active = i === step
            return (
              <div
                key={label}
                className={`flex items-center gap-3 rounded-md px-2 py-2 text-[13px] ${
                  active ? 'bg-surface-weak text-text-strong' : 'text-text-base'
                }`}
              >
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                    done ? 'bg-success text-white' : active ? 'text-white' : 'bg-surface-weak text-text-weak'
                  }`}
                  style={active ? { background: 'var(--accent)' } : undefined}
                >
                  {done ? '✓' : i + 1}
                </span>
                {label}
              </div>
            )
          })}
        </aside>

        <section className="flex-1 overflow-y-auto px-10 py-8">
          {step === 0 && <Welcome />}
          {step === 1 && <DetectStep />}
          {step === 2 && <InstallStep />}
          {step === 3 && <ConfigStep />}
          {step === 4 && <Done />}
        </section>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-border-weak bg-strong px-6 py-3">
        <Button variant="ghost" size="sm" onClick={skip}>
          跳过引导
        </Button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button variant="secondary" onClick={back}>
              上一步
            </Button>
          )}
          <Button onClick={next}>{last ? '完成，进入主界面' : '下一步'}</Button>
        </div>
      </footer>
    </div>
  )
}

function Welcome() {
  return (
    <div className="mx-auto max-w-xl pt-10 text-center">
      <div
        className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl text-2xl font-bold text-white"
        style={{ background: 'var(--accent)' }}
      >
        A
      </div>
      <h1 className="text-[28px] font-semibold text-text-strong">欢迎使用 AgentLauncher</h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-text-base">
        不用装 Node、不用配环境变量、不用碰命令行。接下来几分钟，我们帮你装好并配好 Claude Code /
        Codex / Gemini CLI，直接开跑。
      </p>
    </div>
  )
}

function DetectStep() {
  const [result, setResult] = useState<DetectResult | null>(null)
  useEffect(() => {
    window.api.detect().then(setResult)
  }, [])
  return (
    <StepShell title="检测你的环境" desc="看看系统里已经有什么、还缺什么。缺的我们会自动补上。">
      {!result ? (
        <div className="text-[13px] text-text-weak">检测中…</div>
      ) : (
        <ul className="space-y-2">
          {result.items.map((it) => (
            <li
              key={it.key}
              className="flex items-center justify-between rounded-lg border border-border-weak bg-surface px-4 py-3 text-[14px]"
            >
              <span className="flex items-center gap-2 text-text-strong">
                <span style={{ color: it.present ? 'var(--success)' : 'var(--text-weak)' }}>
                  {it.present ? '✓' : '○'}
                </span>
                {it.label}
              </span>
              <span className="text-[12px] text-text-weak">{it.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </StepShell>
  )
}

interface CliInstallUi {
  phase?: InstallProgress['phase']
  message?: string
  fraction?: number
  version?: string
  error?: string
  busy?: boolean
}

function InstallStep() {
  const [ui, setUi] = useState<Record<string, CliInstallUi>>({})

  useEffect(() => {
    return window.api.install.onProgress((p) => {
      setUi((prev) => ({
        ...prev,
        [p.cliId]: { ...prev[p.cliId], phase: p.phase, message: p.message, fraction: p.fraction }
      }))
    })
  }, [])

  const installOne = async (id: CliId) => {
    setUi((p) => ({ ...p, [id]: { ...p[id], busy: true, error: undefined } }))
    const r = await window.api.install.cli(id)
    setUi((p) => ({
      ...p,
      [id]: r.ok
        ? { busy: false, phase: 'done', message: '完成', version: r.version }
        : { busy: false, phase: 'error', error: r.error }
    }))
  }

  const installAll = async () => {
    for (const c of CLIS) await installOne(c.id as CliId)
  }

  return (
    <StepShell title="一键安装 CLI" desc="全部装进独立沙盒 ~/.agent-launcher，不污染你已有的环境。">
      <div className="space-y-2">
        {CLIS.map((c) => {
          const s = ui[c.id] ?? {}
          return (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-lg border border-border-weak bg-surface px-4 py-3"
            >
              <span
                className="grid size-8 place-items-center rounded-md text-[13px] font-semibold text-white"
                style={{ background: c.accent }}
              >
                {c.glyph}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-text-strong">{c.name}</div>
                <div className="truncate text-[12px] text-text-weak">
                  {s.error ? (
                    <span style={{ color: 'var(--danger)' }}>{s.error}</span>
                  ) : s.phase === 'done' ? (
                    <span style={{ color: 'var(--success)' }}>已安装 {s.version}</span>
                  ) : s.busy ? (
                    `${s.message ?? '安装中'}${s.fraction != null ? ` ${Math.round(s.fraction * 100)}%` : ''}`
                  ) : (
                    `${c.vendor} · ${c.install === 'native-binary' ? '原生二进制（无需 Node）' : '便携 Node + npm'}`
                  )}
                </div>
              </div>
              <Button size="sm" variant="secondary" disabled={s.busy} onClick={() => installOne(c.id as CliId)}>
                {s.phase === 'done' ? '重装' : s.busy ? '安装中…' : '安装'}
              </Button>
            </div>
          )
        })}
      </div>
      <Button className="mt-4" onClick={installAll}>
        Install All
      </Button>
    </StepShell>
  )
}

function ConfigStep() {
  const [cliId, setCliId] = useState<CliId>('claude-code')
  const [providerId, setProviderId] = useState<string>('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)

  const providers = PROVIDERS_BY_CLI[cliId]

  const select = (id: string) => {
    setProviderId(id)
    const p = providers.find((x) => x.id === id)
    setBaseUrl(p?.baseUrl ?? '')
    setSaved(false)
  }

  const save = async () => {
    await window.api.config.setCli(cliId, { providerId, baseUrl, apiKey })
    setSaved(true)
  }

  return (
    <StepShell
      title="选个中转，粘上 Key"
      desc="国内直连不了官方？选一家中转，粘上 API Key。配置存在本地（明文 JSON），env 由 app 注入。"
    >
      <div className="mb-3 flex gap-1">
        {CLIS.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setCliId(c.id as CliId)
              setProviderId('')
              setBaseUrl('')
              setSaved(false)
            }}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              cliId === c.id ? 'bg-surface-weak text-text-strong' : 'text-text-base hover:bg-surface-weak/60'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1">
        {providers.map((p) => (
          <button
            key={p.id}
            onClick={() => select(p.id)}
            className={`rounded-lg border bg-surface px-3 py-2 text-left ${
              providerId === p.id ? 'border-border-selected' : 'border-border-weak hover:border-border-base'
            }`}
          >
            <div className="truncate text-[13px] font-medium text-text-strong">{p.name}</div>
            <div className="mt-0.5 text-[11px] text-text-weak">{CATEGORY_LABEL[p.category]}</div>
          </button>
        ))}
      </div>

      {providerId && (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-[12px] text-text-weak">Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://..."
              className="selectable mt-1 w-full rounded-md border border-border-weak bg-surface px-3 py-2 text-[13px] text-text-strong outline-none focus:border-border-selected"
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-text-weak">API Key</span>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder="sk-..."
              className="selectable mt-1 w-full rounded-md border border-border-weak bg-surface px-3 py-2 text-[13px] text-text-strong outline-none focus:border-border-selected"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button onClick={save}>保存配置</Button>
            {saved && <span className="text-[13px] text-success">已保存 ✓</span>}
          </div>
        </div>
      )}
    </StepShell>
  )
}

function Done() {
  return (
    <div className="mx-auto max-w-xl pt-10 text-center">
      <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-success text-2xl text-white">
        ✓
      </div>
      <h1 className="text-[28px] font-semibold text-text-strong">一切就绪</h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-text-base">
        点「完成」进入主界面，选个项目目录就能开始和 Claude Code 对话了。环境变量我们已经替你注入，你永远不用 export。
      </p>
    </div>
  )
}

function StepShell({
  title,
  desc,
  children
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="text-[22px] font-semibold text-text-strong">{title}</h2>
      <p className="mt-2 mb-6 text-[14px] leading-relaxed text-text-base">{desc}</p>
      {children}
    </div>
  )
}
