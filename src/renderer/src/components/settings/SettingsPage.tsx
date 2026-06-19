import { useEffect, useState } from 'react'
import { Download, Info, RefreshCw, Settings2, TriangleAlert } from 'lucide-react'
import { Switch } from '@/components/ui/Switch'
import { CliIcon } from '@/components/CliIcon'
import { CLIS, YOLO_SUPPORT } from '@/data/clis'
import { useAppStore, type ThemeMode, type LocaleMode } from '@/store/app'
import { useT } from '@/i18n'
import { ENABLE_CHAT_HISTORY_RENDERING } from '@/features'
import { Button } from '@/components/ui/Button'
import type { AppConfig, AppInfo, CliId, CliUpdateStatus, InstallProgress } from '@shared/types'

type SettingsTab = 'general' | 'about'

export function SettingsPage() {
  const t = useT()
  const [tab, setTab] = useState<SettingsTab>('general')

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 px-7 py-6">
      <div>
        <h2 className="font-display text-[20px] font-semibold text-text-strong">{t('settings.title')}</h2>
        <p className="mt-1 text-[13px] text-text-weak">{t('settings.pageDesc')}</p>
      </div>

      <div className="flex w-fit rounded-md border border-border-weak bg-surface-weak p-0.5">
        <TabButton active={tab === 'general'} icon={<Settings2 size={14} />} onClick={() => setTab('general')}>
          {t('settings.tabGeneral')}
        </TabButton>
        <TabButton active={tab === 'about'} icon={<Info size={14} />} onClick={() => setTab('about')}>
          {t('settings.tabAbout')}
        </TabButton>
      </div>

      {tab === 'general' ? <GeneralSettings /> : <AboutSettings />}
    </div>
  )
}

