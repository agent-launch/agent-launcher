import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { CliIcon } from '@/components/CliIcon'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PROVIDERS_BY_CLI } from '@/data/providers'
import { useT } from '@/i18n'
import { ModelCombobox } from './ModelCombobox'
import { ProfileConnectionTest } from './ProfileConnectionTest'
import type {
  AppConfig,
  AuthStatus,
  CliId,
  CliProfile,
  CliProfiles,
  ModelDiscoveryRequest
} from '@shared/types'

export interface AgentConfigEditorHandle {
  save: () => Promise<boolean>
}

interface AgentConfigEditorProps {
  cliId: CliId
  cli: CliProfiles
  modal?: boolean
  onConfigChange: (cfg: AppConfig) => void | Promise<void>
}

type ConfigMode = 'official' | 'api'

export const AgentConfigEditor = forwardRef<AgentConfigEditorHandle, AgentConfigEditorProps>(
  function AgentConfigEditor({ cliId, cli, modal = false, onConfigChange }, ref) {
    const t = useT()
    const providers = PROVIDERS_BY_CLI[cliId]
    const supportsOfficial = cliId === 'claude-code' || cliId === 'codex'
    const initialProfile = cli.profiles.find((profile) => profile.id === cli.activeProfileId)
    const initialOfficial =
      initialProfile?.providerId === 'official' && !initialProfile.baseUrl && !initialProfile.apiKey
    const initialProviderId = providers.some(
      (provider) => provider.id === initialProfile?.providerId
    )
      ? initialProfile?.providerId
      : 'custom'
    const [mode, setMode] = useState<ConfigMode>(
      (initialProfile ? initialOfficial && supportsOfficial : supportsOfficial) ? 'official' : 'api'
    )
    const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
      initialProfile?.id ?? null
    )
    const [providerId, setProviderId] = useState(initialProviderId ?? providers[0]?.id ?? '')
    const [name, setName] = useState(initialProfile?.name ?? '')
    const [baseUrl, setBaseUrl] = useState(initialProfile?.baseUrl ?? providers[0]?.baseUrl ?? '')
    const [apiKey, setApiKey] = useState(initialProfile?.apiKey ?? '')
    const [model, setModel] = useState(initialProfile?.model ?? initialProfile?.defaultModel ?? '')
    const [defaultModel, setDefaultModel] = useState(
      initialProfile?.defaultModel ?? initialProfile?.model ?? ''
    )
    const [sonnetModel, setSonnetModel] = useState(
      initialProfile?.sonnetModel ?? initialProfile?.model ?? ''
    )
    const [opusModel, setOpusModel] = useState(
      initialProfile?.opusModel ?? initialProfile?.model ?? ''
    )
    const [haikuModel, setHaikuModel] = useState(
      initialProfile?.haikuModel ?? initialProfile?.model ?? ''
    )
    const [saving, setSaving] = useState(false)
    const [editorOpen, setEditorOpen] = useState(false)
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [status, setStatus] = useState<AuthStatus>()
    const [authBusy, setAuthBusy] = useState(false)
    const [authLog, setAuthLog] = useState('')
    const [activeAuthId, setActiveAuthId] = useState<string | null>(null)
    const [authInput, setAuthInput] = useState('')

    const selectedProfile = useMemo(
      () => cli.profiles.find((profile) => profile.id === selectedProfileId),
      [cli.profiles, selectedProfileId]
    )
    const selectedProvider = useMemo(
      () => providers.find((provider) => provider.id === providerId),
      [providerId, providers]
    )
    const discoveryRequest = useMemo(
      () => ({ baseUrl, apiKey, modelsUrl: selectedProvider?.modelsUrl }),
      [baseUrl, apiKey, selectedProvider?.modelsUrl]
    )

    const setDraftFromProfile = useCallback(
      (profile: CliProfile) => {
        const official = profile.providerId === 'official' && !profile.baseUrl && !profile.apiKey
        setSelectedProfileId(profile.id)
        setMode(official && supportsOfficial ? 'official' : 'api')
        setProviderId(
          providers.some((provider) => provider.id === profile.providerId)
            ? (profile.providerId ?? 'custom')
            : 'custom'
        )
        setName(profile.name)
        setBaseUrl(profile.baseUrl ?? '')
        setApiKey(profile.apiKey ?? '')
        setModel(profile.model ?? profile.defaultModel ?? '')
        setDefaultModel(profile.defaultModel ?? profile.model ?? '')
        setSonnetModel(profile.sonnetModel ?? profile.model ?? '')
        setOpusModel(profile.opusModel ?? profile.model ?? '')
        setHaikuModel(profile.haikuModel ?? profile.model ?? '')
      },
      [providers, supportsOfficial]
    )

    const resetDraft = useCallback(() => {
      const first = providers[0]
      setSelectedProfileId(null)
      setMode(supportsOfficial ? 'official' : 'api')
      setProviderId(first?.id ?? '')
      setName('')
      setBaseUrl(first?.baseUrl ?? '')
      setApiKey('')
      setModel('')
      setDefaultModel('')
      setSonnetModel('')
      setOpusModel('')
      setHaikuModel('')
    }, [providers, supportsOfficial])

    useEffect(() => {
      if (selectedProfileId && !selectedProfile) resetDraft()
    }, [resetDraft, selectedProfile, selectedProfileId])

    const refreshStatus = useCallback(async () => {
      setStatus(await window.api.auth.status(cliId))
    }, [cliId])

    useEffect(() => {
      if (cliId === 'claude-code') void refreshStatus()
    }, [cliId, refreshStatus])

    useEffect(() => {
      const offData = window.api.auth.onData((_id, owner, data) => {
        if (owner === cliId) setAuthLog((previous) => `${previous}${data}`.slice(-4000))
      })
      const offExit = window.api.auth.onExit((id, owner, code) => {
        if (owner !== cliId) return
        setAuthBusy(false)
        setAuthLog((previous) => `${previous}\n[exit ${code}]\n`)
        if (id === activeAuthId) setActiveAuthId(null)
        void refreshStatus()
      })
      return () => {
        offData()
        offExit()
      }
    }, [activeAuthId, cliId, refreshStatus])

    const selectProvider = (id: string) => {
      const provider = providers.find((item) => item.id === id)
      const official = provider?.category === 'official' && supportsOfficial
      const selectedIsOfficial =
        selectedProfile?.providerId === 'official' &&
        !selectedProfile.baseUrl &&
        !selectedProfile.apiKey
      const detachFromSelected = Boolean(selectedProfile && official !== selectedIsOfficial)
      if (detachFromSelected) setSelectedProfileId(null)
      setMode(official ? 'official' : 'api')
      setProviderId(id)
      if (detachFromSelected || !selectedProfile) setName(provider?.name ?? '')
      setBaseUrl(provider?.baseUrl ?? '')
      setApiKey('')
      setModel('')
      setDefaultModel('')
      setSonnetModel('')
      setOpusModel('')
      setHaikuModel('')
    }

    const selectExisting = async (profile: CliProfile) => {
      setDraftFromProfile(profile)
      if (profile.id !== cli.activeProfileId) {
        await onConfigChange(await window.api.config.setActiveProfile(cliId, profile.id))
      }
    }

    const save = useCallback(async (): Promise<boolean> => {
      if (saving) return false
      const isOfficialProvider = mode === 'official' && supportsOfficial
      const nextProviderId = isOfficialProvider ? 'official' : providerId
      const provider = providers.find((item) => item.id === nextProviderId)
      const nextBaseUrl = baseUrl.trim()
      const nextApiKey = isOfficialProvider ? '' : apiKey.trim()
      const isClaude = cliId === 'claude-code'
      const nextModel = isClaude ? defaultModel.trim() : model.trim()

      if (!isOfficialProvider && !nextBaseUrl) {
        toast.error(t('config.baseUrlRequiredToast'))
        return false
      }
      if (!isOfficialProvider && !nextApiKey) {
        toast.error(t('config.apiKeyRequiredToast'))
        return false
      }
      if (!isOfficialProvider && !nextModel) {
        toast.error(t('config.modelRequiredToast'))
        return false
      }

      setSaving(true)
      try {
        const patch = {
          name: name.trim() || selectedProfile?.name || provider?.name || t('category.custom'),
          providerId: nextProviderId,
          baseUrl: isOfficialProvider ? '' : nextBaseUrl,
          apiKey: nextApiKey,
          model: nextModel,
          defaultModel: isClaude ? nextModel : undefined,
          sonnetModel: isClaude ? sonnetModel.trim() : undefined,
          opusModel: isClaude ? opusModel.trim() : undefined,
          haikuModel: isClaude ? haikuModel.trim() : undefined
        }
        let nextCfg: AppConfig
        let nextProfileId = selectedProfileId
        if (selectedProfileId) {
          nextCfg = await window.api.config.updateProfile(cliId, selectedProfileId, patch)
        } else {
          nextCfg = await window.api.config.addProfile(cliId, patch)
          nextProfileId = nextCfg.clis[cliId].activeProfileId ?? null
        }
        if (nextProfileId) {
          nextCfg = await window.api.config.setActiveProfile(cliId, nextProfileId)
          setSelectedProfileId(nextProfileId)
        }
        await onConfigChange(nextCfg)
        if (modal) setEditorOpen(false)
        return true
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        setSaving(false)
      }
    }, [
      apiKey,
      baseUrl,
      cliId,
      defaultModel,
      haikuModel,
      mode,
      modal,
      model,
      name,
      onConfigChange,
      opusModel,
      providerId,
      providers,
      saving,
      selectedProfile,
      selectedProfileId,
      sonnetModel,
      supportsOfficial,
      t
    ])

    useImperativeHandle(ref, () => ({ save }), [save])

    const remove = async () => {
      if (!deleteId) return
      const nextCfg = await window.api.config.deleteProfile(cliId, deleteId)
      setDeleteId(null)
      await onConfigChange(nextCfg)
      if (selectedProfileId === deleteId) resetDraft()
    }

    const startLogin = async (method: 'official' | 'device' = 'official') => {
      setMode('official')
      setAuthBusy(true)
      setAuthLog('')
      try {
        setActiveAuthId(await window.api.auth.startLogin(cliId, method))
      } catch (error) {
        setAuthBusy(false)
        setAuthLog(error instanceof Error ? error.message : String(error))
      }
    }

    const sendAuthInput = () => {
      if (!activeAuthId || !authInput) return
      window.api.auth.write(activeAuthId, `${authInput}\n`)
      setAuthInput('')
    }

    const cancelLogin = () => {
      if (!activeAuthId) return
      window.api.auth.stop(activeAuthId)
      setAuthBusy(false)
      setAuthLog((previous) => `${previous}\n[cancelled]\n`)
      setActiveAuthId(null)
    }

    const openNew = () => {
      resetDraft()
      setEditorOpen(true)
    }

    const openEdit = (profile: CliProfile) => {
      setDraftFromProfile(profile)
      setEditorOpen(true)
    }

    const closeEditor = () => {
      if (activeAuthId) cancelLogin()
      const active = cli.profiles.find((profile) => profile.id === cli.activeProfileId)
      if (active) setDraftFromProfile(active)
      else resetDraft()
      setEditorOpen(false)
    }

    const deletingProfile = cli.profiles.find((profile) => profile.id === deleteId)

    return (
      <div>
        {cli.profiles.length > 0 ? (
          <div className="space-y-2">
            {cli.profiles.map((profile) => {
              const active = cli.activeProfileId === profile.id
              const selected = selectedProfileId === profile.id
              return (
                <div
                  key={profile.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void selectExisting(profile)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    void selectExisting(profile)
                  }}
                  className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border bg-surface/92 px-4 py-3 shadow-[var(--shadow-sm)] transition-[background,border-color,box-shadow] hover:border-border-selected/70 hover:bg-surface ${
                    selected
                      ? 'border-border-selected bg-surface shadow-[var(--shadow-card)]'
                      : 'border-border-weak'
                  }`}
                >
                  <span
                    className="grid size-5 shrink-0 place-items-center rounded-full border"
                    style={{ borderColor: active ? 'var(--accent)' : 'var(--border-base)' }}
                    aria-label={active ? t('config.active') : t('config.setActive')}
                  >
                    {active && (
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: 'var(--accent)' }}
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[14px] text-text-strong">
                      <span className="truncate font-medium">{profile.name}</span>
                      {active && (
                        <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">
                          {t('config.active')}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-text-weak">
                      {profile.baseUrl || t('config.officialDefault')}
                      {(profile.model || profile.defaultModel) &&
                        ` · ${profile.model || profile.defaultModel}`}
                    </div>
                  </div>
                  <EditorIconButton
                    title={t('common.edit')}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (modal) openEdit(profile)
                      else void selectExisting(profile)
                    }}
                  >
                    <Pencil size={13} />
                  </EditorIconButton>
                  <EditorIconButton
                    danger
                    title={t('common.delete')}
                    onClick={(event) => {
                      event.stopPropagation()
                      setDeleteId(profile.id)
                    }}
                  >
                    <Trash2 size={13} />
                  </EditorIconButton>
                </div>
              )
            })}
          </div>
        ) : modal ? (
          <div className="rounded-lg border border-dashed border-border-weak bg-surface/72 px-4 py-7 text-center text-[13px] text-text-weak shadow-[var(--shadow-sm)]">
            {t('config.noProfiles')}
          </div>
        ) : null}

        {modal ? (
          <Button className="mt-3" variant="secondary" onClick={openNew}>
            <Plus size={13} />
            {t('config.addProfile')}
          </Button>
        ) : (
          cli.profiles.length > 0 && (
            <Button className="mt-2" size="sm" variant="ghost" onClick={resetDraft}>
              <Plus size={13} />
              {t('config.addProfile')}
            </Button>
          )
        )}

        <EditorSurface
          modal={modal}
          open={editorOpen}
          onClose={closeEditor}
          title={t(selectedProfileId ? 'config.editProfileTitle' : 'config.addProfile')}
          footer={
            modal ? (
              <>
                <Button variant="ghost" onClick={closeEditor}>
                  {t('common.cancel')}
                </Button>
                <Button disabled={saving} onClick={() => void save()}>
                  {t(selectedProfileId ? 'common.save' : 'common.add')}
                </Button>
              </>
            ) : undefined
          }
        >
          <div
            className={`grid grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 ${
              modal ? 'max-h-48' : 'max-h-64'
            }`}
          >
            {supportsOfficial && (
              <button
                type="button"
                onClick={() => selectProvider('official')}
                className={`min-h-16 rounded-lg border bg-surface/92 px-3 py-2.5 text-left shadow-[var(--shadow-sm)] transition-[background,border-color,box-shadow] ${
                  mode === 'official'
                    ? 'border-border-selected bg-surface shadow-[var(--shadow-card)]'
                    : 'border-border-weak hover:border-border-base hover:bg-surface'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-text-strong">
                    {t(
                      cliId === 'codex' ? 'onboarding.authCardCodex' : 'onboarding.authCardClaude'
                    )}
                  </span>
                  <span className="shrink-0 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                    {t('onboarding.authBadgeOfficial')}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-text-weak">
                  {t('onboarding.authOfficial')}
                </div>
              </button>
            )}
            {providers.map((provider) => (
              <button
                type="button"
                key={provider.id}
                onClick={() => selectProvider(provider.id)}
                className={`min-h-16 rounded-lg border bg-surface/92 px-3 py-2.5 text-left shadow-[var(--shadow-sm)] transition-[background,border-color,box-shadow] ${
                  (mode === 'api' && providerId === provider.id) ||
                  (mode === 'official' && provider.id === 'official')
                    ? 'border-border-selected bg-surface shadow-[var(--shadow-card)]'
                    : 'border-border-weak hover:border-border-base hover:bg-surface'
                }`}
              >
                <div className="truncate text-[13px] font-medium text-text-strong">
                  {provider.name}
                </div>
                <div className="mt-0.5 text-[11px] text-text-weak">
                  {t('category.' + provider.category)}
                </div>
              </button>
            ))}
          </div>

          {mode === 'official' && supportsOfficial ? (
            <OfficialAuthPanel
              authBusy={authBusy}
              authInput={authInput}
              authLog={authLog}
              canSend={!!activeAuthId}
              cliId={cliId}
              onCancel={cancelLogin}
              onCheck={() => void refreshStatus()}
              onInput={setAuthInput}
              onLogin={() => void startLogin()}
              onLoginDevice={() => void startLogin('device')}
              onSend={sendAuthInput}
              status={status}
              t={t}
            />
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[12px] text-text-weak">{t('config.profileName')}</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('config.profileNamePlaceholder')}
                  className="selectable mt-1 h-10 w-full rounded-md border border-border-weak bg-surface px-3 text-[13px] text-text-strong outline-none focus:border-border-selected"
                />
              </label>
              <label className="block">
                <span className="text-[12px] text-text-weak">Base URL</span>
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://..."
                  className="selectable mt-1 h-10 w-full rounded-md border border-border-weak bg-surface px-3 text-[13px] text-text-strong outline-none focus:border-border-selected"
                />
              </label>
              <label className="block">
                <span className="text-[12px] text-text-weak">API Key</span>
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  type="password"
                  placeholder="sk-..."
                  className="selectable mt-1 h-10 w-full rounded-md border border-border-weak bg-surface px-3 text-[13px] text-text-strong outline-none focus:border-border-selected"
                />
              </label>
              {cliId === 'claude-code' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ModelInput
                    cliId={cliId}
                    request={discoveryRequest}
                    label={t('config.claudeDefaultModel')}
                    onChange={setDefaultModel}
                    placeholder={t('config.claudeDefaultModelPlaceholder')}
                    value={defaultModel}
                  />
                  <ModelInput
                    cliId={cliId}
                    request={discoveryRequest}
                    label={t('config.claudeSonnetModel')}
                    onChange={setSonnetModel}
                    placeholder={t('config.claudeSonnetModelPlaceholder')}
                    value={sonnetModel}
                  />
                  <ModelInput
                    cliId={cliId}
                    request={discoveryRequest}
                    label={t('config.claudeOpusModel')}
                    onChange={setOpusModel}
                    placeholder={t('config.claudeOpusModelPlaceholder')}
                    value={opusModel}
                  />
                  <ModelInput
                    cliId={cliId}
                    request={discoveryRequest}
                    label={t('config.claudeHaikuModel')}
                    onChange={setHaikuModel}
                    placeholder={t('config.claudeHaikuModelPlaceholder')}
                    value={haikuModel}
                  />
                </div>
              ) : (
                <ModelInput
                  cliId={cliId}
                  request={discoveryRequest}
                  label={t('config.model')}
                  onChange={setModel}
                  placeholder={t('config.modelPlaceholder')}
                  value={model}
                />
              )}
              <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <ProfileConnectionTest
                  cliId={cliId}
                  profile={{
                    providerId,
                    baseUrl,
                    apiKey,
                    model: cliId === 'claude-code' ? defaultModel : model,
                    defaultModel: cliId === 'claude-code' ? defaultModel : undefined
                  }}
                />
                <span className="text-[11px] text-text-weak">
                  {t('config.connection.costNotice')}
                </span>
              </div>
            </div>
          )}
        </EditorSurface>

        <Modal
          open={!!deletingProfile}
          onClose={() => setDeleteId(null)}
          title={t('config.deleteProfileTitle')}
        >
          <p className="text-[13px] leading-relaxed text-text-weak">
            {t('config.deleteProfileMessage', { name: deletingProfile?.name ?? '' })}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDeleteId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              className="bg-danger text-white hover:brightness-110"
              onClick={() => void remove()}
            >
              {t('common.delete')}
            </Button>
          </div>
        </Modal>
      </div>
    )
  }
)

function ModelInput({
  cliId,
  request,
  label,
  onChange,
  placeholder,
  value
}: {
  cliId: CliId
  request: ModelDiscoveryRequest
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-text-weak">{label}</span>
      <div className="mt-1">
        <ModelCombobox
          cliId={cliId}
          request={request}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
        />
      </div>
    </label>
  )
}

function EditorSurface({
  modal,
  open,
  onClose,
  title,
  footer,
  children
}: {
  modal: boolean
  open: boolean
  onClose: () => void
  title: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  if (!modal) return <>{children}</>
  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer} size="wide">
      {children}
    </Modal>
  )
}

function EditorIconButton({
  children,
  title,
  danger,
  onClick
}: {
  children: React.ReactNode
  title: string
  danger?: boolean
  onClick: React.MouseEventHandler<HTMLButtonElement>
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid size-7 shrink-0 place-items-center rounded-[5px] transition-colors hover:bg-surface-hover ${
        danger ? 'text-text-muted hover:text-danger' : 'text-text-muted hover:text-text-strong'
      }`}
    >
      {children}
    </button>
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
  status,
  t
}: {
  authBusy: boolean
  authInput: string
  authLog: string
  canSend: boolean
  cliId: CliId
  onCancel: () => void
  onCheck: () => void
  onInput: (value: string) => void
  onLogin: () => void
  onLoginDevice: () => void
  onSend: () => void
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
    <div className="mt-4 rounded-lg border border-border-weak bg-surface/92 p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-md bg-surface-weak text-text-strong">
          <CliIcon cliId={cliId} size={18} />
        </span>
        <div className="min-w-44 flex-1">
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
              onChange={(event) => onInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSend()
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
    </div>
  )
}
