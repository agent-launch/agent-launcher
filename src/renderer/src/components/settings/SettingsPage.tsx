import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  TriangleAlert
} from 'lucide-react'
import { Switch } from '@/components/ui/Switch'
import { CliIcon } from '@/components/CliIcon'
import { CLIS, YOLO_SUPPORT } from '@/data/clis'
import { useAppStore, type ThemeMode, type LocaleMode } from '@/store/app'
import { useT } from '@/i18n'
import { ENABLE_CHAT_HISTORY_RENDERING } from '@/features'
import { Button } from '@/components/ui/Button'
import { SETTINGS_TABS, type SettingsTab } from './settingsTabs'
import type { AppConfig, AppInfo, AppUpdateStatus, CliId, CliUpdateStatus, InstallProgress, UsageDailyBucket, UsageScanResult } from '@shared/types'

type UsageTooltipState = {
  content: string
  x: number
  y: number
  placement: 'top' | 'bottom'
  align: 'start' | 'center' | 'end'
}
const HEATMAP_LABEL_WIDTH = 30
const HEATMAP_MONTH_HEIGHT = 16
const HEATMAP_CELL_SIZE = 10
const HEATMAP_CELL_GAP = 3
const HEATMAP_ROWS = 7
const SELECT_MENU_ANIMATION_MS = 120
let usageCache: UsageScanResult | null = null

export const SettingsPage = memo(function SettingsPage({
  tab = 'general',
  checkUpdatesKey = 0
}: {
  tab?: SettingsTab
  checkUpdatesKey?: number
}) {
  const t = useT()
  const isMac = window.api?.platform === 'darwin'

  const activeTab = SETTINGS_TABS.find((item) => item.id === tab) ?? SETTINGS_TABS[0]

  return (
    <div className="relative h-full bg-stronger">
      {isMac && <div className="drag-region absolute inset-x-0 top-0 h-12" aria-hidden="true" />}

      <div className="relative h-full overflow-y-auto">
        <div className={`mx-auto flex w-full max-w-[980px] flex-col gap-4 px-8 ${isMac ? 'pb-7 pt-14' : 'py-7'}`}>
          <h2 className="font-display text-[34px] font-bold leading-tight text-text-strong">{t(activeTab.labelKey)}</h2>

          {tab === 'general' ? <GeneralSettings /> : tab === 'usage' ? <UsageSettings /> : <AboutSettings checkUpdatesKey={checkUpdatesKey} />}
        </div>
      </div>
    </div>
  )
})

