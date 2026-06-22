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
  const width = useAppStore((s) => s.sidebarWidth)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setWidth = useAppStore((s) => s.setSidebarWidth)
  const setCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  const [dragging, setDragging] = useState(false)
  const isMac = window.api?.platform === 'darwin'
  const sidebarWidth = collapsed ? 0 : width
  const contentWidth = collapsed ? width : sidebarWidth

  return (
    <aside
      className={`relative flex shrink-0 flex-col overflow-hidden border-r border-border-weak/80 backdrop-blur-xl ${
        dragging ? '' : 'transition-[width,border-color] duration-180 ease-out'
      }`}
      style={{
        width: sidebarWidth,
        borderRightColor: collapsed ? 'transparent' : undefined,
        background: 'var(--sidebar-gradient)'
      }}
    >
      <div
        className="flex h-full flex-col"
        style={{
          width: contentWidth,
          minWidth: contentWidth,
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : undefined,
          transition: dragging ? undefined : 'opacity 120ms ease-out'
        }}
      >
        {isMac && <div className="h-10 shrink-0" />}
        <nav className={`flex flex-1 flex-col gap-1 px-2.5 ${isMac ? 'pt-3' : 'pt-2.5'}`}>
          {CLIS.map((c) => {
            const selected = view !== 'settings' && c.id === activeCli
            const isInstalled = cfg?.install[c.id as CliId]?.installed
            return (
              <button
                key={c.id}
                onClick={() => {
                  setActiveCli(c.id)
                  onSelectCli()
                }}
                className={`group relative flex items-center gap-2.5 rounded-md py-2 text-left text-[13px] transition-[background,box-shadow,color] ${
                  collapsed ? 'justify-center px-0' : 'px-2.5'
                } ${
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
                  className="relative grid size-7 shrink-0 place-items-center rounded-md"
                  style={{
                    color: selected ? 'var(--text-strong)' : 'var(--sidebar-icon)',
                    opacity: selected ? 0.9 : 0.7
                  }}
                >
                  <CliIcon cliId={c.id as CliId} size={16} />
                  {collapsed && (
                    <span
                      className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2"
                      style={{
                        background: isInstalled ? 'var(--success)' : 'var(--border-base)',
                        borderColor: 'var(--sidebar-background)'
                      }}
                    />
                  )}
                </span>
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: isInstalled ? 'var(--success)' : 'var(--border-base)' }}
                      title={isInstalled ? t('sidebar.installed') : t('sidebar.notInstalled')}
                    />
                  </>
                )}
                {collapsed && (
                  <span className="pointer-events-none absolute left-full z-20 ml-2 whitespace-nowrap rounded-md border border-border-weak bg-stronger px-2 py-1 text-[12px] text-text-strong opacity-0 shadow-[var(--shadow-md)] transition-opacity group-hover:opacity-100">
                    {c.name}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="flex flex-col gap-1 border-t border-border-weak/80 p-2.5">
          <button
            onClick={onOpenSettings}
            title={collapsed ? t('sidebar.settings') : undefined}
            className={`no-drag flex w-full min-w-0 items-center gap-2 rounded-md py-2 text-[13px] transition-[background,box-shadow,color] hover:bg-[var(--sidebar-selection)] ${
              collapsed ? 'justify-center px-0' : 'px-2.5'
            }`}
            style={{
              background: view === 'settings' ? 'var(--sidebar-selection)' : undefined,
              color: view === 'settings' ? 'var(--text-strong)' : 'var(--sidebar-text)'
            }}
          >
            <Settings size={14} className="shrink-0" />
            {!collapsed && <span className="min-w-0 truncate whitespace-nowrap">{t('sidebar.settings')}</span>}
          </button>
          <button
            onClick={resetOnboarding}
            title={collapsed ? t('sidebar.rerunOnboarding') : undefined}
            className={`no-drag flex w-full min-w-0 items-center gap-2 rounded-md py-2 text-[13px] transition-colors hover:bg-[var(--sidebar-selection)] ${
              collapsed ? 'justify-center px-0' : 'px-2.5'
            }`}
            style={{ color: 'var(--sidebar-text-weak)' }}
          >
            <RotateCcw size={13} className="shrink-0" />
            {!collapsed && <span className="min-w-0 truncate whitespace-nowrap">{t('sidebar.rerunOnboarding')}</span>}
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