function TabButton({
  active,
  icon,
  children,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[13px] transition-colors ${
        active ? 'bg-surface text-text-strong' : 'text-text-weak hover:text-text-strong'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function GeneralSettings() {
  const t = useT()
  const themeMode = useAppStore((s) => s.themeMode)
  const setThemeMode = useAppStore((s) => s.setThemeMode)
  const localeMode = useAppStore((s) => s.localeMode)
  const setLocaleMode = useAppStore((s) => s.setLocaleMode)
  const renderTranscript = useAppStore((s) => s.renderTranscript)
  const setRenderTranscript = useAppStore((s) => s.setRenderTranscript)
  const [cfg, setCfg] = useState<AppConfig | null>(null)

  useEffect(() => {
    window.api.config.get().then(setCfg)
  }, [])

  const toggleYolo = async (id: CliId, on: boolean) => {
    const next = await window.api.config.setYolo(id, on)
    setCfg(next)
  }

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: t('settings.theme.system') },
    { value: 'light', label: t('settings.theme.light') },
    { value: 'dark', label: t('settings.theme.dark') }
  ]
  const localeOptions: { value: LocaleMode; label: string }[] = [
    { value: 'system', label: t('settings.locale.system') },
    { value: 'zh', label: t('settings.locale.zh') },
    { value: 'en', label: t('settings.locale.en') }
  ]

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border-weak bg-surface/90 p-4">
        <div className="space-y-4">
          <Row label={t('settings.appearance')}>
            <Segmented options={themeOptions} value={themeMode} onChange={setThemeMode} />
          </Row>
          <Row label={t('settings.language')}>
            <Segmented options={localeOptions} value={localeMode} onChange={setLocaleMode} />
          </Row>
          {ENABLE_CHAT_HISTORY_RENDERING && (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-text-strong">{t('settings.renderTranscript')}</div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-text-weak">
                  {t('settings.renderTranscriptDesc')}
                </p>
              </div>
              <div className="pt-0.5">
                <Switch checked={renderTranscript} onChange={setRenderTranscript} />
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border-weak bg-surface/90 p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-medium text-text-strong">{t('settings.yolo.title')}</h3>
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            style={{ background: 'color-mix(in srgb, var(--warning) 22%, transparent)', color: 'var(--text-strong)' }}
          >
            <TriangleAlert size={11} /> {t('settings.yolo.danger')}
          </span>
        </div>
        <p className="mt-1.5 mb-3 text-[12px] leading-relaxed text-text-weak">{t('settings.yolo.desc')}</p>

        <div className="space-y-1.5">
          {CLIS.map((cli) => {
            const support = YOLO_SUPPORT[cli.id]
            const enabled = !!cfg?.prefs[cli.id as CliId]?.yolo
            return (
              <div
                key={cli.id}
                className="flex items-center gap-3 rounded-lg border border-border-weak bg-surface/90 px-3 py-2.5"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
                  <CliIcon cliId={cli.id as CliId} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-text-strong">{cli.name}</div>
                  <div className="truncate font-mono text-[11px] text-text-weak">
                    {support?.supported ? support.note : t('settings.yolo.unsupported')}
                  </div>
                </div>
                {support?.supported ? (
                  <Switch checked={enabled} onChange={(value) => toggleYolo(cli.id as CliId, value)} />
                ) : (
                  <span className="text-[11px] text-text-weak">{t('settings.yolo.notSupported')}</span>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function AboutSettings() {
  const t = useT()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [statuses, setStatuses] = useState<CliUpdateStatus[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState<CliId | null>(null)
  const [progress, setProgress] = useState<Partial<Record<CliId, InstallProgress>>>({})

  useEffect(() => {
    window.api.app.info().then(setInfo)
  }, [])

  useEffect(() => {
    void refreshStatuses()
    return window.api.install.onProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.cliId]: p }))
    })
  }, [])

  const refreshStatuses = async () => {
    setChecking(true)
    try {
      setStatuses(await window.api.install.status())
    } finally {
      setChecking(false)
    }
  }

  const installUpdate = async (status: CliUpdateStatus) => {
    const cliId = status.cliId
    const meta = CLIS.find((cli) => cli.id === cliId)
    const source = status.source ?? (meta?.install === 'system' ? 'system' : 'sandbox')
    const action = status.installed ? 'reinstall' : 'install'
    setInstalling(cliId)
    setProgress((prev) => ({
      ...prev,
      [cliId]: {
        cliId,
        phase: 'resolve',
        message: t(status.installed ? 'settings.cliStatus.updating' : 'settings.cliStatus.installing')
      }
    }))
    const result = await window.api.install.cli(cliId, {
      source,
      action,
      binPath: source === 'system' ? status.binPath : undefined
    })
    if (!result.ok) {
      setProgress((prev) => ({
        ...prev,
        [cliId]: {
          cliId,
          phase: 'error',
          message: result.error
        }
      }))
    }
    setInstalling(null)
    await refreshStatuses()
  }

  const statusById = new Map((statuses ?? []).map((status) => [status.cliId, status]))

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border-weak bg-surface/90 p-5">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-surface-weak text-text-strong">
            <Info size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[18px] font-semibold text-text-strong">AgentLauncher</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-text-weak">{t('settings.aboutDesc')}</p>
            <div className="mt-5 grid gap-2 text-[13px]">
              <InfoRow label={t('settings.aboutVersion')} value={info?.version ?? '-'} />
              <InfoRow label={t('settings.aboutPlatform')} value={info?.platform ?? '-'} />
              <InfoRow label={t('settings.aboutConfigPath')} value={info?.configPath ?? '-'} mono />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border-weak bg-surface/90 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-medium text-text-strong">{t('settings.cliStatus.title')}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-text-weak">{t('settings.cliStatus.desc')}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={refreshStatuses} disabled={checking || !!installing}>
            <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
            {checking ? t('settings.cliStatus.checking') : t('settings.cliStatus.check')}
          </Button>
        </div>

        <div className="space-y-2">
          {CLIS.map((cli) => {
            const id = cli.id as CliId
            const status = statusById.get(id)
            const activeProgress = progress[id]
            const busy = installing === id
            return (
              <CliStatusRow
                key={id}
                cliId={id}
                name={cli.name}
                status={status}
                progress={activeProgress}
                busy={busy}
                checking={checking && !statuses}
                onInstall={status ? () => installUpdate(status) : undefined}
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}

function CliStatusRow({
  cliId,
  name,
  status,
  progress,
  busy,
  checking,
  onInstall
}: {
  cliId: CliId
  name: string
  status?: CliUpdateStatus
  progress?: InstallProgress
  busy: boolean
  checking: boolean
  onInstall?: () => void
}) {
  const t = useT()
  const installed = !!status?.installed
  const sourceLabel =
    status?.source === 'sandbox'
      ? t('settings.cliStatus.sourceSandbox')
      : status?.source === 'system'
        ? t('settings.cliStatus.sourceSystem')
        : t('settings.cliStatus.sourceUnknown')
  const stateLabel = !status
    ? checking
      ? t('settings.cliStatus.checking')
      : t('settings.cliStatus.unchecked')
    : status.error
      ? t('settings.cliStatus.checkFailed')
      : status.stale
        ? t('settings.cliStatus.stale')
        : status.updateAvailable
          ? t('settings.cliStatus.updateAvailable')
          : installed
          ? t('settings.cliStatus.installed')
          : t('settings.cliStatus.notInstalled')
  const versionText = !status
    ? '-'
    : status.currentVersion || (installed ? t('settings.cliStatus.versionUnknown') : '-')
  const latestText = status?.latestVersion ?? (status?.error ? t('settings.cliStatus.latestFailed') : '-')
  const detailText = progress && (busy || progress.phase === 'error')
    ? `${progress.message}${progress.fraction != null ? ` ${Math.round(progress.fraction * 100)}%` : ''}`
    : status?.error
      ? status.error
      : status?.binPath
        ? status.binPath
        : t('settings.cliStatus.noPath')
  const canInstall =
    !!status &&
    !!onInstall &&
    !busy &&
    (!status.installed || (status.updateAvailable && status.canInstallUpdate))
  const actionLabel = busy
    ? t('settings.cliStatus.updating')
    : !status?.installed
      ? t('settings.cliStatus.install')
      : cliId === 'hermes'
        ? t('settings.cliStatus.systemManaged')
      : status?.updateAvailable
        ? t('settings.cliStatus.update')
        : t('settings.cliStatus.current')

  return (
    <div className="grid gap-3 rounded-lg border border-border-weak bg-surface/90 px-3 py-3 md:grid-cols-[minmax(180px,1fr)_minmax(0,1.2fr)_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
          <CliIcon cliId={cliId} size={16} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-text-strong">{name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-weak">
            <StatusPill tone={status?.updateAvailable ? 'warning' : installed ? 'success' : 'muted'}>
              {stateLabel}
            </StatusPill>
            <span>{sourceLabel}</span>
          </div>
        </div>
      </div>

      <div className="min-w-0 text-[12px]">
        <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1">
          <span className="text-text-weak">{t('settings.cliStatus.currentVersion')}</span>
          <span className="truncate font-mono text-text-strong" title={versionText}>
            {versionText}
          </span>
          <span className="text-text-weak">{t('settings.cliStatus.latestVersion')}</span>
          <span className="truncate font-mono text-text-strong" title={latestText}>
            {latestText}
          </span>
        </div>
        <div
          className={`mt-1 truncate text-[11px] ${progress?.phase === 'error' || status?.error ? 'text-[var(--danger)]' : 'text-text-weak'}`}
          title={detailText}
        >
          {detailText}
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          variant={status?.updateAvailable || !status?.installed ? 'primary' : 'secondary'}
          disabled={!canInstall}
          onClick={onInstall}
          title={status?.source === 'system' ? t('settings.cliStatus.systemUpdateHint') : undefined}
        >
          {busy ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone: 'success' | 'warning' | 'muted' }) {
  const styles =
    tone === 'success'
      ? { background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: 'var(--success)' }
      : tone === 'warning'
        ? { background: 'color-mix(in srgb, var(--warning) 20%, transparent)', color: 'var(--text-strong)' }
        : { background: 'var(--surface-weak)', color: 'var(--text-weak)' }
  return (
    <span className="inline-flex h-5 items-center rounded-full px-2 text-[11px]" style={styles}>
      {children}
    </span>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <span className="text-text-weak">{label}</span>
      <span className={`min-w-0 truncate text-text-strong ${mono ? 'font-mono text-[12px]' : ''}`} title={value}>
        {value}
      </span>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] font-medium text-text-strong">{label}</span>
      {children}
    </div>
  )
}

function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-md border border-border-weak bg-surface-weak p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-[5px] px-3 py-1 text-[12px] transition-colors ${
            value === option.value
              ? 'bg-surface text-text-strong'
              : 'text-text-weak hover:text-text-strong'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
