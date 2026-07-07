import { ArrowLeft } from 'lucide-react'
import { useT } from '@/i18n'
import { SETTINGS_TABS, type SettingsTab } from './settingsTabs'

const SETTINGS_SIDEBAR_WIDTH = 180

export function SettingsSidebar({
  activeTab,
  onSelectTab,
  onBack
}: {
  activeTab: SettingsTab
  onSelectTab: (tab: SettingsTab) => void
  onBack: () => void
}) {
  const t = useT()
  const isMac = window.api?.platform === 'darwin'

  return (
    <aside
      className="relative flex shrink-0 flex-col overflow-hidden bg-base"
      style={{ width: SETTINGS_SIDEBAR_WIDTH }}
    >
      {isMac && (
        <div className="relative h-10 shrink-0" aria-hidden="true">
          <div className="drag-region absolute inset-y-0 left-[106px] right-0" />
        </div>
      )}

      <div className={`${isMac ? '' : 'pt-2'} px-2`}>
        <button
          type="button"
          onClick={onBack}
          className="no-drag flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-text-weak transition-colors hover:bg-[var(--sidebar-selection)] hover:text-text-strong"
        >
          <ArrowLeft size={14} />
          <span>{t('settings.backToWorkspace')}</span>
        </button>
      </div>

      <nav className="mt-2 flex flex-col gap-0.5 px-2" aria-label={t('settings.title')}>
        {SETTINGS_TABS.map((item) => {
          const selected = activeTab === item.id
          const Icon = item.icon

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`no-drag flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium transition-[background,color,box-shadow] ${
                selected
                  ? 'bg-[var(--sidebar-selection)] text-text-strong shadow-[var(--shadow-sm)]'
                  : 'text-text-weak hover:bg-[var(--sidebar-selection)] hover:text-text-strong'
              }`}
            >
              <span className="grid size-5 shrink-0 place-items-center text-current">
                <Icon size={14} />
              </span>
              <span className="min-w-0 truncate">{t(item.labelKey)}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
