import { useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { Titlebar } from '@/components/Titlebar'
import { Onboarding } from '@/components/onboarding/Onboarding'
import { Shell } from '@/components/shell/Shell'
import { useAppStore } from '@/store/app'
import { useTheme } from '@/theme'
import { resolveLocale } from '@/i18n'
import type { AppInfo } from '@shared/types'

export default function App() {
  const onboarded = useAppStore((s) => s.onboarded)
  const resetOnboarding = useAppStore((s) => s.resetOnboarding)
  const localeMode = useAppStore((s) => s.localeMode)
  const [info, setInfo] = useState<AppInfo | null>(null)
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

  const showOnboarding = info ? !onboarded : false

  return (
    <div className="relative flex h-full flex-col bg-base">
      <Titlebar showSidebarToggle={!showOnboarding} />
      <div className="min-h-0 flex-1">{showOnboarding ? <Onboarding /> : info ? <Shell /> : null}</div>
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
