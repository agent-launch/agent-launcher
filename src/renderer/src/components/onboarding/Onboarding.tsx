import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app'
import { Button } from '@/components/ui/Button'
import { CLIS } from '@/data/clis'
import { PROVIDERS_BY_CLI } from '@/data/providers'
import { CliIcon } from '@/components/CliIcon'
import { useT } from '@/i18n'
import type { CliId, DetectResult, InstallProgress } from '@shared/types'

const STEP_KEYS = [
  'onboarding.step.welcome',
  'onboarding.step.detect',
  'onboarding.step.install',
  'onboarding.step.config',
  'onboarding.step.run'
] as const

export function Onboarding() {
  const t = useT()
  const complete = useAppStore((s) => s.completeOnboarding)
  const skip = useAppStore((s) => s.skipOnboarding)
  const [step, setStep] = useState(0)

  const last = step === STEP_KEYS.length - 1
  const next = () => (last ? complete() : setStep((s) => s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--canvas-gradient)' }}>
      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-60 shrink-0 flex-col gap-1 border-r border-border-weak bg-strong p-4 pt-6">
          <div className="mb-6 flex items-center gap-2 px-2">
            <span
              className="grid size-7 place-items-center rounded-lg text-[13px] font-bold text-white shadow-sm"
              style={{
                background:
                  'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #7c3aed))'
              }}
            >
              A
            </span>
            <span className="text-[14px] font-semibold text-text-strong">AgentLauncher</span>
          </div>
          {STEP_KEYS.map((key, i) => {
            const done = i < step
            const active = i === step
            return (
              <div
                key={key}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                  active
                    ? 'bg-accent-soft font-medium text-text-strong'
                    : done
                      ? 'text-text-base'
                      : 'text-text-weak'
                }`}
              >
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors ${
                    done
                      ? 'bg-success text-white'
                      : active
                        ? 'text-white shadow-sm'
                        : 'bg-surface-weak text-text-weak'
                  }`}
                  style={active ? { background: 'var(--accent)' } : undefined}
                >
                  {done ? '✓' : i + 1}
                </span>
                {t(key)}
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
          {t('onboarding.skip')}
        </Button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button variant="secondary" onClick={back}>
              {t('onboarding.back')}
            </Button>
          )}
          <Button onClick={next}>{last ? t('onboarding.finish') : t('onboarding.next')}</Button>
        </div>
      </footer>
    </div>
  )
}

function Welcome() {
  const t = useT()
  return (
    <div className="mx-auto max-w-xl pt-16 text-center">
      <div
        className="mx-auto mb-7 grid size-20 place-items-center rounded-3xl text-3xl font-bold text-white"
        style={{
          background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #7c3aed))',
          boxShadow: '0 16px 40px var(--accent-soft), var(--shadow-md)'
        }}
      >
        A
      </div>
      <h1 className="text-[30px] font-semibold tracking-tight text-text-strong">
        {t('onboarding.welcomeTitle')}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-text-base">
        {t('onboarding.welcomeDesc')}
      </p>
    </div>
  )
}

