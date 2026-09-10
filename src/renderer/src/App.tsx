import { useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { Download, ExternalLink, RefreshCw, RotateCcw } from 'lucide-react'
import { Titlebar } from '@/components/Titlebar'
import { Onboarding } from '@/components/onboarding/Onboarding'
import { Shell } from '@/components/shell/Shell'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store/app'
import { useTheme } from '@/theme'
import { resolveLocale, useT } from '@/i18n'
import type { AppInfo, AppUpdateStatus } from '@shared/types'

export default function App() {
  const onboarded = useAppStore((s) => s.onboarded)
  const resetOnboarding = useAppStore((s) => s.resetOnboarding)
  const localeMode = useAppStore((s) => s.localeMode)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  useTheme()

  useEffect(() => {
    window.api.app.setMenuLocale?.(resolveLocale(localeMode))
  }, [localeMode])

  useEffect(() => {
    let alive = true
    window.api.app.info().then((next) => {
      if (!alive) return
      if (!next.hasConfig) resetOnboarding()
      setInfo(next)
    })
    return () => {
      alive = false
    }
  }, [resetOnboarding])

  useEffect(() => {
    let alive = true
    window.api.appUpdate.getStatus().then((status) => {
      if (alive) setUpdateStatus(status)
    })
    const offStatus = window.api.appUpdate.onStatus(setUpdateStatus)
    return () => {
      alive = false
      offStatus()
    }
  }, [])

  const showOnboarding = info ? !onboarded : false
  const forceUpdate = !!updateStatus?.policy?.force

  return (
    <div className="relative flex h-full flex-col bg-base">
      <Titlebar showSidebarToggle={!showOnboarding} />
      <div className="min-h-0 flex-1">
        {showOnboarding ? <Onboarding /> : info ? <Shell /> : null}
      </div>
      {forceUpdate && updateStatus ? <ForceUpdateOverlay status={updateStatus} /> : null}
      <Toaster
        position="bottom-right"
        containerStyle={{ bottom: 18, right: 18 }}
        toastOptions={{
          duration: 2800,
          style: {
            maxWidth: 360,
            border: '1px solid var(--border-weak)',
            borderRadius: '8px',
            background: 'var(--background-stronger)',
            boxShadow: 'var(--shadow-md)',
            color: 'var(--text-strong)',
            fontSize: '13px',
            lineHeight: '1.45',
            padding: '10px 12px'
          },
          success: {
            iconTheme: {
              primary: 'var(--success)',
              secondary: 'var(--text-on-accent)'
            }
          },
          error: {
            iconTheme: {
              primary: 'var(--danger)',
              secondary: 'var(--text-on-accent)'
            }
          }
        }}
      />
    </div>
  )
}

function ForceUpdateOverlay({ status }: { status: AppUpdateStatus }) {
  const t = useT()
  const busy = status.status === 'checking' || status.status === 'downloading'
  const downloaded = status.status === 'downloaded'
  const canAutoUpdate = status.supported && !!status.canAutoDownload
  const latestVersion = status.latestRelease?.version ?? status.policy?.latestVersion ?? '-'
  const percent = Math.max(0, Math.min(100, Math.round(status.percent ?? 0)))

  const primaryAction = async () => {
    if (downloaded) {
      await window.api.appUpdate.install()
      return
    }
    if (canAutoUpdate) {
      await window.api.appUpdate.download()
      return
    }
    await window.api.appUpdate.openReleasePage(latestVersion)
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-base/92 p-6 backdrop-blur-xl">
      <section className="w-full max-w-[520px] rounded-xl border border-border-base bg-stronger/95 p-5 shadow-[var(--shadow-md)]">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-weak text-text-strong">
            {downloaded ? (
              <RotateCcw size={18} />
            ) : busy ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <Download size={18} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[18px] font-semibold text-text-strong">
              {t('update.force.title')}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-weak">
              {status.policy?.message || t('update.force.desc')}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 rounded-lg border border-border-weak bg-surface/72 px-3 py-3 text-[12px]">
          <InfoLine label={t('update.currentVersion')} value={status.currentVersion} />
          <InfoLine label={t('update.latestVersion')} value={latestVersion} />
          {status.policy?.minVersion ? (
            <InfoLine label={t('update.minVersion')} value={status.policy.minVersion} />
          ) : null}
        </div>

        {status.status === 'downloading' ? (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[12px] text-text-weak">
              <span>{t('update.downloading')}</span>
              <span>{percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-weak">
              <div
                className="h-full rounded-full bg-text-strong transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {status.error ? (
          <p className="mt-3 rounded-lg border border-dashed px-3 py-2 text-[12px] text-[var(--danger)]">
            {status.error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => window.api.appUpdate.openReleasePage(latestVersion)}
          >
            <ExternalLink size={14} />
            {t('update.openRelease')}
          </Button>
          <Button onClick={primaryAction} disabled={busy}>
            {busy ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : downloaded ? (
              <RotateCcw size={14} />
            ) : (
              <Download size={14} />
            )}
            {downloaded
              ? t('update.restartNow')
              : canAutoUpdate
                ? t('update.download')
                : t('update.downloadManually')}
          </Button>
        </div>
      </section>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3">
      <span className="text-text-weak">{label}</span>
      <span className="min-w-0 truncate font-mono text-text-strong" title={value}>
        {value}
      </span>
    </div>
  )
}
