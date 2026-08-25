import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useAppStore } from '@/store/app'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { CLIS } from '@/data/clis'
import { CliIcon } from '@/components/CliIcon'
import {
  AgentConfigEditor,
  type AgentConfigEditorHandle
} from '@/components/config/AgentConfigEditor'
import appIcon from '@/assets/app-icon.png'
import { useT } from '@/i18n'
import type {
  AppConfig,
  CliId,
  CliLinkProgress,
  CliUpdateStatus,
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
  const [advancing, setAdvancing] = useState(false)
  const configEditorRef = useRef<AgentConfigEditorHandle>(null)
  const isMac = window.api?.platform === 'darwin'

  const last = step === STEP_KEYS.length - 1
  const next = async () => {
    if (last) {
      complete()
      return
    }
    if (step === 3) {
      setAdvancing(true)
      try {
        if (!configEditorRef.current || !(await configEditorRef.current.save())) return
      } finally {
        setAdvancing(false)
      }
    }
    setStep((current) => current + 1)
  }
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
          {step === 3 && <ConfigStep editorRef={configEditorRef} />}
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
          <Button disabled={advancing} onClick={() => void next()}>
            {last
              ? t('onboarding.finish')
              : step === 3
                ? t('onboarding.saveAndNext')
                : t('onboarding.next')}
          </Button>
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
  const [versionStatuses, setVersionStatuses] = useState<Partial<Record<CliId, CliUpdateStatus>>>(
    {}
  )
  // Until the first detection resolves, nothing is known about any CLI. Without
  // this the rows would claim every CLI is missing for a moment.
  const [detecting, setDetecting] = useState(true)
  const [checkingVersions, setCheckingVersions] = useState(true)
  // A manual re-detect keeps the rows it already has and only spins the button.
  const [refreshing, setRefreshing] = useState(false)
  const autoLinkStarted = useRef(false)

  const refreshDetection = async () => {
    const result = await window.api.detect()
    setSystemClis(result.systemClis ?? {})
    return result
  }

  const refreshVersions = async () => {
    setCheckingVersions(true)
    try {
      const statuses = await window.api.cli.status()
      setVersionStatuses(
        Object.fromEntries(statuses.map((status) => [status.cliId, status])) as Record<
          CliId,
          CliUpdateStatus
        >
      )
    } catch {
      setVersionStatuses({})
    } finally {
      setCheckingVersions(false)
    }
  }

  const refreshAll = async () => {
    setRefreshing(true)
    try {
      await Promise.all([refreshDetection(), refreshVersions()])
    } finally {
      setRefreshing(false)
    }
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

        if (!autoLinkStarted.current) {
          autoLinkStarted.current = true
          for (const id of autoLinks) {
            if (cancelled) return
            await linkOne(id, result.systemClis?.[id]?.selectedPath, false)
          }
        }
        if (!cancelled) await refreshVersions()
      }
    )
    // A failed detection must still clear the loading state, or every row stays
    // stuck on its placeholder.
    detection.catch(() => {
      if (!cancelled) {
        setDetecting(false)
        void refreshVersions()
      }
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

  const linkOne = async (id: CliId, binPath?: string, refreshStatus = true) => {
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
    if (refreshStatus) await refreshVersions()
  }

  /** Only reachable for a CLI that was not detected — the main process links
   * instead of installing if the command turns out to already exist. */
  const installOne = async (id: CliId) => {
    setUi((p) => ({ ...p, [id]: { ...p[id], busy: true, error: undefined } }))
    try {
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
    } catch (e) {
      setUi((p) => ({
        ...p,
        [id]: {
          busy: false,
          phase: 'error',
          error: e instanceof Error ? e.message : String(e)
        }
      }))
    } finally {
      await Promise.all([refreshDetection(), refreshVersions()])
    }
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
          disabled={detecting || checkingVersions || refreshing}
          onClick={() => void refreshAll()}
        >
          <RefreshCw
            size={13}
            className={detecting || checkingVersions || refreshing ? 'animate-spin' : ''}
          />
          {detecting || checkingVersions || refreshing
            ? t('settings.cliStatus.checking')
            : t('settings.cliStatus.check')}
        </Button>
      </div>
      <div className="space-y-2">
        {CLIS.map((c) => {
          const s = ui[c.id] ?? {}
          const id = c.id as CliId
          const detected = systemClis[id]
          const versionStatus = versionStatuses[id]
          const selectedCandidate =
            detected?.candidates.find((candidate) => candidate.path === detected.selectedPath) ??
            detected?.candidates[0]
          const hasMacSecurityRisk = !!detected?.macosSecurityRisk
          const isLinked = s.phase === 'done' || detected?.status === 'linked'
          const canLink =
            !hasMacSecurityRisk && !isLinked && !!detected?.installed && !!detected.selectedPath
          // Installing is offered only once detection has run and found nothing:
          // an existing CLI is never reinstalled or updated.
          const canInstall = !hasMacSecurityRisk && !isLinked && !!detected && !detected.installed
          // Nothing is known about this row yet — show that instead of guessing.
          const rowDetecting = detecting && !s.busy && s.phase !== 'done'
          const currentVersion =
            versionStatus?.currentVersion ?? s.version ?? selectedCandidate?.version ?? '-'
          const latestVersion =
            versionStatus?.latestVersion ??
            (versionStatus?.error ? t('settings.cliStatus.latestFailed') : '-')
          const binPath = versionStatus?.binPath ?? s.binPath ?? detected?.selectedPath
          const sourceLabel = versionStatus?.legacyManaged
            ? t('settings.cliStatus.sourceLegacy')
            : versionStatus?.source === 'system' || detected?.installed
              ? t('settings.cliStatus.sourceSystem')
              : undefined
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
              className="grid gap-3 rounded-xl border border-border-weak bg-surface/92 px-4 py-3 shadow-[var(--shadow-sm)] md:grid-cols-[minmax(150px,1fr)_minmax(130px,0.8fr)_auto] md:items-center"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-md ${
                    isLinked ? 'bg-success/15 text-success' : 'bg-surface-weak text-text-strong'
                  }`}
                >
                  <CliIcon cliId={id} size={18} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[14px] text-text-strong">{c.name}</div>
                  <div className="mt-0.5 flex min-h-5 flex-wrap items-center gap-1.5 text-[11px] text-text-weak">
                    {s.error ? (
                      <span className="text-danger">{s.error}</span>
                    ) : hasMacSecurityRisk && !s.busy ? (
                      <span className="line-clamp-2 text-warning" title={macSecurityWarning}>
                        {macSecurityWarning}
                      </span>
                    ) : s.busy ? (
                      <span>{s.message ?? t('onboarding.linking')}</span>
                    ) : rowDetecting ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 size={12} className="animate-spin" />
                        {t('onboarding.detecting')}
                      </span>
                    ) : (
                      <>
                        <span
                          className={`rounded-full px-2 py-0.5 ${
                            versionStatus?.stale || versionStatus?.updateAvailable
                              ? 'bg-warning/15 text-warning'
                              : isLinked
                                ? 'bg-success/15 text-success'
                                : 'bg-surface-weak text-text-weak'
                          }`}
                        >
                          {versionStatus?.stale
                            ? t('settings.cliStatus.stale')
                            : versionStatus?.updateAvailable
                              ? t('settings.cliStatus.updateAvailable')
                              : isLinked
                                ? t('settings.cliStatus.installed')
                                : detected?.installed
                                  ? t('onboarding.systemAvailable')
                                  : t('settings.cliStatus.notInstalled')}
                        </span>
                        {sourceLabel ? <span>{sourceLabel}</span> : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="min-w-0 text-[11px]">
                <div className="grid grid-cols-[42px_1fr] gap-x-2 gap-y-0.5">
                  <span className="text-text-weak">{t('settings.cliStatus.currentVersion')}</span>
                  <span className="truncate font-mono text-text-strong" title={currentVersion}>
                    {currentVersion}
                  </span>
                  <span className="text-text-weak">{t('settings.cliStatus.latestVersion')}</span>
                  <span className="truncate font-mono text-text-strong" title={latestVersion}>
                    {checkingVersions && !versionStatus ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      latestVersion
                    )}
                  </span>
                </div>
                <div className="mt-1 truncate text-text-weak" title={binPath}>
                  {binPath ?? t('settings.cliStatus.noPath')}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {!rowDetecting && canInstall ? (
                  <Button size="sm" disabled={s.busy} onClick={() => void installOne(id)}>
                    {s.busy ? t('onboarding.installBusy') : t('onboarding.installBtn')}
                  </Button>
                ) : null}
                {!rowDetecting && canLink ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={s.busy}
                    onClick={() => void linkOne(id, detected?.selectedPath)}
                  >
                    {s.busy ? t('onboarding.linkingBusy') : t('onboarding.useSystemBtn')}
                  </Button>
                ) : null}
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
              </div>
            </div>
          )
        })}
      </div>
    </StepShell>
  )
}

function ConfigStep({ editorRef }: { editorRef: RefObject<AgentConfigEditorHandle | null> }) {
  const t = useT()
  const [cliId, setCliId] = useState<CliId>('claude-code')
  const [cfg, setCfg] = useState<AppConfig | null>(null)

  useEffect(() => {
    window.api.config.get().then(setCfg)
  }, [])

  return (
    <StepShell title={t('onboarding.configTitle')} desc={t('onboarding.configDesc')}>
      <div className="mb-3 flex flex-wrap gap-1">
        {CLIS.map((cli) => (
          <button
            type="button"
            key={cli.id}
            onClick={() => setCliId(cli.id as CliId)}
            className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
              cliId === cli.id
                ? 'bg-[var(--button-primary-base)] text-[var(--button-primary-text)] shadow-[var(--shadow-sm)]'
                : 'text-text-base hover:bg-surface-weak'
            }`}
          >
            {cli.name}
          </button>
        ))}
      </div>

      {cfg ? (
        <AgentConfigEditor
          ref={editorRef}
          key={cliId}
          cliId={cliId}
          cli={cfg.clis[cliId]}
          onConfigChange={setCfg}
        />
      ) : (
        <div className="text-[13px] text-text-weak">{t('common.loading')}</div>
      )}
    </StepShell>
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