function DetectStep() {
  const t = useT()
  const [result, setResult] = useState<DetectResult | null>(null)
  useEffect(() => {
    window.api.detect().then(setResult)
  }, [])
  return (
    <StepShell title={t('onboarding.detectTitle')} desc={t('onboarding.detectDesc')}>
      {!result ? (
        <div className="text-[13px] text-text-weak">{t('onboarding.detecting')}</div>
      ) : (
        <ul className="space-y-2">
          {result.items.map((it) => (
            <li
              key={it.key}
              className="flex items-center justify-between rounded-xl border border-border-weak bg-surface px-4 py-3 text-[14px] shadow-[var(--shadow-sm)]"
            >
              <span className="flex items-center gap-2.5 text-text-strong">
                <span
                  className="grid size-5 place-items-center rounded-full text-[11px]"
                  style={{
                    background: it.present ? 'var(--success)' : 'var(--surface-weak)',
                    color: it.present ? '#fff' : 'var(--text-weak)'
                  }}
                >
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
  const t = useT()
  const [ui, setUi] = useState<Record<string, CliInstallUi>>({})

  // Seed from persisted install state so already-installed CLIs show "已安装".
  useEffect(() => {
    window.api.config.get().then((cfg) => {
      setUi((prev) => {
        const next = { ...prev }
        for (const c of CLIS) {
          const inst = cfg.install[c.id as CliId]
          if (inst?.installed && !next[c.id]?.busy) {
            next[c.id] = { phase: 'done', message: '已安装', version: inst.version }
          }
        }
        return next
      })
    })
  }, [])

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
    // Skip already-installed CLIs; use each row's 重装 to reinstall one.
    for (const c of CLIS) {
      if (ui[c.id]?.phase === 'done') continue
      await installOne(c.id as CliId)
    }
  }

  return (
    <StepShell title={t('onboarding.installTitle')} desc={t('onboarding.installDesc')}>
      <div className="space-y-2">
        {CLIS.map((c) => {
          const s = ui[c.id] ?? {}
          return (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-xl border border-border-weak bg-surface px-4 py-3 shadow-[var(--shadow-sm)]"
            >
              <span
                className={`grid size-9 place-items-center rounded-lg ${
                  s.phase === 'done' ? 'bg-success/15 text-success' : 'bg-accent-soft text-accent'
                }`}
              >
                <CliIcon cliId={c.id as CliId} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-text-strong">{c.name}</div>
                <div className="truncate text-[12px] text-text-weak">
                  {s.error ? (
                    <span style={{ color: 'var(--danger)' }}>{s.error}</span>
                  ) : s.phase === 'done' ? (
                    <span style={{ color: 'var(--success)' }}>
                      {t('onboarding.installed', {
                        version: s.version && s.version !== 'installed' ? ` ${s.version}` : ''
                      })}
                    </span>
                  ) : s.busy ? (
                    `${s.message ?? t('onboarding.installing')}${s.fraction != null ? ` ${Math.round(s.fraction * 100)}%` : ''}`
                  ) : (
                    `${c.vendor} · ${c.install === 'native-binary' ? t('onboarding.nativeBinary') : t('onboarding.portableNode')}`
                  )}
                </div>
              </div>
              <Button size="sm" variant="secondary" disabled={s.busy} onClick={() => installOne(c.id as CliId)}>
                {s.phase === 'done'
                  ? t('onboarding.reinstallBtn')
                  : s.busy
                    ? t('onboarding.installBusy')
                    : t('onboarding.installBtn')}
              </Button>
            </div>
          )
        })}
      </div>
      <Button className="mt-4" onClick={installAll}>
        {t('onboarding.installAll')}
      </Button>
    </StepShell>
  )
}

function ConfigStep() {
  const t = useT()
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
    const p = providers.find((x) => x.id === providerId)
    await window.api.config.addProfile(cliId, {
      name: p?.name ?? t('category.custom'),
      providerId,
      baseUrl,
      apiKey
    })
    setSaved(true)
  }

  return (
    <StepShell title={t('onboarding.configTitle')} desc={t('onboarding.configDesc')}>
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
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              cliId === c.id ? 'bg-accent-soft text-accent' : 'text-text-base hover:bg-surface-weak'
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
            className={`rounded-xl border bg-surface px-3 py-2.5 text-left transition-all ${
              providerId === p.id
                ? 'border-border-selected bg-accent-soft shadow-[var(--shadow-card)]'
                : 'border-border-weak hover:border-border-base hover:shadow-[var(--shadow-sm)]'
            }`}
          >
            <div className="truncate text-[13px] font-medium text-text-strong">{p.name}</div>
            <div className="mt-0.5 text-[11px] text-text-weak">{t('category.' + p.category)}</div>
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
              className="selectable mt-1 w-full rounded-lg border border-border-weak bg-surface px-3 py-2.5 text-[13px] text-text-strong outline-none focus:border-border-selected"
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-text-weak">API Key</span>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder="sk-..."
              className="selectable mt-1 w-full rounded-lg border border-border-weak bg-surface px-3 py-2.5 text-[13px] text-text-strong outline-none focus:border-border-selected"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button onClick={save}>{t('onboarding.saveConfig')}</Button>
            {saved && <span className="text-[13px] text-success">{t('onboarding.saved')}</span>}
          </div>
        </div>
      )}
    </StepShell>
  )
}

function Done() {
  const t = useT()
  return (
    <div className="mx-auto max-w-xl pt-16 text-center">
      <div
        className="mx-auto mb-7 grid size-20 place-items-center rounded-3xl bg-success text-3xl text-white"
        style={{ boxShadow: '0 16px 40px var(--success-soft, rgba(18,138,74,0.18)), var(--shadow-md)' }}
      >
        ✓
      </div>
      <h1 className="text-[30px] font-semibold tracking-tight text-text-strong">{t('onboarding.doneTitle')}</h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-text-base">
        {t('onboarding.doneDesc')}
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
