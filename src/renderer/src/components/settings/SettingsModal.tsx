import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Switch } from '@/components/ui/Switch'
import { CliIcon } from '@/components/CliIcon'
import { CLIS, YOLO_SUPPORT } from '@/data/clis'
import { useAppStore } from '@/store/app'
import type { AppConfig, CliId } from '@shared/types'

export function SettingsModal() {
  const open = useAppStore((s) => s.settingsOpen)
  const setOpen = useAppStore((s) => s.setSettingsOpen)
  const [cfg, setCfg] = useState<AppConfig | null>(null)

  useEffect(() => {
    if (open) window.api.config.get().then(setCfg)
  }, [open])

  const toggleYolo = async (id: CliId, on: boolean) => {
    const next = await window.api.config.setYolo(id, on)
    setCfg(next)
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="设置">
      <section>
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-medium text-text-strong">YOLO 模式</h3>
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            style={{ background: 'color-mix(in srgb, var(--warning) 22%, transparent)', color: 'var(--text-strong)' }}
          >
            <TriangleAlert size={11} /> 危险
          </span>
        </div>
        <p className="mt-1.5 mb-3 text-[12px] leading-relaxed text-text-weak">
          开启后，对应 CLI 会自动批准所有操作（执行命令、改文件等），不再逐次确认。省事但有风险，只在你信任当前项目时开启。每个 CLI 独立设置。
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
                  <div className="truncate font-mono text-[11px] text-text-weak">{sup?.note}</div>
                </div>
                {sup?.supported ? (
                  <Switch checked={on} onChange={(v) => toggleYolo(c.id as CliId, v)} />
                ) : (
                  <span className="text-[11px] text-text-weak">不支持</span>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </Modal>
  )
}