function GeneralSettings() {
  const t = useT()
  const themeMode = useAppStore((s) => s.themeMode)
  const setThemeMode = useAppStore((s) => s.setThemeMode)
  const localeMode = useAppStore((s) => s.localeMode)
  const setLocaleMode = useAppStore((s) => s.setLocaleMode)
  const renderTranscript = useAppStore((s) => s.renderTranscript)
  const setRenderTranscript = useAppStore((s) => s.setRenderTranscript)
  const [cfg, setCfg] = useState<AppConfig | null>(null)

  useEffect(() => {
    window.api.config.get().then(setCfg)
  }, [])

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
    <div className="space-y-5">
      <section className="overflow-visible rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)]">
        <div className="divide-y divide-border-weak">
          <SettingControlRow title={t('settings.appearance')} desc={t('settings.appearanceDesc')}>
            <SettingsSelect options={themeOptions} value={themeMode} onChange={setThemeMode} />
          </SettingControlRow>
          <SettingControlRow title={t('settings.language')} desc={t('settings.languageDesc')}>
            <SettingsSelect options={localeOptions} value={localeMode} onChange={setLocaleMode} />
          </SettingControlRow>
          {ENABLE_CHAT_HISTORY_RENDERING && (
            <SettingControlRow title={t('settings.renderTranscript')} desc={t('settings.renderTranscriptDesc')}>
              <Switch checked={renderTranscript} onChange={setRenderTranscript} />
            </SettingControlRow>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-medium text-text-strong">{t('settings.yolo.title')}</h3>
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            style={{ background: 'color-mix(in srgb, var(--warning) 22%, transparent)', color: 'var(--text-strong)' }}
          >
            <TriangleAlert size={11} /> {t('settings.yolo.danger')}
          </span>
        </div>
        <p className="mt-1.5 mb-3 text-[12px] leading-relaxed text-text-weak">{t('settings.yolo.desc')}</p>

        <div className="space-y-1.5">
          {CLIS.map((cli) => {
            const support = YOLO_SUPPORT[cli.id]
            const enabled = !!cfg?.prefs[cli.id as CliId]?.yolo
            return (
              <div
                key={cli.id}
                className="flex items-center gap-3 rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] px-3 py-2.5"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
                  <CliIcon cliId={cli.id as CliId} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-text-strong">{cli.name}</div>
                  <div className="truncate font-mono text-[11px] text-text-weak">
                    {support?.supported ? support.note : t('settings.yolo.unsupported')}
                  </div>
                </div>
                {support?.supported ? (
                  <Switch checked={enabled} onChange={(value) => toggleYolo(cli.id as CliId, value)} />
                ) : (
                  <span className="text-[11px] text-text-weak">{t('settings.yolo.notSupported')}</span>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function UsageSettings() {
  const t = useT()
  const [usage, setUsage] = useState<UsageScanResult | null>(() => usageCache)
  const [loading, setLoading] = useState(() => !usageCache)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<UsageTooltipState | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const load = (force = false): (() => void) => {
    if (!force && usageCache) {
      setUsage(usageCache)
      setLoading(false)
      setError(null)
      return () => {}
    }

    cancelRef.current?.()
    const requestId = `usage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    let active = true
    setLoading(true)
    setError(null)
    void window.api.usage.read(requestId, 365, 30)
      .then((nextUsage) => {
        if (active && nextUsage) {
          usageCache = nextUsage
          setUsage(nextUsage)
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      void window.api.usage.cancel(requestId)
    }
  }

  useEffect(() => {
    cancelRef.current = load(false)
    return () => {
      cancelRef.current?.()
      cancelRef.current = null
    }
  }, [])

  const summary = useMemo(() => {
    if (!usage) return null
    const topModels = usage.byModel.slice(0, 5)
    const summaryDays = usage.daily.slice(-usage.summaryDays)
    return {
      topModels,
      maxModelTokens: Math.max(1, ...topModels.map((item) => item.tokens.totalTokens)),
      summaryDays,
      today: usage.daily[usage.daily.length - 1],
      activeDays: summaryDays.filter((day) => day.tokens.totalTokens > 0).length,
      bestStreak: longestStreak(summaryDays),
      yearTokens: usage.daily.reduce((sum, day) => sum + day.tokens.totalTokens, 0)
    }
  }, [usage])

  if (loading && !usage) {
    return (
      <section className="rounded-xl border border-border-weak bg-surface/92 p-5 shadow-[var(--shadow-sm)]">
        <div className="text-[13px] text-text-weak">{t('settings.usage.loading')}</div>
      </section>
    )
  }

  if (error && !usage) {
    return (
      <section className="rounded-xl border border-border-weak bg-surface/92 p-5 shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] text-[var(--danger)]">{t('settings.usage.failed', { error })}</div>
          <Button size="sm" variant="secondary" onClick={() => { cancelRef.current = load(true) }}>
            <RefreshCw size={13} />
            {t('settings.usage.refresh')}
          </Button>
        </div>
      </section>
    )
  }

  if (!usage) return null
  if (!summary) return null

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border-weak bg-surface/92 p-5 shadow-[var(--shadow-sm)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-medium text-text-strong">{t('settings.usage.title')}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-text-weak">{t('settings.usage.desc')}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => { cancelRef.current = load(true) }} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {t('settings.usage.refresh')}
          </Button>
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <MetricCard value={formatCompact(usage.tokens.totalTokens)} label={t('settings.usage.tokens30')} />
          <MetricCard value={String(usage.requestCount)} label={t('settings.usage.requests30')} />
          <MetricCard value={`${summary.activeDays} / ${summary.bestStreak}`} label={t('settings.usage.activeDays')} />
          <MetricCard value={formatCompact(summary.today?.tokens.totalTokens ?? 0)} label={t('settings.usage.tokensToday')} />
        </div>

        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-[13px] font-medium text-text-strong">{t('settings.usage.activity')}</h4>
            <span className="text-[12px] text-text-weak">
              {t('settings.usage.lastYear', {
                count: formatCompact(summary.yearTokens)
              })}
            </span>
          </div>
          <ActivityHeatmap days={usage.daily} setTooltip={setTooltip} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-[13px] font-medium text-text-strong">{t('settings.usage.modelDist')}</h4>
              <span className="text-[12px] text-text-weak">
                {t('settings.usage.tokenValue', { count: formatCompact(usage.tokens.totalTokens) })}
              </span>
            </div>
            {summary.topModels.length === 0 ? (
              <EmptyPanel>{t('settings.usage.empty')}</EmptyPanel>
            ) : (
              <div className="space-y-2.5">
                {summary.topModels.map((item) => (
                  <div key={item.model} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="min-w-0 truncate text-text-strong">{item.model}</span>
                      <span className="shrink-0 text-text-weak">
                        {formatCompact(item.tokens.totalTokens)} · {percent(item.tokens.totalTokens, usage.tokens.totalTokens)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-weak">
                      <div
                        className="h-full rounded-full bg-text-strong"
                        style={{ width: `${Math.max(4, (item.tokens.totalTokens / summary.maxModelTokens) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-[13px] font-medium text-text-strong">{t('settings.usage.dailyCost')}</h4>
              <span className="text-[12px] text-text-weak">{t('settings.usage.last30')}</span>
            </div>
            <DailyBars days={summary.summaryDays} setTooltip={setTooltip} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border-weak bg-surface/92 p-5 shadow-[var(--shadow-sm)]">
        <div className="mb-4">
          <h3 className="text-[14px] font-medium text-text-strong">{t('settings.usage.byAgent')}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-text-weak">{t('settings.usage.byAgentDesc')}</p>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {usage.byCli.map((item) => {
            const cli = CLIS.find((entry) => entry.id === item.cliId)
            return (
              <div key={item.cliId} className="rounded-xl border border-border-weak bg-surface/86 px-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
                    <CliIcon cliId={item.cliId} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text-strong">{cli?.name ?? item.cliId}</div>
                    <div className="mt-0.5 text-[11px] text-text-weak">
                      {t('settings.usage.agentMeta', {
                        requests: item.requestCount,
                        sessions: item.sessionCount
                      })}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-semibold text-text-strong">{formatCompact(item.tokens.totalTokens)}</div>
                    <div className="text-[11px] text-text-weak">{t('settings.usage.tokenUnit')}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {usage.errors.length > 0 && (
          <div className="mt-4 rounded-lg border border-dashed px-3 py-2 text-[12px]" style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}>
            {t('settings.usage.partial', { count: usage.errors.length })}
          </div>
        )}
      </section>
      <UsageTooltip tooltip={tooltip} />
    </div>
  )
}

function MetricCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-border-weak bg-surface-weak px-3 py-3">
      <div className="truncate text-[18px] font-semibold text-text-strong">{value}</div>
      <div className="mt-0.5 truncate text-[12px] text-text-weak">{label}</div>
    </div>
  )
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border-weak bg-surface/72 px-4 py-8 text-center text-[13px] text-text-weak shadow-[var(--shadow-sm)]">
      {children}
    </div>
  )
}

function UsageTooltip({ tooltip }: { tooltip: UsageTooltipState | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, opacity: 0 })

  useLayoutEffect(() => {
    if (!tooltip) return
    const node = ref.current
    if (!node) return

    const margin = 12
    const gap = 10
    const rect = node.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight

    const rawLeft =
      tooltip.align === 'start'
        ? tooltip.x
        : tooltip.align === 'end'
          ? tooltip.x - rect.width
          : tooltip.x - rect.width / 2
    let top = tooltip.placement === 'top' ? tooltip.y - rect.height - gap : tooltip.y + gap
    if (top < margin) top = tooltip.y + gap
    if (top + rect.height > viewportHeight - margin) top = tooltip.y - rect.height - gap

    setPosition({
      left: clamp(rawLeft, margin, viewportWidth - rect.width - margin),
      top: clamp(top, margin, viewportHeight - rect.height - margin),
      opacity: 1
    })
  }, [tooltip])

  if (!tooltip) return null
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      aria-hidden="true"
      className="pointer-events-none fixed z-50 w-[220px] max-w-[calc(100vw-24px)] rounded-md border border-border-weak bg-stronger/95 px-2.5 py-1.5 text-center text-[12px] leading-snug text-text-strong shadow-[var(--shadow-md)] backdrop-blur-xl"
      style={{
        left: position.left,
        top: position.top,
        opacity: position.opacity
      }}
    >
      {tooltip.content}
    </div>,
    document.body
  )
}

function usageTooltipFromPointer(event: PointerEvent<HTMLElement | SVGElement>, content: string): UsageTooltipState {
  const margin = 12
  const width = Math.min(220, Math.max(0, window.innerWidth - margin * 2))
  const half = width / 2
  const align = event.clientX < margin + half ? 'start' : event.clientX > window.innerWidth - margin - half ? 'end' : 'center'
  const x = align === 'start' ? margin : align === 'end' ? window.innerWidth - margin : event.clientX
  return {
    content,
    x,
    y: event.clientY,
    placement: event.clientY > 72 ? 'top' : 'bottom',
    align
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

const DailyBars = memo(function DailyBars({
  days,
  setTooltip
}: {
  days: UsageDailyBucket[]
  setTooltip: (tooltip: UsageTooltipState | null) => void
}) {
  const t = useT()
  const max = useMemo(() => Math.max(1, ...days.map((day) => day.tokens.totalTokens)), [days])
  const showTooltip = (event: PointerEvent<HTMLElement>, day: UsageDailyBucket) => {
    setTooltip(usageTooltipFromPointer(event, t('settings.usage.dayTooltipWithRequests', {
      date: day.date,
      tokens: formatCompact(day.tokens.totalTokens),
      requests: day.requestCount
    })))
  }
  return (
    <div
      className="flex h-[180px] items-end gap-1 rounded-xl border border-border-weak bg-surface/72 px-3 py-3"
      onPointerLeave={() => setTooltip(null)}
    >
      {days.map((day) => {
        const height = day.tokens.totalTokens > 0 ? Math.max(6, (day.tokens.totalTokens / max) * 150) : 3
        return (
          <div key={day.date} className="flex min-w-0 flex-1 items-end">
            <div
              tabIndex={0}
              role="img"
              aria-label={t('settings.usage.dayTooltipWithRequests', {
                date: day.date,
                tokens: formatCompact(day.tokens.totalTokens),
                requests: day.requestCount
              })}
              className="w-full rounded-t-[4px] transition-[background,filter] hover:brightness-110 focus-visible:brightness-110"
              style={{
                height,
                background: day.tokens.totalTokens > 0
                  ? 'color-mix(in srgb, var(--text-strong) 72%, var(--surface-base))'
                  : 'var(--surface-weak)'
              }}
              onPointerEnter={(event) => showTooltip(event, day)}
              onPointerMove={(event) => showTooltip(event, day)}
              onPointerLeave={() => setTooltip(null)}
              onBlur={() => setTooltip(null)}
            />
          </div>
        )
      })}
    </div>
  )
})

const ActivityHeatmap = memo(function ActivityHeatmap({
  days,
  setTooltip
}: {
  days: UsageDailyBucket[]
  setTooltip: (tooltip: UsageTooltipState | null) => void
}) {
  const t = useT()
  const monthNamesKey = [
    t('settings.usage.month.1'),
    t('settings.usage.month.2'),
    t('settings.usage.month.3'),
    t('settings.usage.month.4'),
    t('settings.usage.month.5'),
    t('settings.usage.month.6'),
    t('settings.usage.month.7'),
    t('settings.usage.month.8'),
    t('settings.usage.month.9'),
    t('settings.usage.month.10'),
    t('settings.usage.month.11'),
    t('settings.usage.month.12')
  ].join('\n')
  const { weeks, max, monthLabels, width, height } = useMemo(() => {
    const nextWeeks = heatmapWeeks(days)
    const monthNames = monthNamesKey.split('\n')
    return {
      weeks: nextWeeks,
      max: Math.max(1, ...days.map((day) => day.tokens.totalTokens)),
      monthLabels: heatmapMonthLabels(nextWeeks, monthNames),
      width: HEATMAP_LABEL_WIDTH + Math.max(0, nextWeeks.length * (HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP) - HEATMAP_CELL_GAP),
      height: HEATMAP_MONTH_HEIGHT + HEATMAP_ROWS * (HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP) - HEATMAP_CELL_GAP
    }
  }, [days, monthNamesKey])

  return (
    <div
      className="overflow-hidden rounded-xl border border-border-weak bg-surface/72 px-3 py-3"
      style={{ contain: 'layout paint' }}
    >
      <svg
        className="block h-auto w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('settings.usage.activity')}
        shapeRendering="geometricPrecision"
        onPointerLeave={() => setTooltip(null)}
      >
        {weeks.map((_week, index) => {
          const label = monthLabels.get(index)
          if (!label) return null
          return (
            <text
              key={`month-${index}`}
              x={HEATMAP_LABEL_WIDTH + index * (HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP)}
              y={9}
              fill="var(--text-weak)"
              fontSize="10"
            >
              {label}
            </text>
          )
        })}
        {[1, 3, 5].map((row) => (
          <text key={`weekday-${row}`} x={0} y={HEATMAP_MONTH_HEIGHT + row * (HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP) + 8} fill="var(--text-weak)" fontSize="10">
            {row === 1 ? t('settings.usage.mon') : row === 3 ? t('settings.usage.wed') : t('settings.usage.fri')}
          </text>
        ))}
        {weeks.flatMap((week, column) =>
          week.map((day, row) => {
            const level = day ? heatmapLevel(day.tokens.totalTokens, max) : 0
            const tooltipText = day
              ? t('settings.usage.dayTooltipWithRequests', {
                  date: day.date,
                  tokens: formatCompact(day.tokens.totalTokens),
                  requests: day.requestCount
                })
              : ''
            return (
              <rect
                key={`${column}-${row}`}
                tabIndex={day ? 0 : undefined}
                role={day ? 'img' : undefined}
                aria-label={day ? tooltipText : undefined}
                className={day ? 'outline-none transition-[filter,stroke-width] hover:brightness-110 focus-visible:brightness-110' : undefined}
                x={HEATMAP_LABEL_WIDTH + column * (HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP)}
                y={HEATMAP_MONTH_HEIGHT + row * (HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP)}
                width={HEATMAP_CELL_SIZE}
                height={HEATMAP_CELL_SIZE}
                rx={2.5}
                fill={heatmapColor(level)}
                stroke="var(--border-weak)"
                strokeWidth={0.8}
                onPointerEnter={day ? (event) => setTooltip(usageTooltipFromPointer(event, tooltipText)) : undefined}
                onPointerMove={day ? (event) => setTooltip(usageTooltipFromPointer(event, tooltipText)) : undefined}
                onPointerLeave={day ? () => setTooltip(null) : undefined}
                onBlur={day ? () => setTooltip(null) : undefined}
              />
            )
          })
        )}
      </svg>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-text-weak">
        <span>{t('settings.usage.less')}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className="block size-3 rounded-[3px] border border-border-weak"
            style={{ background: heatmapColor(level) }}
          />
        ))}
        <span>{t('settings.usage.more')}</span>
      </div>
    </div>
  )
})

function heatmapWeeks(days: UsageDailyBucket[]): Array<Array<UsageDailyBucket | null>> {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  if (!sorted.length) return []
  const first = parseLocalDate(sorted[0].date)
  const offset = first.getDay()
  const weeks: Array<Array<UsageDailyBucket | null>> = []
  let week: Array<UsageDailyBucket | null> = Array.from({ length: 7 }, () => null)
  for (let i = 0; i < offset; i += 1) week[i] = null
  for (const day of sorted) {
    const date = parseLocalDate(day.date)
    const weekday = date.getDay()
    if (weekday === 0 && week.some(Boolean)) {
      weeks.push(week)
      week = Array.from({ length: 7 }, () => null)
    }
    week[weekday] = day
  }
  if (week.some(Boolean)) weeks.push(week)
  return weeks
}

function heatmapMonthLabels(
  weeks: Array<Array<UsageDailyBucket | null>>,
  monthNames: string[]
): Map<number, string> {
  const labels = new Map<number, string>()
  let lastMonth = -1
  weeks.forEach((week, index) => {
    const firstDay = week.find(Boolean)
    if (!firstDay) return
    const date = parseLocalDate(firstDay.date)
    const month = date.getMonth()
    if (month !== lastMonth) {
      labels.set(index, monthNames[month] ?? '')
      lastMonth = month
    }
  })
  return labels
}

function parseLocalDate(key: string): Date {
  const [year = '1970', month = '1', day = '1'] = key.split('-')
  return new Date(Number(year), Number(month) - 1, Number(day))
}

function heatmapLevel(tokens: number, max: number): number {
  if (tokens <= 0) return 0
  return Math.max(1, Math.min(4, Math.ceil((tokens / max) * 4)))
}

function heatmapColor(level: number): string {
  if (level <= 0) return 'var(--surface-weak)'
  const mixes = [18, 34, 52, 72]
  return `color-mix(in srgb, var(--text-strong) ${mixes[level - 1]}%, var(--surface-base))`
}

function formatCompact(value: number): string {
  if (value >= 1_000_000_000) return `${trimFixed(value / 1_000_000_000)}B`
  if (value >= 1_000_000) return `${trimFixed(value / 1_000_000)}M`
  if (value >= 1_000) return `${trimFixed(value / 1_000)}K`
  return String(Math.round(value))
}

function trimFixed(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2).replace(/0$/, '')
}

function percent(value: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((value / total) * 100)}%`
}

function longestStreak(days: UsageDailyBucket[]): number {
  let best = 0
  let current = 0
  for (const day of days) {
    if (day.tokens.totalTokens > 0) {
      current += 1
      best = Math.max(best, current)
    } else {
      current = 0
    }
  }
  return best
}

function AboutSettings({ checkUpdatesKey = 0 }: { checkUpdatesKey?: number }) {
  const t = useT()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [appUpdate, setAppUpdate] = useState<AppUpdateStatus | null>(null)
  const [statuses, setStatuses] = useState<CliUpdateStatus[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState<CliId | null>(null)
  const [progress, setProgress] = useState<Partial<Record<CliId, InstallProgress>>>({})

  useEffect(() => {
    window.api.app.info().then(setInfo)
    window.api.appUpdate.getStatus().then(setAppUpdate)
  }, [])

  useEffect(() => {
    const offProgress = window.api.install.onProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.cliId]: p }))
    })
    const offUpdate = window.api.appUpdate.onStatus(setAppUpdate)
    return () => {
      offProgress()
      offUpdate()
    }
  }, [])

  useEffect(() => {
    void checkAppUpdate()
  }, [checkUpdatesKey])

  useEffect(() => {
    void refreshStatuses()
  }, [])

  const checkAppUpdate = async () => {
    const result = await window.api.appUpdate.check()
    setAppUpdate(result.status)
  }

  const downloadAppUpdate = async () => {
    const result = await window.api.appUpdate.download()
    setAppUpdate(result.status)
  }

  const installAppUpdate = async () => {
    await window.api.appUpdate.install()
  }

  const refreshStatuses = async () => {
    setChecking(true)
    try {
      setStatuses(await window.api.install.status())
    } finally {
      setChecking(false)
    }
  }

  const installUpdate = async (status: CliUpdateStatus) => {
    const cliId = status.cliId
    const meta = CLIS.find((cli) => cli.id === cliId)
    const source = status.source ?? (meta?.install === 'system' ? 'system' : 'sandbox')
    const action = status.installed ? 'reinstall' : 'install'
    setInstalling(cliId)
    setProgress((prev) => ({
      ...prev,
      [cliId]: {
        cliId,
        phase: 'resolve',
        message: t(status.installed ? 'settings.cliStatus.updating' : 'settings.cliStatus.installing')
      }
    }))
    const result = await window.api.install.cli(cliId, {
      source,
      action,
      binPath: source === 'system' ? status.binPath : undefined
    })
    if (!result.ok) {
      setProgress((prev) => ({
        ...prev,
        [cliId]: {
          cliId,
          phase: 'error',
          message: result.error
        }
      }))
    }
    setInstalling(null)
    await refreshStatuses()
  }

  const statusById = new Map((statuses ?? []).map((status) => [status.cliId, status]))

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] p-5">
        <div className="min-w-0">
          <h3 className="font-display text-[18px] font-semibold text-text-strong">AgentLauncher</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-text-weak">{t('settings.aboutDesc')}</p>
          <div className="mt-5 grid gap-2 text-[13px]">
            <InfoRow label={t('settings.aboutVersion')} value={info?.version ?? '-'} />
            <InfoRow label={t('settings.aboutPlatform')} value={info?.platform ?? '-'} />
            <InfoRow label={t('settings.aboutConfigPath')} value={info?.configPath ?? '-'} mono />
          </div>
        </div>
      </section>

      <AppUpdateSection
        status={appUpdate}
        onCheck={checkAppUpdate}
        onDownload={downloadAppUpdate}
        onInstall={installAppUpdate}
      />

      <section className="rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-medium text-text-strong">{t('settings.cliStatus.title')}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-text-weak">{t('settings.cliStatus.desc')}</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={refreshStatuses}
            disabled={checking || !!installing}
          >
            <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
            {checking ? t('settings.cliStatus.checking') : t('settings.cliStatus.check')}
          </Button>
        </div>

        <div className="space-y-2">
          {CLIS.map((cli) => {
            const id = cli.id as CliId
            const status = statusById.get(id)
            const activeProgress = progress[id]
            const busy = installing === id
            return (
              <CliStatusRow
                key={id}
                cliId={id}
                name={cli.name}
                status={status}
                progress={activeProgress}
                busy={busy}
                checking={checking && !statuses}
                onInstall={status ? () => installUpdate(status) : undefined}
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}

function AppUpdateSection({
  status,
  onCheck,
  onDownload,
  onInstall
}: {
  status: AppUpdateStatus | null
  onCheck: () => Promise<void>
  onDownload: () => Promise<void>
  onInstall: () => Promise<void>
}) {
  const t = useT()
  const busy = status?.status === 'checking' || status?.status === 'downloading'
  const hasUpdate = status?.status === 'available' || status?.status === 'downloading' || status?.status === 'downloaded'
  const downloaded = status?.status === 'downloaded'
  const latestVersion = status?.latestRelease?.version ?? status?.policy?.latestVersion ?? '-'
  const canAutoUpdate = !!status?.supported && !!status?.canAutoDownload
  const percent = Math.max(0, Math.min(100, Math.round(status?.percent ?? 0)))

  const actionLabel = downloaded
    ? t('settings.appUpdate.restart')
    : status?.status === 'downloading'
      ? t('settings.appUpdate.downloading')
      : hasUpdate && canAutoUpdate
        ? t('settings.appUpdate.download')
        : hasUpdate
          ? t('settings.appUpdate.openRelease')
          : status?.status === 'checking'
            ? t('settings.appUpdate.checking')
            : t('settings.appUpdate.check')

  const actionIcon = downloaded
    ? <RotateCcw size={13} />
    : status?.status === 'downloading' || status?.status === 'checking'
      ? <RefreshCw size={13} className="animate-spin" />
      : hasUpdate && !canAutoUpdate
        ? <ExternalLink size={13} />
        : hasUpdate
          ? <Download size={13} />
          : <RefreshCw size={13} />

  const runPrimary = async () => {
    if (downloaded) {
      await onInstall()
    } else if (hasUpdate && canAutoUpdate) {
      await onDownload()
    } else if (hasUpdate) {
      await window.api.appUpdate.openReleasePage(latestVersion)
    } else {
      await onCheck()
    }
  }

  return (
    <section className="rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium text-text-strong">{t('settings.appUpdate.title')}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-text-weak">{t('settings.appUpdate.desc')}</p>
        </div>
        <Button size="sm" variant={hasUpdate ? 'primary' : 'secondary'} onClick={runPrimary} disabled={busy}>
          {actionIcon}
          {actionLabel}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0 rounded-xl border border-border-weak bg-surface/72 px-3 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <StatusPill tone={hasUpdate ? 'warning' : status?.status === 'error' ? 'muted' : 'success'}>
              {appUpdateStateText(status, t)}
            </StatusPill>
            {status?.policy?.force ? (
              <StatusPill tone="warning">{t('settings.appUpdate.force')}</StatusPill>
            ) : null}
            {!status?.supported ? (
              <span className="text-[11px] text-text-weak">{t('settings.appUpdate.manualOnly')}</span>
            ) : null}
          </div>
          <div className="grid gap-1 text-[12px]">
            <InfoRow label={t('settings.appUpdate.currentVersion')} value={status?.currentVersion ?? '-'} />
            <InfoRow label={t('settings.appUpdate.latest')} value={latestVersion} />
            {status?.policy?.minVersion ? (
              <InfoRow label={t('settings.appUpdate.minVersion')} value={status.policy.minVersion} />
            ) : null}
          </div>
          {status?.status === 'downloading' ? (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-text-weak">
                <span>{t('settings.appUpdate.downloading')}</span>
                <span>{percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-weak">
                <div className="h-full rounded-full bg-text-strong transition-[width]" style={{ width: `${percent}%` }} />
              </div>
            </div>
          ) : null}
          {status?.error ? (
            <div className="mt-2 truncate text-[11px] text-[var(--danger)]" title={status.error}>
              {status.error}
            </div>
          ) : null}
        </div>

        <Button
          size="sm"
          variant="secondary"
          className="justify-self-end"
          onClick={() => window.api.appUpdate.openReleasePage(latestVersion)}
        >
          <ExternalLink size={13} />
          {t('settings.appUpdate.openRelease')}
        </Button>
      </div>
    </section>
  )
}

function appUpdateStateText(status: AppUpdateStatus | null, t: ReturnType<typeof useT>): string {
  if (!status) return t('settings.appUpdate.unchecked')
  if (status.status === 'checking') return t('settings.appUpdate.checking')
  if (status.status === 'available') return t('settings.appUpdate.available')
  if (status.status === 'downloading') return t('settings.appUpdate.downloading')
  if (status.status === 'downloaded') return t('settings.appUpdate.ready')
  if (status.status === 'up-to-date') return t('settings.appUpdate.upToDate')
  if (status.status === 'error') return t('settings.appUpdate.failed')
  return t('settings.appUpdate.unchecked')
}

function CliStatusRow({
  cliId,
  name,
  status,
  progress,
  busy,
  checking,
  onInstall
}: {
  cliId: CliId
  name: string
  status?: CliUpdateStatus
  progress?: InstallProgress
  busy: boolean
  checking: boolean
  onInstall?: () => void
}) {
  const t = useT()
  const installed = !!status?.installed
  const sourceLabel =
    status?.source === 'sandbox'
      ? t('settings.cliStatus.sourceSandbox')
      : status?.source === 'system'
        ? t('settings.cliStatus.sourceSystem')
        : t('settings.cliStatus.sourceUnknown')
  const stateLabel = !status
    ? checking
      ? t('settings.cliStatus.checking')
      : t('settings.cliStatus.unchecked')
    : status.error
      ? t('settings.cliStatus.checkFailed')
      : status.stale
        ? t('settings.cliStatus.stale')
        : status.updateAvailable
          ? t('settings.cliStatus.updateAvailable')
          : installed
          ? t('settings.cliStatus.installed')
          : t('settings.cliStatus.notInstalled')
  const versionText = !status
    ? '-'
    : status.currentVersion || (installed ? t('settings.cliStatus.versionUnknown') : '-')
  const latestText = status?.latestVersion ?? (status?.error ? t('settings.cliStatus.latestFailed') : '-')
  const detailText = progress && (busy || progress.phase === 'error')
    ? `${progress.message}${progress.fraction != null ? ` ${Math.round(progress.fraction * 100)}%` : ''}`
    : status?.error
      ? status.error
      : status?.binPath
        ? status.binPath
        : t('settings.cliStatus.noPath')
  const canInstall =
    !!status &&
    !!onInstall &&
    !busy &&
    (!status.installed || (status.updateAvailable && status.canInstallUpdate))
  const actionLabel = busy
    ? t('settings.cliStatus.updating')
    : !status?.installed
      ? t('settings.cliStatus.install')
      : cliId === 'hermes'
        ? t('settings.cliStatus.systemManaged')
      : status?.updateAvailable
        ? t('settings.cliStatus.update')
        : t('settings.cliStatus.current')

  return (
    <div className="grid gap-3 rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] px-3 py-3 md:grid-cols-[minmax(180px,1fr)_minmax(0,1.2fr)_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
          <CliIcon cliId={cliId} size={16} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-text-strong">{name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-weak">
            <StatusPill tone={status?.updateAvailable ? 'warning' : installed ? 'success' : 'muted'}>
              {stateLabel}
            </StatusPill>
            <span>{sourceLabel}</span>
          </div>
        </div>
      </div>

      <div className="min-w-0 text-[12px]">
        <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1">
          <span className="text-text-weak">{t('settings.cliStatus.currentVersion')}</span>
          <span className="truncate font-mono text-text-strong" title={versionText}>
            {versionText}
          </span>
          <span className="text-text-weak">{t('settings.cliStatus.latestVersion')}</span>
          <span className="truncate font-mono text-text-strong" title={latestText}>
            {latestText}
          </span>
        </div>
        <div
          className={`mt-1 truncate text-[11px] ${progress?.phase === 'error' || status?.error ? 'text-[var(--danger)]' : 'text-text-weak'}`}
          title={detailText}
        >
          {detailText}
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          variant={status?.updateAvailable || !status?.installed ? 'primary' : 'secondary'}
          disabled={!canInstall}
          onClick={onInstall}
          title={status?.source === 'system' ? t('settings.cliStatus.systemUpdateHint') : undefined}
        >
          {busy ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone: 'success' | 'warning' | 'muted' }) {
  const styles =
    tone === 'success'
      ? { background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: 'var(--success)' }
      : tone === 'warning'
        ? { background: 'color-mix(in srgb, var(--warning) 20%, transparent)', color: 'var(--text-strong)' }
        : { background: 'var(--surface-weak)', color: 'var(--text-weak)' }
  return (
    <span className="inline-flex h-5 items-center rounded-full px-2 text-[11px]" style={styles}>
      {children}
    </span>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <span className="text-text-weak">{label}</span>
      <span className={`min-w-0 truncate text-text-strong ${mono ? 'font-mono text-[12px]' : ''}`} title={value}>
        {value}
      </span>
    </div>
  )
}

function SettingControlRow({
  title,
  desc,
  children
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-5 px-4 py-4">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-text-strong">{title}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-text-weak">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingsSelect<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[selectedIndex] ?? options[0]

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }

    if (!mounted) return
    const timeout = window.setTimeout(() => setMounted(false), SELECT_MENU_ANIMATION_MS)
    return () => window.clearTimeout(timeout)
  }, [mounted, open])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const commit = (nextValue: T) => {
    onChange(nextValue)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = (selectedIndex + direction + options.length) % options.length
      onChange(options[nextIndex].value)
      setOpen(true)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen((current) => !current)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative w-[146px]">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
        className={`flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-surface/95 px-3 text-left text-[13px] font-medium text-text-strong shadow-[0_1px_1px_rgba(0,0,0,0.04)] outline-none transition-[background,border-color,box-shadow] ${
          open
            ? 'border-border-selected shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]'
            : 'border-border-weak hover:border-border-selected/70 hover:bg-surface'
        }`}
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-text-weak transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {mounted && (
        <div
          id={listboxId}
          role="listbox"
          data-state={open ? 'open' : 'closed'}
          className="settings-select-menu absolute right-0 top-[calc(100%+6px)] z-50 w-full overflow-hidden rounded-lg border border-border-weak bg-stronger p-1 text-[13px] shadow-[0_8px_18px_rgba(0,0,0,0.08),0_1px_4px_rgba(0,0,0,0.05)]"
        >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            onClick={() => commit(option.value)}
            className={`flex h-8 w-full items-center rounded-md px-2.5 text-left transition-colors ${
              option.value === value
                ? 'bg-[var(--button-primary-base)] text-[var(--button-primary-text)] shadow-[var(--shadow-sm)]'
                : 'text-text-base hover:bg-selection hover:text-text-strong'
            }`}
          >
            <span className="min-w-0 truncate">{option.label}</span>
          </button>
        ))}
        </div>
      )}
    </div>
  )
}
