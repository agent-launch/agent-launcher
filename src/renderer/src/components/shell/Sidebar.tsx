import { useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, RotateCcw, Settings } from 'lucide-react'
import { useAppStore, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_COLLAPSED } from '@/store/app'
import { CLIS } from '@/data/clis'
import { CliIcon } from '@/components/CliIcon'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import type { AppConfig, CliId } from '@shared/types'

export function Sidebar({ cfg }: { cfg: AppConfig | null }) {
  const activeCli = useAppStore((s) => s.activeCli)
  const setActiveCli = useAppStore((s) => s.setActiveCli)
  const resetOnboarding = useAppStore((s) => s.resetOnboarding)
  const width = useAppStore((s) => s.sidebarWidth)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setWidth = useAppStore((s) => s.setSidebarWidth)
  const toggle = useAppStore((s) => s.toggleSidebar)
  const setCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const [dragging, setDragging] = useState(false)

  return (
    <aside
      className={`relative flex shrink-0 flex-col border-r border-border-weak bg-strong ${
        dragging ? '' : 'transition-[width] duration-150 ease-out'
      }`}
      style={{ width: collapsed ? SIDEBAR_COLLAPSED : width }}
    >
      <div className={`flex h-10 items-center ${collapsed ? 'justify-center' : 'justify-between px-3'}`}>
        {!collapsed && (
          <span className="text-[12px] font-medium uppercase tracking-wide text-text-weak">Agents</span>
        )}
        <button
          onClick={toggle}
          className="no-drag grid size-6 place-items-center rounded-md text-text-weak hover:bg-surface-weak hover:text-text-strong"
          title={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        {CLIS.map((c) => {
          const selected = c.id === activeCli
          const isInstalled = cfg?.install[c.id as CliId]?.installed
          return (
            <button
              key={c.id}
              onClick={() => setActiveCli(c.id)}
              className={`group relative flex items-center gap-3 rounded-md py-2 text-left text-[14px] transition-colors ${
                collapsed ? 'justify-center px-0' : 'px-2'
              } ${selected ? 'bg-surface-weak text-text-strong' : 'text-text-base hover:bg-surface-weak/60'}`}
            >
              {selected && (
                <span
                  className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full"
                  style={{ background: 'var(--accent)' }}
                />
              )}
              <span
                className="relative grid size-7 shrink-0 place-items-center rounded-md text-text-strong"
                style={{
                  background: selected
                    ? 'color-mix(in srgb, var(--accent) 20%, transparent)'
                    : 'var(--surface-weak)'
                }}
              >
                <CliIcon cliId={c.id as CliId} size={16} />
                {collapsed && (
                  <span
                    className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2"
                    style={{
                      background: isInstalled ? 'var(--success)' : 'var(--border-base)',
                      borderColor: 'var(--background-strong)'
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
                    title={isInstalled ? '已安装' : '未安装'}
                  />
                </>
              )}
              {collapsed && (
                <span className="pointer-events-none absolute left-full z-20 ml-2 whitespace-nowrap rounded-md border border-border-weak bg-stronger px-2 py-1 text-[12px] text-text-strong opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                  {c.name}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border-weak p-2">
        <button
          onClick={() => setSettingsOpen(true)}
          title={collapsed ? '设置' : undefined}
          className={`no-drag flex w-full items-center gap-2 rounded-md py-1.5 text-[12px] text-text-base hover:bg-surface-weak hover:text-text-strong ${
            collapsed ? 'justify-center px-0' : 'px-2'
          }`}
        >
          <Settings size={14} className="shrink-0" />
          {!collapsed && <span>设置</span>}
        </button>
        <button
          onClick={resetOnboarding}
          title={collapsed ? '重新运行引导' : undefined}
          className={`no-drag flex w-full items-center gap-2 rounded-md py-1.5 text-[12px] text-text-weak hover:bg-surface-weak hover:text-text-base ${
            collapsed ? 'justify-center px-0' : 'px-2'
          }`}
        >
          <RotateCcw size={13} className="shrink-0" />
          {!collapsed && <span>重新运行引导</span>}
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
