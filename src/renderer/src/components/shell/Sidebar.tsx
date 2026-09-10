import { useState } from 'react'
import { RotateCcw, Settings } from 'lucide-react'
import { useAppStore, SIDEBAR_MIN, SIDEBAR_MAX } from '@/store/app'
import { CLIS } from '@/data/clis'
import { CliIcon } from '@/components/CliIcon'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { useT } from '@/i18n'
import type { AppConfig, CliId } from '@shared/types'

export function Sidebar({
  cfg,
  view,
  onSelectCli,
  onOpenSettings
}: {
  cfg: AppConfig | null
  view: 'run' | 'config' | 'settings'
  onSelectCli: () => void
  onOpenSettings: () => void
}) {
  const t = useT()
  const activeCli = useAppStore((s) => s.activeCli)
  const setActiveCli = useAppStore((s) => s.setActiveCli)
  const resetOnboarding = useAppStore((s) => s.resetOnboarding)
  const width = Math.min(
    useAppStore((s) => s.sidebarWidth),
    SIDEBAR_MAX
  )
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setWidth = useAppStore((s) => s.setSidebarWidth)
  const setCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  const [dragging, setDragging] = useState(false)
  const isMac = window.api?.platform === 'darwin'
  const sidebarWidth = collapsed ? 0 : width

  return (
    <aside
      className={`relative z-20 flex shrink-0 flex-col overflow-visible ${
        dragging ? '' : 'transition-[width] duration-180 ease-out'
      }`}
      style={{
        width: sidebarWidth,
        background: 'var(--background-base)'
      }}
    >
      <div
        className="flex h-full flex-col overflow-hidden"
        aria-hidden={collapsed}
        style={{
          width,
          minWidth: width,
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : undefined,
          transition: dragging ? undefined : 'opacity 180ms ease-out'
        }}
      >
        {isMac && (
          <div className="relative h-10 shrink-0" aria-hidden="true">
            <div className="drag-region absolute inset-y-0 left-[106px] right-0" />
          </div>
        )}
        <nav className="flex flex-1 flex-col gap-0.5 px-2 pt-2">
          {CLIS.map((c) => {
            const selected = view !== 'settings' && c.id === activeCli
            const isInstalled = cfg?.install[c.id as CliId]?.installed
            return (
              <button
                key={c.id}
                tabIndex={collapsed ? -1 : 0}
                onClick={() => {
                  setActiveCli(c.id)
                  onSelectCli()
                }}
                className={`group relative flex min-w-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-[12px] transition-[background,box-shadow,color] ${
                  selected
                    ? 'font-semibold shadow-[var(--shadow-sm)]'
                    : 'hover:bg-[var(--sidebar-selection)]'
                }`}
                style={{
                  background: selected ? 'var(--sidebar-selection)' : undefined,
                  color: selected ? 'var(--text-strong)' : 'var(--sidebar-text)'
                }}
              >
                <span
                  className="relative grid size-6 shrink-0 place-items-center rounded-md"
                  style={{
                    color: selected ? 'var(--text-strong)' : 'var(--sidebar-icon)',
                    opacity: selected ? 0.9 : 0.7
                  }}
                >
                  <CliIcon cliId={c.id as CliId} size={14} />
                </span>
                <span className="min-w-0 flex-1 truncate whitespace-nowrap">{c.name}</span>
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: isInstalled ? 'var(--success)' : 'var(--border-base)' }}
                  title={isInstalled ? t('sidebar.installed') : t('sidebar.notInstalled')}
                />
              </button>
            )
          })}
        </nav>

        <div className="flex flex-col gap-0.5 border-t border-border-weak/80 p-2">
          <button
            onClick={onOpenSettings}
            tabIndex={collapsed ? -1 : 0}
            className="no-drag flex w-full min-w-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-[12px] transition-[background,box-shadow,color] hover:bg-[var(--sidebar-selection)]"
            style={{
              background: view === 'settings' ? 'var(--sidebar-selection)' : undefined,
              color: view === 'settings' ? 'var(--text-strong)' : 'var(--sidebar-text)'
            }}
          >
            <Settings size={13} className="shrink-0" />
            <span className="min-w-0 truncate whitespace-nowrap">{t('sidebar.settings')}</span>
          </button>
          <button
            onClick={resetOnboarding}
            tabIndex={collapsed ? -1 : 0}
            className="no-drag flex w-full min-w-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-[12px] transition-colors hover:bg-[var(--sidebar-selection)]"
            style={{ color: 'var(--sidebar-text-weak)' }}
          >
            <RotateCcw size={12} className="shrink-0" />
            <span className="min-w-0 truncate whitespace-nowrap">
              {t('sidebar.rerunOnboarding')}
            </span>
          </button>
        </div>

        {!collapsed && (
          <ResizeHandle
            size={width}
            min={SIDEBAR_MIN}
            max={SIDEBAR_MAX}
            onResize={setWidth}
            onCollapse={() => setCollapsed(true)}
            collapseThreshold={SIDEBAR_MIN - 20}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => setDragging(false)}
          />
        )}
      </div>
    </aside>
  )
}
