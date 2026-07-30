import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '@/store/app'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { CLIS } from '@/data/clis'
import { PROVIDERS_BY_CLI } from '@/data/providers'
import { CliIcon } from '@/components/CliIcon'
import { ProfileConnectionTest } from '@/components/config/ProfileConnectionTest'
import appIcon from '@/assets/app-icon.png'
import { useT } from '@/i18n'
import type {
  AuthStatus,
  CliId,
  CliLinkProgress,
  DetectResult,
  SystemCliCandidate,
  SystemCliDetection
} from '@shared/types'

const STEP_KEYS = [
  'onboarding.step.welcome',
  'onboarding.step.detect',
  'onboarding.step.link',
  'onboarding.step.config',
  'onboarding.step.run'
] as const

export function Onboarding() {
  const t = useT()
  const complete = useAppStore((s) => s.completeOnboarding)
  const skip = useAppStore((s) => s.skipOnboarding)
  const [step, setStep] = useState(0)
  const isMac = window.api?.platform === 'darwin'

  const last = step === STEP_KEYS.length - 1
  const next = () => (last ? complete() : setStep((s) => s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))

  return (
    <div className="relative flex h-full flex-col" style={{ background: 'var(--canvas-gradient)' }}>
      {isMac && <div className="drag-region absolute inset-x-0 top-0 z-20 h-10" />}
      <div className="flex flex-1 overflow-hidden">
        <aside
          className={`flex w-56 shrink-0 flex-col gap-1 border-r border-border-weak/80 p-3 backdrop-blur-xl ${
            isMac ? 'pt-14' : 'pt-5'
          }`}
          style={{ background: 'var(--sidebar-gradient)' }}
        >
          <div className="mb-5 flex items-center gap-2 px-2">
            <img src={appIcon} alt="" className="app-logo size-6 shrink-0" />
            <span className="text-[13px] font-semibold text-text-strong">Agent Launcher</span>
          </div>
          {STEP_KEYS.map((key, i) => {
            const done = i < step
            const active = i === step
            return (
              <div
                key={key}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors ${
                  active
                    ? 'bg-surface font-medium text-text-strong shadow-[var(--shadow-sm)]'
                    : done
                      ? 'text-text-base'
                      : 'text-text-weak'
                }`}
              >
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors ${
                    done
                      ? 'bg-success text-white'
                      : active
                        ? 'bg-text-strong text-(--background-base)'
                        : 'bg-surface-weak text-text-weak'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                {t(key)}
              </div>
            )
          })}
        </aside>

        <section className={`flex-1 overflow-y-auto px-10 pb-8 ${isMac ? 'pt-14' : 'pt-8'}`}>
          {step === 0 && <Welcome />}
          {step === 1 && <DetectStep />}
          {step === 2 && <LinkStep />}
          {step === 3 && <ConfigStep />}
          {step === 4 && <Done />}
        </section>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-border-weak bg-base/80 px-5 py-2.5 backdrop-blur-xl">
        <Button variant="ghost" size="sm" onClick={skip}>
          {t('onboarding.skip')}
        </Button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button variant="secondary" onClick={back}>
              {t('onboarding.back')}
            </Button>
          )}
          <Button onClick={next}>{last ? t('onboarding.finish') : t('onboarding.next')}</Button>
        </div>
      </footer>
    </div>
  )
}

function Welcome() {
  const t = useT()
  return (
    <div className="mx-auto max-w-xl pt-16 text-center">
      <img src={appIcon} alt="" className="app-logo mx-auto mb-6 size-14" />
      <h1 className="font-display text-[28px] font-semibold text-text-strong">
        {t('onboarding.welcomeTitle')}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-text-base">
        {t('onboarding.welcomeDesc')}
      </p>
    </div>
  )
}

function DetectStep() {
  const t = useT()
  const [result, setResult] = useState<DetectResult | null>(null)
  const [ui, setUi] = useState<Record<string, CliInstallUi>>({})
  const pathManager = useCliPathManager(async () => {
    const next = await window.api.detect()
    setResult(next)
  })

  useEffect(() => {
    window.api.detect().then(setResult)
  }, [])

  return (
    <StepShell title={t('onboarding.detectTitle')} desc={t('onboarding.detectDesc')}>
      {!result ? (
        // Placeholder rows rather than a bare "detecting…" line: the list keeps
        // its shape, so nothing jumps when the real results land. The labels are
        // left blank because detection returns them in its own order.
        <ul className="space-y-2" aria-busy="true" aria-label={t('onboarding.detecting')}>
          {Array.from({ length: CLIS.length + 1 }, (_, i) => (
            <li
              key={i}
              className="rounded-xl border border-border-weak bg-surface/92 px-4 py-3 text-[14px] shadow-[var(--shadow-sm)]"
            >
              <div className="flex min-h-7 items-center gap-3">
                <span className="grid size-5 shrink-0 place-items-center">
                  <Loader2 size={13} className="animate-spin text-text-weak" />
                </span>
                <span className="h-3.5 w-28 shrink-0 animate-pulse rounded bg-surface-weak" />
                <span className="ml-auto h-3.5 w-40 max-w-[50%] animate-pulse rounded bg-surface-weak" />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="space-y-2">
            {result.items.map((it) => {
              const cliId = CLIS.some((c) => c.id === it.key) ? (it.key as CliId) : null
              const detected = cliId ? result.systemClis?.[cliId] : undefined
              const s = cliId ? (ui[cliId] ?? {}) : {}
              const expanded = !!(cliId && pathManager.expanded[cliId])
              return (
                <li
                  key={it.key}
                  className="rounded-xl border border-border-weak bg-surface/92 px-4 py-3 text-[14px] shadow-[var(--shadow-sm)]"
                >
                  <div className="flex min-h-7 items-center gap-3">
                    <span
                      className="grid size-5 shrink-0 place-items-center rounded-full text-[11px]"
                      style={{
                        background: it.present ? 'var(--success)' : 'var(--surface-weak)',
                        color: it.present ? '#fff' : 'var(--text-weak)'
                      }}
                    >
                      {it.present ? '✓' : '○'}
                    </span>
                    <span className="min-w-0 shrink-0 basis-40 truncate whitespace-nowrap text-text-strong">
                      {it.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-right text-[12px] text-text-weak">
                      {detected?.duplicate
                        ? t('onboarding.currentPath', {
                            path: detected.selectedPath ?? detected.candidates[0]?.path ?? ''
                          })
                        : it.detail}
                    </span>
                    {cliId && detected?.duplicate && (
                      <button
                        type="button"
                        onClick={() =>
                          pathManager.setExpanded((prev) => ({
                            ...prev,
                            [cliId]: !prev[cliId]
                          }))
                        }
                        title={
                          expanded
                            ? t('onboarding.collapsePaths')
                            : t('onboarding.managePaths', {
                                count: detected.candidates.length
                              })
                        }
                        className="no-drag grid size-7 shrink-0 place-items-center rounded-md text-text-weak hover:bg-surface-hover hover:text-text-strong"
                      >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    )}
                  </div>
                  {cliId && detected?.duplicate && (
                    <CliPathManager
                      cliId={cliId}
                      detected={detected}
                      installUi={s}
                      layout="detect"
                      onInstallUi={setUi}
                      {...pathManager}
                    />
                  )}
                </li>
              )
            })}
          </ul>
          {pathManager.modal}
        </>
      )}
    </StepShell>
  )
}

interface CliInstallUi {
  phase?: CliLinkProgress['phase']
  message?: string
  version?: string
  legacyManaged?: boolean
  binPath?: string
  error?: string
  busy?: boolean
}

type InstallUiSetter = Dispatch<SetStateAction<Record<string, CliInstallUi>>>

function useCliPathManager(onChanged: () => Promise<void> | void) {
  const t = useT()
  const [expanded, setExpanded] = useState<Partial<Record<CliId, boolean>>>({})
  const [cleanupTarget, setCleanupTarget] = useState<{
    cliId: CliId
    candidate: SystemCliCandidate
  } | null>(null)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [cleanupError, setCleanupError] = useState<string | null>(null)

  const selectCandidate = async (
    id: CliId,
    candidate: SystemCliCandidate,
    setUi: InstallUiSetter
  ) => {
    setUi((p) => ({ ...p, [id]: { ...p[id], busy: true, error: undefined } }))
    const r = await window.api.cli.link(id, {
      binPath: candidate.path
    })
    setUi((p) => ({
      ...p,
      [id]: r.ok
        ? {
            busy: false,
            phase: 'done',
            message: t('onboarding.linkDone'),
            version: r.version,
            legacyManaged: false,
            binPath: r.binPath
          }
        : { busy: false, phase: 'error', error: r.error }
    }))
    await onChanged()
  }

  const confirmCleanup = async () => {
    if (!cleanupTarget) return
    setCleanupBusy(true)
    setCleanupError(null)
    const r = await window.api.cli.cleanupCli(cleanupTarget.cliId, cleanupTarget.candidate.path)
    setCleanupBusy(false)
    if (!r.ok) {
      setCleanupError(r.error)
      return
    }
    setCleanupTarget(null)
    await onChanged()
  }

  const modal = (
    <Modal
      open={!!cleanupTarget}
      onClose={() => {
        if (!cleanupBusy) setCleanupTarget(null)
      }}
      title={t('onboarding.cleanupTitle')}
    >
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-text-base">{t('onboarding.cleanupDesc')}</p>
        <div className="selectable break-all rounded-xl border border-border-weak bg-background-base p-3 font-mono text-[12px] text-text-strong">
          {cleanupTarget?.candidate.path}
        </div>
        {cleanupError && <div className="text-[12px] text-danger">{cleanupError}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={cleanupBusy} onClick={() => setCleanupTarget(null)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={cleanupBusy} onClick={confirmCleanup}>
            {cleanupBusy ? t('onboarding.cleanupBusy') : t('onboarding.cleanupConfirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )

  return {
    cleanupBusy,
    expanded,
    modal,
    setCleanupTarget,
    setExpanded,
    selectCandidate
  }
}

interface CliPathManagerProps {
  cleanupBusy: boolean
  cliId: CliId
  detected: SystemCliDetection
  expanded: Partial<Record<CliId, boolean>>
  installUi: CliInstallUi
  layout: 'detect' | 'install'
  onInstallUi: InstallUiSetter
  setCleanupTarget: (target: { cliId: CliId; candidate: SystemCliCandidate } | null) => void
  setExpanded: Dispatch<SetStateAction<Partial<Record<CliId, boolean>>>>
  selectCandidate: (
    id: CliId,
    candidate: SystemCliCandidate,
    setUi: InstallUiSetter
  ) => Promise<void>
}

function CliPathManager({
  cleanupBusy,
  cliId,
  detected,
  expanded,
  installUi,
  layout,
  onInstallUi,
  setCleanupTarget,
  setExpanded,
  selectCandidate
}: CliPathManagerProps) {
  const t = useT()
  const isExpanded = !!expanded[cliId]
  const selectedPath = installUi.binPath ?? detected.selectedPath
  return (
    <>
      <div className={layout === 'detect' ? 'hidden' : 'contents'}>
        {detected.duplicate && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((prev) => ({ ...prev, [cliId]: !prev[cliId] }))}
          >
            {isExpanded ? t('onboarding.collapsePaths') : t('onboarding.expandPaths')}
          </Button>
        )}
      </div>
      {detected.duplicate && isExpanded && (
        <div className={layout === 'detect' ? 'mt-3' : 'basis-full pl-12'}>
          <div className="space-y-1 rounded-lg border border-border-weak bg-surface/70 p-2 shadow-[var(--shadow-sm)]">
            {detected.candidates.map((candidate) => {
              const selected = selectedPath === candidate.path
              return (
                <div
                  key={candidate.path}
                  className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-surface"
                >
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="truncate font-mono text-[12px] leading-relaxed text-text-strong">
                      {candidate.path}
                    </div>
                    <div className="truncate text-[11px] leading-relaxed text-text-weak">
                      {candidate.version
                        ? `${t('onboarding.versionLabel')} ${candidate.version}`
                        : t('onboarding.versionUnknown')}
                      {candidate.installKind
                        ? ` · ${candidate.packageManager ?? candidate.installKind}`
                        : ''}
                      {candidate.realPath && candidate.realPath !== candidate.path
                        ? ` · ${candidate.realPath}`
                        : ''}
                    </div>
                  </div>
                  {selected ? (
                    <span className="mt-1 shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success">
                      {t('onboarding.selectedPath')}
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2 text-[12px]">
                      <button
                        type="button"
                        disabled={installUi.busy}
                        onClick={() => selectCandidate(cliId, candidate, onInstallUi)}
                        className="no-drag rounded-md px-1.5 py-1 text-text-base hover:bg-surface-hover hover:text-text-strong disabled:pointer-events-none disabled:opacity-35"
                        title={t('onboarding.usePathHint')}
                      >
                        {t('onboarding.usePath')}
                      </button>
                      <button
                        type="button"
                        disabled={installUi.busy || cleanupBusy}
                        onClick={() => setCleanupTarget({ cliId, candidate })}
                        className="no-drag rounded-md px-1.5 py-1 text-text-weak hover:bg-surface-hover hover:text-danger disabled:pointer-events-none disabled:opacity-35"
                        title={t('onboarding.cleanupPathHint')}
                      >
                        {t('onboarding.cleanupPath')}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

function LinkStep() {
  const t = useT()
  const [ui, setUi] = useState<Record<string, CliInstallUi>>({})
  const [systemClis, setSystemClis] = useState<Partial<Record<CliId, SystemCliDetection>>>({})
  // Until the first detection resolves, nothing is known about any CLI. Without
  // this the rows would claim every CLI is missing for a moment.
  const [detecting, setDetecting] = useState(true)
  // A manual re-detect keeps the rows it already has and only spins the button.
  const [refreshing, setRefreshing] = useState(false)
  const autoLinkStarted = useRef(false)

  const refreshDetection = async () => {
    const result = await window.api.detect()
    setSystemClis(result.systemClis ?? {})
    return result
  }

  // Seed from persisted install state, then automatically link any system CLIs
  // found on PATH so the default is ready without an extra click.
  useEffect(() => {
    let cancelled = false
    const detection = Promise.all([window.api.config.get(), refreshDetection()]).then(
      async ([cfg, result]) => {
        if (cancelled) return
        const autoLinks = CLIS.map((c) => c.id as CliId).filter((id) => {
          const inst = cfg.install[id]
          const detected = result.systemClis?.[id]
          if (!detected?.installed || !detected.selectedPath) return false
          // Never probe a candidate that can trigger a macOS security dialog.
          // The row explains the required manual update instead.
          if (detected.macosSecurityRisk) return false
          return !inst?.installed || inst.legacyManaged || detected.status === 'stale'
        })

        setUi((prev) => {
          const next = { ...prev }
          for (const c of CLIS) {
            const id = c.id as CliId
            const inst = cfg.install[id]
            const detected = result.systemClis?.[id]
            const staleSystemInstall =
              !inst?.legacyManaged && (detected?.status === 'stale' || detected?.macosSecurityRisk)
            const shouldAutoLink = autoLinks.includes(id)
            if (inst?.installed && !staleSystemInstall && !shouldAutoLink && !next[id]?.busy) {
              next[c.id] = {
                phase: 'done',
                message: t('settings.cliStatus.installed'),
                version: inst.version,
                legacyManaged: inst.legacyManaged,
                binPath: inst.binPath
              }
            } else if (shouldAutoLink && !next[id]?.busy) {
              next[id] = {
                ...next[id],
                busy: true,
                phase: 'link',
                message: t('onboarding.systemAvailable'),
                legacyManaged: false,
                binPath: detected?.selectedPath
              }
            }
          }
          return next
        })
        setDetecting(false)

        if (autoLinkStarted.current) return
        autoLinkStarted.current = true
        for (const id of autoLinks) {
          if (cancelled) return
          await linkOne(id, result.systemClis?.[id]?.selectedPath)
        }
      }
    )
    // A failed detection must still clear the loading state, or every row stays
    // stuck on its placeholder.
    detection.catch(() => {
      if (!cancelled) setDetecting(false)
    })
    return () => {
      cancelled = true
    }
    // Initial detection/linking must not repeat when translated copy or local function identities change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return window.api.cli.onLinkProgress((p) => {
      setUi((prev) => ({
        ...prev,
        [p.cliId]: {
          ...prev[p.cliId],
          phase: p.phase,
          message: p.message
        }
      }))
    })
  }, [])

  const linkOne = async (id: CliId, binPath?: string) => {
    setUi((p) => ({ ...p, [id]: { ...p[id], busy: true, error: undefined } }))
    const r = await window.api.cli.link(id, { binPath })
    setUi((p) => ({
      ...p,
      [id]: r.ok
        ? {
            busy: false,
            phase: 'done',
            message: r.warning ?? t('onboarding.linkDone'),
            version: r.version,
            legacyManaged: false,
            binPath: r.binPath
          }
        : { busy: false, phase: 'error', error: r.error }
    }))
    await refreshDetection()
  }

  /** Only reachable for a CLI that was not detected — the main process links
   * instead of installing if the command turns out to already exist. */
  const installOne = async (id: CliId) => {
    setUi((p) => ({ ...p, [id]: { ...p[id], busy: true, error: undefined } }))
    const r = await window.api.cli.install(id)
    setUi((p) => ({
      ...p,
      [id]: r.ok
        ? {
            busy: false,
            phase: 'done',
            message: r.warning ?? t('onboarding.installDone'),
            version: r.version,
            legacyManaged: false,
            binPath: r.binPath
          }
        : { busy: false, phase: 'error', error: r.error }
    }))
    await refreshDetection()
  }

  return (
    <StepShell title={t('onboarding.linkTitle')} desc={t('onboarding.linkDesc')}>
      <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-border-weak bg-surface/92 px-4 py-3 shadow-[var(--shadow-sm)]">
        <div className="min-w-0 text-[12px] leading-relaxed text-text-base">
          {t('onboarding.linkManageDesc')}
        </div>
        <Button
          className="shrink-0"
          size="sm"
          disabled={detecting || refreshing}
          onClick={() => {
            setRefreshing(true)
            refreshDetection().finally(() => setRefreshing(false))
          }}
        >
          {detecting || refreshing ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              {t('onboarding.detecting')}
            </>
          ) : (
            t('onboarding.refreshDetection')
          )}
        </Button>
      </div>
      <div className="space-y-2">
        {CLIS.map((c) => {
          const s = ui[c.id] ?? {}
          const id = c.id as CliId
          const detected = systemClis[id]
          const hasMacSecurityRisk = !!detected?.macosSecurityRisk
          const isLinked = s.phase === 'done' || detected?.status === 'linked'
          const canLink =
            !hasMacSecurityRisk && !isLinked && !!detected?.installed && !!detected.selectedPath
          // Installing is offered only once detection has run and found nothing:
          // an existing CLI is never reinstalled or updated.
          const canInstall = !hasMacSecurityRisk && !isLinked && !!detected && !detected.installed
          // Nothing is known about this row yet — show that instead of guessing.
          const rowDetecting = detecting && !s.busy && s.phase !== 'done'
          const macSecurityWarning = hasMacSecurityRisk
            ? t(
                id === 'codex'
                  ? 'onboarding.codexManualUpdateWarning'
                  : 'onboarding.macSecurityManualUpdateWarning'
              )
            : undefined
          return (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border-weak bg-surface/92 px-4 py-3 shadow-[var(--shadow-sm)]"
            >
              <span
                className={`grid size-9 place-items-center rounded-md ${
                  s.phase === 'done'
                    ? 'bg-success/15 text-success'
                    : 'bg-surface-weak text-text-strong'
                }`}
              >
                <CliIcon cliId={c.id as CliId} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-text-strong">{c.name}</div>
                <div
                  className={`${hasMacSecurityRisk ? 'whitespace-normal break-words leading-relaxed' : 'truncate'} text-[12px] text-text-weak`}
                  title={macSecurityWarning}
                >
                  {s.error ? (
                    <span style={{ color: 'var(--danger)' }}>{s.error}</span>
                  ) : hasMacSecurityRisk && !s.busy ? (
                    <span style={{ color: 'var(--warning)' }}>{macSecurityWarning}</span>
                  ) : s.phase === 'done' ? (
                    <span style={{ color: 'var(--success)' }}>
                      {t(s.legacyManaged ? 'onboarding.installed' : 'onboarding.systemLinked', {
                        version: s.version && s.version !== 'installed' ? ` ${s.version}` : ''
                      })}
                    </span>
                  ) : s.busy ? (
                    (s.message ?? t('onboarding.linking'))
                  ) : rowDetecting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" />
                      {t('onboarding.detecting')}
                    </span>
                  ) : detected?.installed ? (
                    t('onboarding.systemAvailable')
                  ) : (
                    t('onboarding.systemMissing')
                  )}
                </div>
                {(s.binPath || detected?.selectedPath) && (
                  <div className="mt-0.5 truncate text-[11px] text-text-weak">
                    {s.binPath ?? detected?.selectedPath}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {rowDetecting ? (
                  // Placeholder so the row keeps its height while detecting.
                  <span className="h-7 w-24 animate-pulse rounded-md bg-surface-weak" />
                ) : (
                  <>
                    {canInstall && (
                      <Button size="sm" disabled={s.busy} onClick={() => installOne(id)}>
                        {s.busy ? t('onboarding.installBusy') : t('onboarding.installBtn')}
                      </Button>
                    )}
                    {canLink ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={s.busy}
                        onClick={() => linkOne(id, detected?.selectedPath)}
                      >
                        {s.busy ? t('onboarding.linkingBusy') : t('onboarding.useSystemBtn')}
                      </Button>
                    ) : (
                      <ButtonLink
                        size="sm"
                        variant="secondary"
                        href={c.installDocsUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={13} />
                        {t('onboarding.officialInstallDocs')}
                      </ButtonLink>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </StepShell>
  )
}

function ConfigStep() {
  const t = useT()
  const initialProvider = PROVIDERS_BY_CLI['claude-code'][0]
  const [cliId, setCliId] = useState<CliId>('claude-code')
  const [mode, setMode] = useState<'official' | 'api'>('official')
  const [providerId, setProviderId] = useState<string>(initialProvider?.id ?? '')
  const [baseUrl, setBaseUrl] = useState(initialProvider?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [saved, setSaved] = useState(false)
  const [statuses, setStatuses] = useState<Partial<Record<CliId, AuthStatus>>>({})
  const [authBusy, setAuthBusy] = useState<Partial<Record<CliId, boolean>>>({})
  const [authLogs, setAuthLogs] = useState<Partial<Record<CliId, string>>>({})
  const [activeAuthId, setActiveAuthId] = useState<string | null>(null)
  const [activeAuthCli, setActiveAuthCli] = useState<CliId | null>(null)
  const [authInput, setAuthInput] = useState('')

  const providers = PROVIDERS_BY_CLI[cliId]
  const officialClis = useMemo(
    () => CLIS.filter((c) => c.id === 'claude-code' || c.id === 'codex'),
    []
  )
  const supportsOfficial = cliId === 'claude-code' || cliId === 'codex'

  const refreshStatus = async (id: CliId) => {
    const s = await window.api.auth.status(id)
    setStatuses((prev) => ({ ...prev, [id]: s }))
  }

  useEffect(() => {
    // Checking Codex auth executes the CLI. Keep that behind the explicit
    // "Check" button so simply entering this step cannot reopen a macOS
    // security dialog.
    for (const c of officialClis) {
      if (c.id !== 'codex') refreshStatus(c.id as CliId)
    }
  }, [officialClis])

  useEffect(() => {
    const offData = window.api.auth.onData((_id, id, data) => {
      setAuthLogs((prev) => ({
        ...prev,
        [id]: `${prev[id] ?? ''}${data}`.slice(-4000)
      }))
    })
    const offExit = window.api.auth.onExit((id, owner, code) => {
      setAuthBusy((prev) => ({ ...prev, [owner]: false }))
      setAuthLogs((prev) => ({
        ...prev,
        [owner]: `${prev[owner] ?? ''}\n[exit ${code}]\n`
      }))
      if (id === activeAuthId) {
        setActiveAuthId(null)
        setActiveAuthCli(null)
      }
      refreshStatus(owner)
    })
    return () => {
      offData()
      offExit()
    }
  }, [activeAuthId])

  const select = (id: string) => {
    setMode('api')
    setProviderId(id)
    const p = providers.find((x) => x.id === id)
    setBaseUrl(p?.baseUrl ?? '')
    setApiKey('')
    setModel('')
    setSaved(false)
  }

  const selectCli = (id: CliId) => {
    const first = PROVIDERS_BY_CLI[id][0]
    setCliId(id)
    setMode(id === 'claude-code' || id === 'codex' ? 'official' : 'api')
    setProviderId(first?.id ?? '')
    setBaseUrl(first?.baseUrl ?? '')
    setApiKey('')
    setModel('')
    setSaved(false)
  }

  const save = async () => {
    const p = providers.find((x) => x.id === providerId)
    const isOfficialProvider = p?.category === 'official'
    const nextBaseUrl = baseUrl.trim()
    const nextApiKey = isOfficialProvider ? '' : apiKey.trim()
    const nextModel = model.trim()

    if (!isOfficialProvider && !nextBaseUrl) {
      toast.error(t('config.baseUrlRequiredToast'))
      return
    }

    if (!isOfficialProvider && !nextApiKey) {
      toast.error(t('config.apiKeyRequiredToast'))
      return
    }

    // Relay profiles must name the model explicitly — we never pick a default.
    if (!isOfficialProvider && !nextModel) {
      toast.error(t('config.modelRequiredToast'))
      return
    }
    const cfg = await window.api.config.addProfile(cliId, {
      name: p?.name ?? t('category.custom'),
      providerId,
      baseUrl: isOfficialProvider ? '' : nextBaseUrl,
      apiKey: nextApiKey,
      model: nextModel
    })
    const created = cfg.clis[cliId].profiles.at(-1)
    if (created) await window.api.config.setActiveProfile(cliId, created.id)
    setSaved(true)
  }

  const useOfficial = async () => {
    const p = providers.find((x) => x.id === 'official')
    await window.api.config.addProfile(cliId, {
      name: p?.name ?? t('category.official'),
      providerId: 'official',
      baseUrl: ''
    })
    setMode('official')
    setSaved(true)
  }

  const startLogin = async (id: CliId, method: 'official' | 'device' = 'official') => {
    setCliId(id)
    setMode('official')
    setAuthBusy((prev) => ({ ...prev, [id]: true }))
    setAuthLogs((prev) => ({ ...prev, [id]: '' }))
    try {
      const authId = await window.api.auth.startLogin(id, method)
      setActiveAuthId(authId)
      setActiveAuthCli(id)
    } catch (e) {
      setAuthBusy((prev) => ({ ...prev, [id]: false }))
      setAuthLogs((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : String(e)
      }))
    }
  }

  const sendAuthInput = () => {
    if (!activeAuthId || !authInput) return
    window.api.auth.write(activeAuthId, `${authInput}\n`)
    setAuthInput('')
  }

  const cancelLogin = () => {
    if (!activeAuthId || !activeAuthCli) return
    window.api.auth.stop(activeAuthId)
    setAuthBusy((prev) => ({ ...prev, [activeAuthCli]: false }))
    setAuthLogs((prev) => ({
      ...prev,
      [activeAuthCli]: `${prev[activeAuthCli] ?? ''}\n[cancelled]\n`
    }))
    setActiveAuthId(null)
    setActiveAuthCli(null)
  }

  return (
    <StepShell title={t('onboarding.configTitle')} desc={t('onboarding.configDesc')}>
      <div className="mb-3 flex gap-1">
        {CLIS.map((c) => (
          <button
            key={c.id}
            onClick={() => selectCli(c.id as CliId)}
            className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
              cliId === c.id
                ? 'bg-[var(--button-primary-base)] text-[var(--button-primary-text)] shadow-[var(--shadow-sm)]'
                : 'text-text-base hover:bg-surface-weak'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1">
        {supportsOfficial && (
          <button
            onClick={() => {
              setMode('official')
              setApiKey('')
              setSaved(false)
            }}
            className={`rounded-xl border bg-surface/92 px-3 py-2.5 text-left shadow-[var(--shadow-sm)] transition-[background,border-color,box-shadow] ${
              mode === 'official'
                ? 'border-border-selected bg-surface shadow-[var(--shadow-card)]'
                : 'border-border-weak hover:border-border-base hover:bg-surface'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium text-text-strong">
                {t(cliId === 'codex' ? 'onboarding.authCardCodex' : 'onboarding.authCardClaude')}
              </span>
              <span className="shrink-0 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                {t('onboarding.authBadgeOfficial')}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-text-weak">{t('onboarding.authOfficial')}</div>
          </button>
        )}
        {providers.map((p) => (
          <button
            key={p.id}
            onClick={() => select(p.id)}
            className={`rounded-xl border bg-surface/92 px-3 py-2.5 text-left shadow-[var(--shadow-sm)] transition-[background,border-color,box-shadow] ${
              mode === 'api' && providerId === p.id
                ? 'border-border-selected bg-surface shadow-[var(--shadow-card)]'
                : 'border-border-weak hover:border-border-base hover:bg-surface'
            }`}
          >
            <div className="truncate text-[13px] font-medium text-text-strong">{p.name}</div>
            <div className="mt-0.5 text-[11px] text-text-weak">{t('category.' + p.category)}</div>
          </button>
        ))}
      </div>

      {mode === 'official' && supportsOfficial && (
        <OfficialAuthPanel
          authBusy={!!authBusy[cliId]}
          authInput={authInput}
          authLog={authLogs[cliId]}
          canSend={!!activeAuthId && activeAuthCli === cliId}
          cliId={cliId}
          onCancel={cancelLogin}
          onCheck={() => refreshStatus(cliId)}
          onInput={setAuthInput}
          onLogin={() => startLogin(cliId)}
          onLoginDevice={() => startLogin(cliId, 'device')}
          onSend={sendAuthInput}
          onUseOfficial={useOfficial}
          saved={saved}
          status={statuses[cliId]}
          t={t}
        />
      )}

      {mode === 'api' && providerId && (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-[12px] text-text-weak">Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://..."
              className="selectable mt-1 w-full rounded-md border border-border-weak bg-surface px-3 py-2.5 text-[13px] text-text-strong outline-none focus:border-border-selected"
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-text-weak">API Key</span>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder="sk-..."
              className="selectable mt-1 w-full rounded-md border border-border-weak bg-surface px-3 py-2.5 text-[13px] text-text-strong outline-none focus:border-border-selected"
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-text-weak">{t('config.model')}</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t('config.modelPlaceholder')}
              className="selectable mt-1 w-full rounded-md border border-border-weak bg-surface px-3 py-2.5 text-[13px] text-text-strong outline-none focus:border-border-selected"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save}>{t('onboarding.saveConfig')}</Button>
            <ProfileConnectionTest cliId={cliId} profile={{ providerId, baseUrl, apiKey, model }} />
            {saved && <span className="text-[13px] text-success">{t('onboarding.saved')}</span>}
          </div>
        </div>
      )}
    </StepShell>
  )
}

function OfficialAuthPanel({
  authBusy,
  authInput,
  authLog,
  canSend,
  cliId,
  onCancel,
  onCheck,
  onInput,
  onLogin,
  onLoginDevice,
  onSend,
  onUseOfficial,
  saved,
  status,
  t
}: {
  authBusy: boolean
  authInput: string
  authLog?: string
  canSend: boolean
  cliId: CliId
  onCancel: () => void
  onCheck: () => void
  onInput: (value: string) => void
  onLogin: () => void
  onLoginDevice: () => void
  onSend: () => void
  onUseOfficial: () => void
  saved: boolean
  status?: AuthStatus
  t: ReturnType<typeof useT>
}) {
  const statusText =
    status?.installed === false
      ? t('onboarding.authNotInstalled')
      : status?.loggedIn
        ? t('onboarding.authLoggedIn')
        : status?.error
          ? status.error
          : t('onboarding.authNotLoggedIn')

  return (
    <div className="mt-4 rounded-xl border border-border-weak bg-surface/92 p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-md bg-surface-weak text-text-strong">
          <CliIcon cliId={cliId} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-text-strong">
            {t(cliId === 'codex' ? 'onboarding.authCardCodex' : 'onboarding.authCardClaude')}
          </div>
          <div className="mt-0.5 text-[12px] text-text-weak">{statusText}</div>
        </div>
        <Button size="sm" variant="secondary" onClick={onCheck}>
          {t('onboarding.authCheck')}
        </Button>
        {authBusy ? (
          <Button size="sm" variant="secondary" onClick={onCancel}>
            {t('onboarding.authCancel')}
          </Button>
        ) : (
          <Button size="sm" disabled={status?.installed === false} onClick={onLogin}>
            {t(cliId === 'codex' ? 'onboarding.authLoginCodex' : 'onboarding.authLoginClaude')}
          </Button>
        )}
        {cliId === 'codex' && !authBusy && (
          <Button
            size="sm"
            variant="ghost"
            disabled={status?.installed === false}
            onClick={onLoginDevice}
          >
            {t('onboarding.authDevice')}
          </Button>
        )}
      </div>
      <div className="mt-3 text-[12px] leading-relaxed text-text-base">
        {t(cliId === 'codex' ? 'onboarding.authCodexHint' : 'onboarding.authClaudeHint')}
      </div>
      {(authLog || authBusy) && (
        <div className="mt-3 rounded-lg border border-border-weak bg-background-base p-2">
          <pre className="selectable max-h-32 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-text-base">
            {authLog || t('onboarding.authWaiting')}
          </pre>
          <div className="mt-2 flex gap-2">
            <input
              value={authInput}
              onChange={(e) => onInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSend()
              }}
              placeholder={t('onboarding.authInputPlaceholder')}
              className="selectable min-w-0 flex-1 rounded-md border border-border-weak bg-surface px-3 py-2 text-[12px] text-text-strong outline-none focus:border-border-selected"
            />
            <Button size="sm" variant="secondary" onClick={onSend} disabled={!canSend}>
              {t('onboarding.authSend')}
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={onUseOfficial}>{t('onboarding.authUseOfficial')}</Button>
        {saved && <span className="text-[13px] text-success">{t('onboarding.saved')}</span>}
      </div>
    </div>
  )
}

function Done() {
  const t = useT()
  return (
    <div className="mx-auto max-w-xl pt-16 text-center">
      <div className="mx-auto mb-6 grid size-14 place-items-center rounded-xl bg-success text-2xl text-white shadow-[var(--shadow-card)]">
        ✓
      </div>
      <h1 className="font-display text-[30px] font-semibold text-text-strong">
        {t('onboarding.doneTitle')}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-text-base">
        {t('onboarding.doneDesc')}
      </p>
    </div>
  )
}

function StepShell({
  title,
  desc,
  children
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="font-display text-[22px] font-semibold text-text-strong">{title}</h2>
      <p className="mt-2 mb-6 text-[14px] leading-relaxed text-text-base">{desc}</p>
      {children}
    </div>
  )
}
