import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  Copy,
  Edit3,
  Maximize2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Scissors,
  Settings2,
  TextCursorInput,
  Undo2,
  X
} from 'lucide-react'
import { useAppStore } from '@/store/app'
import { useT } from '@/i18n'

type MenuId = 'file' | 'edit' | 'view' | 'window' | 'help'

interface MenuItem {
  label: string
  icon?: ReactNode
  checked?: boolean
  action: () => void
}

interface MenuGroup {
  title?: string
  items: MenuItem[]
}

export function Titlebar({ showSidebarToggle = true }: { showSidebarToggle?: boolean }) {
  const t = useT()
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [menuLeft, setMenuLeft] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const isMac = window.api?.platform === 'darwin'

  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setOpenMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  const appMenu = useMemo(
    () => [
      { id: 'file' as const, label: t('menu.file') },
      { id: 'edit' as const, label: t('menu.edit') },
      { id: 'view' as const, label: t('menu.view') },
      { id: 'window' as const, label: t('menu.window') },
      { id: 'help' as const, label: t('menu.help') }
    ],
    [t]
  )

  const menuGroups = useMemo<Record<MenuId, MenuGroup[]>>(
    () => ({
      file: [
        {
          title: t('menu.file'),
          items: [
            {
              label: t('menu.closeWindow'),
              icon: <X size={15} />,
              action: () => window.api.window.close()
            }
          ]
        }
      ],
      edit: [
        {
          title: t('menu.edit'),
          items: [
            { label: t('menu.undo'), icon: <Undo2 size={15} />, action: () => document.execCommand('undo') },
            { label: t('menu.redo'), icon: <Undo2 size={15} className="scale-x-[-1]" />, action: () => document.execCommand('redo') }
          ]
        },
        {
          items: [
            { label: t('menu.cut'), icon: <Scissors size={15} />, action: () => document.execCommand('cut') },
            { label: t('menu.copy'), icon: <Copy size={15} />, action: () => document.execCommand('copy') },
            { label: t('menu.paste'), icon: <TextCursorInput size={15} />, action: () => document.execCommand('paste') }
          ]
        },
        {
          items: [
            { label: t('menu.selectAll'), icon: <Edit3 size={15} />, action: () => document.execCommand('selectAll') }
          ]
        }
      ],
      view: [
        {
          title: t('menu.view'),
          items: [
            { label: t('menu.reload'), icon: <RefreshCw size={15} />, action: () => window.location.reload() },
            {
              label: t('menu.fullscreen'),
              icon: <Maximize2 size={15} />,
              action: () => window.api.window.toggleFullscreen?.()
            }
          ]
        }
      ],
      window: [
        {
          title: t('menu.window'),
          items: [
            {
              label: t('menu.minimize'),
              icon: <Minus size={15} />,
              action: () => window.api.window.minimize()
            },
            {
              label: t('menu.zoom'),
              icon: <Maximize2 size={15} />,
              action: () => window.api.window.toggleMaximize()
            }
          ]
        }
      ],
      help: [
        {
          title: t('menu.help'),
          items: [
            {
              label: t('menu.checkUpdates'),
              icon: <RefreshCw size={15} />,
              action: () => window.api.app.checkUpdates?.()
            },
            {
              label: t('menu.about'),
              icon: <Settings2 size={15} />,
              checked: true,
              action: () => window.api.app.openAbout?.()
            }
          ]
        }
      ]
    }),
    [t]
  )

  const runMenuAction = (item: MenuItem) => {
    item.action()
    setOpenMenu(null)
  }

  if (isMac) {
    return null
  }

  return (
    <div
      className="drag-region relative z-[100] flex h-10 shrink-0 items-center bg-base/78 backdrop-blur-xl"
      style={{
        paddingLeft: '8px',
        paddingRight: '140px'
      }}
    >
      {openMenu && (
        <div
          aria-hidden="true"
          className="no-drag fixed inset-0 z-[110] cursor-default"
          onPointerDown={() => setOpenMenu(null)}
        />
      )}

      <div ref={menuRef} className="no-drag relative z-[120] flex h-full items-center gap-1">
        {showSidebarToggle && (
          <button
            onClick={toggleSidebar}
            className="no-drag grid size-7 -translate-y-px place-items-center rounded-md text-text-weak transition-colors hover:bg-surface-hover hover:text-text-strong"
            title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
            aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}

        {!isMac && (
          <div className={`${showSidebarToggle ? 'ml-1' : ''} flex h-full items-center gap-0.5`}>
            {appMenu.map((menu) => (
              <button
                key={menu.id}
                onClick={(event) => {
                  const parentLeft = menuRef.current?.getBoundingClientRect().left ?? 0
                  setMenuLeft(event.currentTarget.getBoundingClientRect().left - parentLeft)
                  setOpenMenu(openMenu === menu.id ? null : menu.id)
                }}
                className={`no-drag rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors ${
                  openMenu === menu.id
                    ? 'bg-surface text-text-strong shadow-[var(--shadow-sm)]'
                    : 'text-text-weak hover:bg-surface-hover hover:text-text-strong'
                }`}
              >
                {menu.label}
              </button>
            ))}
          </div>
        )}

        {!isMac && openMenu && (
          <div
            className="absolute top-10 z-[130] w-[272px] overflow-hidden rounded-lg border border-border-base bg-stronger p-1 text-[14px] text-text-strong shadow-[0_8px_22px_rgba(0,0,0,0.14),0_1px_3px_rgba(0,0,0,0.08)]"
            style={{ left: menuLeft }}
          >
            {menuGroups[openMenu].map((group, groupIndex) => (
              <div key={`${openMenu}-${groupIndex}`} className={groupIndex > 0 ? 'mt-1 border-t border-border-weak pt-1' : ''}>
                {group.title && (
                  <div className="px-2.5 pb-1 pt-1 text-[12px] font-medium text-text-muted">
                    {group.title}
                  </div>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <button
                      key={item.label}
                      onClick={() => runMenuAction(item)}
                      className="no-drag flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[14px] text-text-strong transition-colors hover:bg-surface-hover"
                    >
                      <span className="grid size-5 shrink-0 place-items-center text-text-muted">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.checked && <Check size={15} className="shrink-0 text-text-muted" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
