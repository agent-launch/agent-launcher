import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Blocks, FolderCog, Pencil, Plus, Server, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Markdown } from '@/components/ui/Markdown'
import { Modal } from '@/components/ui/Modal'
import { PROVIDERS_BY_CLI } from '@/data/providers'
import { useT } from '@/i18n'
import type {
  AppConfig,
  CliId,
  CliProfile,
  InstalledMcpEntry,
  InstalledSkillEntry
} from '@shared/types'

interface NativeFiles {
  dir: string
  files: { name: string; content: string }[]
}

type ConfigTab = 'profiles' | 'mcp' | 'skills'

export function ConfigView({ cliId }: { cliId: CliId }) {
  const t = useT()
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [nativeFiles, setNativeFiles] = useState<NativeFiles | null>(null)
  const [mcpEntries, setMcpEntries] = useState<InstalledMcpEntry[]>([])
  const [skillEntries, setSkillEntries] = useState<InstalledSkillEntry[]>([])
  const [tab, setTab] = useState<ConfigTab>('profiles')
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [nextCfg, nextNativeFiles, nextMcpEntries, nextSkillEntries] = await Promise.all([
      window.api.config.get(),
      window.api.config.nativeFiles(cliId),
      window.api.resources.listMcp(cliId),
      window.api.resources.listSkills(cliId)
    ])
    setCfg(nextCfg)
    setNativeFiles(nextNativeFiles)
    setMcpEntries(nextMcpEntries)
    setSkillEntries(nextSkillEntries)
  }, [cliId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    setAdding(false)
    setEditId(null)
    setDeleteId(null)
  }, [cliId])

  if (!cfg) {
    return (
      <div className="mx-auto w-full max-w-[980px] px-7 py-6 text-[13px] text-text-weak">
        {t('common.loading')}
      </div>
    )
  }

  const cli = cfg.clis[cliId]
  const activeId = cli.activeProfileId

  const setActive = async (pid: string) => {
    await window.api.config.setActiveProfile(cliId, pid)
    refresh()
  }
  const remove = async (pid: string) => {
    await window.api.config.deleteProfile(cliId, pid)
    setDeleteId(null)
    refresh()
  }

  const deletingProfile = cli.profiles.find((p) => p.id === deleteId)

  return (
    <div className="mx-auto w-full max-w-[980px] px-7 py-6">
      <div className="mb-1">
        <h2 className="font-display text-[18px] font-semibold text-text-strong">{t('config.title')}</h2>
      </div>
      <p className="mb-6 text-[13px] leading-relaxed text-text-weak">{t('config.intro', { cliId })}</p>

      <div className="mb-5 flex w-fit rounded-md border border-border-weak bg-surface/70 p-0.5 shadow-[0_1px_1px_rgba(0,0,0,0.04)]">
        <ConfigTabButton active={tab === 'profiles'} icon={<FolderCog size={14} />} onClick={() => setTab('profiles')}>
          {t('config.tabProfiles')}
        </ConfigTabButton>
        <ConfigTabButton active={tab === 'mcp'} icon={<Server size={14} />} onClick={() => setTab('mcp')}>
          {t('config.tabMcp')}
        </ConfigTabButton>
        <ConfigTabButton active={tab === 'skills'} icon={<Sparkles size={14} />} onClick={() => setTab('skills')}>
          {t('config.tabSkills')}
        </ConfigTabButton>
      </div>

      {tab === 'profiles' && (
        <>
          <div className="space-y-2">
            {cli.profiles.length === 0 && (
              <div className="rounded-xl border border-dashed border-border-weak bg-surface/72 shadow-[var(--shadow-sm)] px-4 py-7 text-center text-[13px] text-text-weak">
                {t('config.noProfiles')}
              </div>
            )}
            {cli.profiles.map((p) =>
              editId === p.id ? (
                <ProfileForm
                  key={p.id}
                  cliId={cliId}
                  initial={p}
                  onCancel={() => setEditId(null)}
                  onDone={() => {
                    setEditId(null)
                    refresh()
                  }}
                />
              ) : (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActive(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setActive(p.id)
                    }
                  }}
                  className={`flex items-center gap-3 rounded-xl border bg-surface/92 px-4 py-3 shadow-[var(--shadow-sm)] ${
                    activeId === p.id ? 'border-border-selected bg-surface shadow-[var(--shadow-card)]' : 'border-border-weak'
                  } cursor-pointer transition-[background,border-color,box-shadow] hover:border-border-selected/70 hover:bg-surface`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setActive(p.id)
                    }}
                    className="grid size-5 shrink-0 place-items-center rounded-full border"
                    style={{
                      borderColor: activeId === p.id ? 'var(--accent)' : 'var(--border-base)'
                    }}
                    title={t('config.setActive')}
                  >
                    {activeId === p.id && (
                      <span className="size-2.5 rounded-full" style={{ background: 'var(--accent)' }} />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[14px] text-text-strong">
                      {p.name}
                      {activeId === p.id && (
                        <span className="rounded-full bg-surface-weak px-2 py-0.5 text-[11px] text-success">
                          {t('config.active')}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[12px] text-text-weak">
                      {p.baseUrl || t('config.officialDefault')} {p.model ? `· ${p.model}` : ''}
                    </div>
                  </div>
                  <IconButton
                    title={t('common.edit')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditId(p.id)
                    }}
                  >
                    <Pencil size={13} />
                  </IconButton>
                  <IconButton
                    title={t('common.delete')}
                    danger
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteId(p.id)
                    }}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              )
            )}
          </div>

          {adding ? (
            <div className="mt-2">
              <ProfileForm
                cliId={cliId}
                onCancel={() => setAdding(false)}
                onDone={() => {
                  setAdding(false)
                  refresh()
                }}
              />
            </div>
          ) : (
            <Button className="mt-3" variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={13} />
              {t('config.addProfile')}
            </Button>
          )}

          <Modal open={!!deletingProfile} onClose={() => setDeleteId(null)} title={t('config.deleteProfileTitle')}>
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
                onClick={() => {
                  if (deletingProfile) remove(deletingProfile.id)
                }}
              >
                {t('common.delete')}
              </Button>
            </div>
          </Modal>

          {nativeFiles && nativeFiles.files.length > 0 && (
            <div className="mt-8">
              <div className="mb-2">
                <h3 className="text-[14px] font-medium text-text-strong">{t('config.nativeFiles')}</h3>
              </div>
              <p className="mb-3 text-[12px] text-text-weak">{t('config.nativeFilesDesc')}</p>
              <div className="space-y-3">
                {nativeFiles.files.map((f) => (
                  <FileBlock key={f.name} name={f.name} content={f.content} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'mcp' && (
        <McpPanel entries={mcpEntries} />
      )}
      {tab === 'skills' && (
        <SkillsPanel entries={skillEntries} />
      )}
    </div>
  )
}

function ConfigTabButton({
  active,
  icon,
  children,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[13px] transition-colors ${
        active
          ? 'bg-[var(--button-primary-base)] text-[var(--button-primary-text)] shadow-[var(--shadow-sm)]'
          : 'text-text-weak hover:text-text-strong'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function IconButton({
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

function PanelHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-[14px] font-medium text-text-strong">{title}</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-text-weak">{desc}</p>
      </div>
    </div>
  )
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border-weak bg-surface/72 shadow-[var(--shadow-sm)] px-4 py-8 text-center text-[13px] text-text-weak">
      {children}
    </div>
  )
}

function LocalSearch({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="selectable mb-4 h-9 w-full rounded-md border border-border-weak bg-surface px-3 text-[13px] text-text-strong outline-none focus:border-border-selected"
    />
  )
}

function McpPanel({ entries }: { entries: InstalledMcpEntry[] }) {
  const t = useT()
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((entry) =>
      [entry.name, entry.command, entry.args, entry.url, entry.env, entry.configPath].some((value) =>
        value?.toLowerCase().includes(q)
      )
    )
  }, [entries, filter])

  return (
    <section className="rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] p-4">
      <PanelHeader title={t('config.mcpTitle')} desc={t('config.mcpDesc')} />
      <LocalSearch value={filter} onChange={setFilter} placeholder={t('config.localMcpSearchPlaceholder')} />
      {entries.length === 0 ? (
        <EmptyPanel>{t('config.noMcp')}</EmptyPanel>
      ) : filtered.length === 0 ? (
        <EmptyPanel>{t('config.noResourceMatches')}</EmptyPanel>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <ResourceRow
              key={entry.id}
              icon={<Server size={15} />}
              title={entry.name}
              detail={entry.transport === 'stdio' ? [entry.command, entry.args].filter(Boolean).join(' ') || '-' : entry.url || '-'}
              meta={entry.transport.toUpperCase()}
              notes={entry.configPath}
              statusLabel={entry.supportsEnabled ? (entry.enabled ? t('config.enabled') : t('config.disabled')) : undefined}
              statusTone={entry.enabled ? 'success' : 'muted'}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function SkillsPanel({ entries }: { entries: InstalledSkillEntry[] }) {
  const t = useT()
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((entry) =>
      [entry.name, entry.description, entry.source, entry.dir, entry.path].some((value) =>
        value?.toLowerCase().includes(q)
      )
    )
  }, [entries, filter])

  return (
    <section className="rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] p-4">
      <PanelHeader
        title={t('config.skillsTitle')}
        desc={t('config.skillsDesc')}
      />
      <LocalSearch value={filter} onChange={setFilter} placeholder={t('config.localSkillSearchPlaceholder')} />
      {entries.length === 0 ? (
        <EmptyPanel>{t('config.noSkills')}</EmptyPanel>
      ) : filtered.length === 0 ? (
        <EmptyPanel>{t('config.noResourceMatches')}</EmptyPanel>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <ResourceRow
              key={entry.id}
              icon={<Blocks size={15} />}
              title={entry.name}
              detail={entry.source || entry.dir}
              meta={entry.provider === 'skills.sh' ? 'skills.sh' : 'Skill'}
              notes={entry.description || entry.path}
              statusLabel={entry.enabled ? t('config.enabled') : t('config.disabled')}
              statusTone={entry.enabled ? 'success' : 'muted'}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ResourceRow({
  icon,
  title,
  detail,
  meta,
  notes,
  statusLabel,
  statusTone = 'muted'
}: {
  icon: React.ReactNode
  title: string
  detail: string
  meta: string
  notes?: string
  statusLabel?: string
  statusTone?: 'success' | 'muted'
}) {
  return (
    <div className="rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] px-3 py-3">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-text-strong">
            {title}
            <span className="rounded-full bg-surface-weak px-2 py-0.5 text-[11px] text-text-weak">{meta}</span>
            {statusLabel && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  statusTone === 'success' ? 'bg-success/10 text-success' : 'bg-surface-weak text-text-weak'
                }`}
              >
                {statusLabel}
              </span>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-text-weak">{detail}</div>
          {notes && <div className="mt-1 truncate text-[11px] text-text-weak">{notes}</div>}
        </div>
      </div>
    </div>
  )
}

function FileBlock({ name, content }: { name: string; content: string }) {
  const lang = languageForFile(name)
  return (
    <div className="overflow-hidden rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)]">
      <div className="border-b border-border-weak px-3 py-1.5 font-mono text-[11px] text-text-weak">
        {name}
      </div>
      <Markdown className="config-code selectable">{codeFence(content, lang)}</Markdown>
    </div>
  )
}

function languageForFile(name: string): string {
  if (name.endsWith('.json')) return 'json'
  if (name.endsWith('.toml')) return 'ini'
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'yaml'
  return 'text'
}

function codeFence(content: string, lang: string): string {
  const ticks = content.match(/`{3,}/g)
  const fenceLength = ticks ? Math.max(3, ...ticks.map((x) => x.length + 1)) : 3
  const fence = '`'.repeat(fenceLength)
  return `${fence}${lang}\n${content.trimEnd()}\n${fence}`
}

function ProfileForm({
  cliId,
  initial,
  onCancel,
  onDone
}: {
  cliId: CliId
  initial?: CliProfile
  onCancel: () => void
  onDone: () => void
}) {
  const t = useT()
  const providers = PROVIDERS_BY_CLI[cliId]
  const [providerId, setProviderId] = useState(initial?.providerId ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')
  const [model, setModel] = useState(initial?.model ?? '')

  const onProvider = (id: string) => {
    setProviderId(id)
    const p = providers.find((x) => x.id === id)
    if (p) {
      setBaseUrl(p.baseUrl)
      if (!name || !initial) setName(p.name)
    }
  }

  const submit = async () => {
    const nextName = name.trim()
    const nextProviderId = providerId.trim()
    const nextBaseUrl = baseUrl.trim()
    const nextApiKey = apiKey.trim()
    const nextModel = model.trim()
    const hasPresetProvider = Boolean(nextProviderId && nextProviderId !== 'custom')
    const hasManualConfig = Boolean(nextBaseUrl || nextApiKey || nextModel)

    if (!initial && !hasPresetProvider && !hasManualConfig) {
      toast.error(t('config.emptyProfileToast'))
      return
    }

    const patch = {
      name: nextName || '未命名',
      providerId: nextProviderId || undefined,
      baseUrl: nextBaseUrl,
      apiKey: nextApiKey,
      model: nextModel
    }
    if (initial) await window.api.config.updateProfile(cliId, initial.id, patch)
    else {
      const cfg = await window.api.config.addProfile(cliId, patch)
      const active = cfg.clis[cliId].activeProfileId
      if (active) await window.api.config.setActiveProfile(cliId, active)
    }
    onDone()
  }

  return (
    <div className="rounded-xl border border-border-selected bg-surface/95 p-4 shadow-[var(--shadow-card)]">
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block">
          <span className="text-[12px] text-text-weak">{t('config.provider')}</span>
          <select
            value={providerId}
            onChange={(e) => onProvider(e.target.value)}
            className="mt-1 w-full rounded-md border border-border-weak bg-surface px-2 py-2 text-[13px] text-text-strong outline-none focus:border-border-selected"
          >
            <option value="">{t('config.selectPlaceholder')}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {t('category.' + p.category)}
              </option>
            ))}
          </select>
        </label>
        <Field
          label={t('config.profileName')}
          value={name}
          onChange={setName}
          placeholder={t('config.profileNamePlaceholder')}
        />
        <Field
          label={t('config.modelOptional')}
          value={model}
          onChange={setModel}
          placeholder={t('config.modelPlaceholder')}
        />
        <label className="col-span-2 block">
          <span className="text-[12px] text-text-weak">Base URL</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://..."
            className="selectable mt-1 w-full rounded-md border border-border-weak bg-surface px-3 py-2 text-[13px] text-text-strong outline-none focus:border-border-selected"
          />
        </label>
        <label className="col-span-2 block">
          <span className="text-[12px] text-text-weak">API Key</span>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type="password"
            placeholder="sk-..."
            className="selectable mt-1 w-full rounded-md border border-border-weak bg-surface px-3 py-2 text-[13px] text-text-strong outline-none focus:border-border-selected"
          />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit}>
          {initial ? t('common.save') : t('common.add')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-text-weak">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="selectable mt-1 w-full rounded-md border border-border-weak bg-surface px-3 py-2 text-[13px] text-text-strong outline-none focus:border-border-selected"
      />
    </label>
  )
}
