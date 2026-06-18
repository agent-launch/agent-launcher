import { useEffect, useState } from 'react'
import { Info, Settings2, TriangleAlert } from 'lucide-react'
import { Switch } from '@/components/ui/Switch'
import { CliIcon } from '@/components/CliIcon'
import { CLIS, YOLO_SUPPORT } from '@/data/clis'
import { useAppStore, type ThemeMode, type LocaleMode } from '@/store/app'
import { useT } from '@/i18n'
import { ENABLE_CHAT_HISTORY_RENDERING } from '@/features'
import type { AppConfig, AppInfo, CliId } from '@shared/types'

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

  useEffect(() => {
    window.api.app.info().then(setInfo)
  }, [])

  return (
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
