import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Switch } from '@/components/ui/Switch'
import { CliIcon } from '@/components/CliIcon'
import { CLIS, YOLO_SUPPORT } from '@/data/clis'
import { useAppStore, type ThemeMode, type LocaleMode } from '@/store/app'
import { useT } from '@/i18n'
import type { AppConfig, CliId } from '@shared/types'

export function SettingsModal() {
  const t = useT()
  const open = useAppStore((s) => s.settingsOpen)
  const setOpen = useAppStore((s) => s.setSettingsOpen)
  const themeMode = useAppStore((s) => s.themeMode)
  const setThemeMode = useAppStore((s) => s.setThemeMode)
  const localeMode = useAppStore((s) => s.localeMode)
  const setLocaleMode = useAppStore((s) => s.setLocaleMode)
  const renderTranscript = useAppStore((s) => s.renderTranscript)
  const setRenderTranscript = useAppStore((s) => s.setRenderTranscript)
  const [cfg, setCfg] = useState<AppConfig | null>(null)

  useEffect(() => {
    if (open) window.api.config.get().then(setCfg)
  }, [open])

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
    <Modal open={open} onClose={() => setOpen(false)} title={t('settings.title')}>
      <section className="space-y-4">
        <Row label={t('settings.appearance')}>
          <Segmented options={themeOptions} value={themeMode} onChange={setThemeMode} />
        </Row>
        <Row label={t('settings.language')}>
          <Segmented options={localeOptions} value={localeMode} onChange={setLocaleMode} />
        </Row>
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
      </section>

      <section className="mt-6 border-t border-border-weak pt-5">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-medium text-text-strong">{t('settings.yolo.title')}</h3>
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            style={{ background: 'color-mix(in srgb, var(--warning) 22%, transparent)', color: 'var(--text-strong)' }}
          >
            <TriangleAlert size={11} /> {t('settings.yolo.danger')}
          </span>
        </div>
        <p className="mt-1.5 mb-3 text-[12px] leading-relaxed text-text-weak">
          {t('settings.yolo.desc')}
        </p>

        <div className="space-y-1.5">
          {CLIS.map((c) => {
            const sup = YOLO_SUPPORT[c.id]
            const on = !!cfg?.prefs[c.id as CliId]?.yolo
            return (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-border-weak bg-surface px-3 py-2.5"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
                  <CliIcon cliId={c.id as CliId} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-text-strong">{c.name}</div>
                  <div className="truncate font-mono text-[11px] text-text-weak">
                    {sup?.supported ? sup.note : t('settings.yolo.unsupported')}
                  </div>
                </div>
                {sup?.supported ? (
                  <Switch checked={on} onChange={(v) => toggleYolo(c.id as CliId, v)} />
                ) : (
                  <span className="text-[11px] text-text-weak">{t('settings.yolo.notSupported')}</span>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </Modal>
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
    <div className="flex rounded-lg border border-border-weak bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-[12px] transition-colors ${
            value === o.value
              ? 'bg-surface-weak text-text-strong'
              : 'text-text-weak hover:text-text-strong'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
