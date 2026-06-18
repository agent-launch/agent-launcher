import { useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, RotateCcw, Settings } from 'lucide-react'
import { useAppStore, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_COLLAPSED } from '@/store/app'
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
  const toggle = useAppStore((s) => s.toggleSidebar)
  const setCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  const [dragging, setDragging] = useState(false)

  return (
    <aside
      className={`relative flex shrink-0 flex-col border-r border-border-weak/80 ${
        dragging ? '' : 'transition-[width] duration-150 ease-out'
      }`}
      style={{ width: collapsed ? SIDEBAR_COLLAPSED : width, background: 'var(--sidebar-background)' }}
    >
      <div className={`flex h-11 items-center ${collapsed ? 'justify-center' : 'justify-between px-3'}`}>
        {!collapsed && (
          <span className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--sidebar-text-weak)' }}>
            {t('sidebar.agents')}
          </span>
        )}
        <button
          onClick={toggle}
          className="no-drag grid size-7 place-items-center rounded-md transition-colors hover:bg-[var(--sidebar-selection)]"
          style={{ color: 'var(--sidebar-text-weak)' }}
          title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2">
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
              className={`group relative flex items-center gap-2.5 rounded-md py-2 text-left text-[13px] transition-colors ${
                collapsed ? 'justify-center px-0' : 'px-2'
              } ${
                selected
                  ? 'font-medium'
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

      <div className="flex flex-col gap-0.5 border-t border-border-weak/80 p-2">
        <button
          onClick={onOpenSettings}
          title={collapsed ? t('sidebar.settings') : undefined}
          className={`no-drag flex w-full items-center gap-2 rounded-md py-2 text-[13px] transition-colors hover:bg-[var(--sidebar-selection)] ${
            collapsed ? 'justify-center px-0' : 'px-2'
          }`}
          style={{
            background: view === 'settings' ? 'var(--sidebar-selection)' : undefined,
            color: view === 'settings' ? 'var(--text-strong)' : 'var(--sidebar-text)'
          }}
        >
          <Settings size={14} className="shrink-0" />
          {!collapsed && <span>{t('sidebar.settings')}</span>}
        </button>
        <button
          onClick={resetOnboarding}
          title={collapsed ? t('sidebar.rerunOnboarding') : undefined}
          className={`no-drag flex w-full items-center gap-2 rounded-md py-2 text-[13px] transition-colors hover:bg-[var(--sidebar-selection)] ${
            collapsed ? 'justify-center px-0' : 'px-2'
          }`}
          style={{ color: 'var(--sidebar-text-weak)' }}
        >
          <RotateCcw size={13} className="shrink-0" />
          {!collapsed && <span>{t('sidebar.rerunOnboarding')}</span>}
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
    </aside>
  )
}
