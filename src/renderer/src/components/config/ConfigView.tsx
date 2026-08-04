import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Blocks, FolderCog, Server, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Markdown } from '@/components/ui/Markdown'
import { useT } from '@/i18n'
import { AgentConfigEditor } from './AgentConfigEditor'
import type {
  AppConfig,
  CliId,
  InstalledMcpEntry,
  InstalledSkillEntry,
  InstalledSkillFile,
  NativeFiles
} from '@shared/types'

type ConfigTab = 'profiles' | 'mcp' | 'skills'

export function ConfigView({ cliId, onBack }: { cliId: CliId; onBack?: () => void }) {
  const t = useT()
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [nativeFiles, setNativeFiles] = useState<NativeFiles | null>(null)
  const [mcpEntries, setMcpEntries] = useState<InstalledMcpEntry[]>([])
  const [skillEntries, setSkillEntries] = useState<InstalledSkillEntry[]>([])
  const [tab, setTab] = useState<ConfigTab>('profiles')

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

  const refreshNativeFiles = useCallback(async () => {
    setNativeFiles(await window.api.config.nativeFiles(cliId))
  }, [cliId])

  const applyConfigMutation = useCallback(
    async (nextCfg: AppConfig) => {
      setCfg(nextCfg)
      await refreshNativeFiles()
    },
    [refreshNativeFiles]
  )

  if (!cfg) {
    return (
      <div className="mx-auto w-full max-w-[980px] px-7 py-6">
        {onBack && (
          <Button className="mb-5" size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft size={13} />
            {t('config.backToSessions')}
          </Button>
        )}
        <div className="text-[13px] text-text-weak">{t('common.loading')}</div>
      </div>
    )
  }

  const cli = cfg.clis[cliId]

  return (
    <div className="mx-auto w-full max-w-[980px] px-7 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          {onBack && (
            <Button className="-ml-2 mb-3" size="sm" variant="ghost" onClick={onBack}>
              <ArrowLeft size={13} />
              {t('config.backToSessions')}
            </Button>
          )}
          <h2 className="font-display text-[28px] font-bold leading-tight text-text-strong">
            {t('config.title')}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-text-weak">
            {t('config.intro', { cliId })}
          </p>
        </div>
      </div>

      <div className="mb-5 flex w-fit rounded-md border border-border-weak bg-surface/70 p-0.5 shadow-[0_1px_1px_rgba(0,0,0,0.04)]">
        <ConfigTabButton
          active={tab === 'profiles'}
          icon={<FolderCog size={14} />}
          onClick={() => setTab('profiles')}
        >
          {t('config.tabProfiles')}
        </ConfigTabButton>
        <ConfigTabButton
          active={tab === 'mcp'}
          icon={<Server size={14} />}
          onClick={() => setTab('mcp')}
        >
          {t('config.tabMcp')}
        </ConfigTabButton>
        <ConfigTabButton
          active={tab === 'skills'}
          icon={<Sparkles size={14} />}
          onClick={() => setTab('skills')}
        >
          {t('config.tabSkills')}
        </ConfigTabButton>
      </div>

      {tab === 'profiles' && (
        <>
          <AgentConfigEditor
            key={cliId}
            cliId={cliId}
            cli={cli}
            modal
            onConfigChange={applyConfigMutation}
          />

          {nativeFiles && nativeFiles.files.length > 0 && (
            <div className="mt-8">
              <div className="mb-2">
                <h3 className="text-[14px] font-medium text-text-strong">
                  {t('config.nativeFiles')}
                </h3>
              </div>
              <p className="mb-3 text-[12px] text-text-weak">{t('config.nativeFilesDesc')}</p>
              <div className="space-y-3">
                {nativeFiles.files.map((file) => (
                  <FileBlock key={file.name} name={file.name} content={file.content} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {tab === 'mcp' && <McpPanel entries={mcpEntries} />}
      {tab === 'skills' && <SkillsPanel cliId={cliId} entries={skillEntries} />}
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
  // Read-only (plugin-bundled) entries sort after user-managed ones.
  const ordered = useMemo(
    () => [...entries].sort((a, b) => Number(a.readOnly ?? 0) - Number(b.readOnly ?? 0)),
    [entries]
  )
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return ordered
    return ordered.filter((entry) =>
      [entry.name, entry.command, entry.args, entry.url, entry.env, entry.configPath].some(
        (value) => value?.toLowerCase().includes(q)
      )
    )
  }, [ordered, filter])

  return (
    <section className="rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] p-4">
      <PanelHeader title={t('config.mcpTitle')} desc={t('config.mcpDesc')} />
      <LocalSearch
        value={filter}
        onChange={setFilter}
        placeholder={t('config.localMcpSearchPlaceholder')}
      />
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
              detail={
                entry.transport === 'stdio'
                  ? [entry.command, entry.args].filter(Boolean).join(' ') || '-'
                  : entry.url || '-'
              }
              meta={entry.readOnly ? t('config.mcpPlugin') : entry.transport.toUpperCase()}
              notes={entry.configPath}
              statusLabel={
                entry.readOnly
                  ? undefined
                  : entry.supportsEnabled
                    ? entry.enabled
                      ? t('config.enabled')
                      : t('config.disabled')
                    : undefined
              }
              statusTone={entry.enabled ? 'success' : 'muted'}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function SkillsPanel({ cliId, entries }: { cliId: CliId; entries: InstalledSkillEntry[] }) {
  const t = useT()
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<InstalledSkillEntry | null>(null)
  const [skillFile, setSkillFile] = useState<InstalledSkillFile | null>(null)
  const [loadingSource, setLoadingSource] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((entry) =>
      [entry.name, entry.description, entry.source, entry.dir, entry.path].some((value) =>
        value?.toLowerCase().includes(q)
      )
    )
  }, [entries, filter])

  useEffect(() => {
    setSelected(null)
    setSkillFile(null)
    setSourceError(null)
    setLoadingSource(false)
  }, [cliId])

  const openSkill = async (entry: InstalledSkillEntry) => {
    setSelected(entry)
    setSkillFile(null)
    setSourceError(null)
    setLoadingSource(true)
    try {
      setSkillFile(await window.api.resources.readSkill(cliId, entry.id))
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingSource(false)
    }
  }

  if (selected) {
    return (
      <section className="rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] p-4">
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 mb-3"
          onClick={() => {
            setSelected(null)
            setSkillFile(null)
            setSourceError(null)
          }}
        >
          <ArrowLeft size={13} />
          {t('config.backToSkills')}
        </Button>
        <div className="mb-4">
          <h3 className="text-[14px] font-medium text-text-strong">{selected.name}</h3>
          <p className="mt-1 truncate font-mono text-[11px] text-text-weak">
            {skillFile?.path ?? selected.path}
          </p>
        </div>
        {loadingSource ? (
          <div className="rounded-xl border border-border-weak bg-surface/72 px-4 py-8 text-center text-[13px] text-text-weak">
            {t('common.loading')}
          </div>
        ) : sourceError ? (
          <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
            {sourceError}
          </div>
        ) : skillFile ? (
          <FileBlock name="SKILL.md" content={skillFile.content} />
        ) : null}
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] p-4">
      <PanelHeader title={t('config.skillsTitle')} desc={t('config.skillsDesc')} />
      <LocalSearch
        value={filter}
        onChange={setFilter}
        placeholder={t('config.localSkillSearchPlaceholder')}
      />
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
              onClick={() => openSkill(entry)}
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
  statusTone = 'muted',
  onClick
}: {
  icon: React.ReactNode
  title: string
  detail: string
  meta: string
  notes?: string
  statusLabel?: string
  statusTone?: 'success' | 'muted'
  onClick?: () => void
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onClick()
      }}
      className={`rounded-xl border border-border-weak bg-surface/92 shadow-[var(--shadow-sm)] px-3 py-3 ${
        onClick
          ? 'cursor-pointer transition-[background,border-color,box-shadow] hover:border-border-base hover:bg-surface hover:shadow-[var(--shadow-card)]'
          : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-text-strong">
            {title}
            <span className="rounded-full bg-surface-weak px-2 py-0.5 text-[11px] text-text-weak">
              {meta}
            </span>
            {statusLabel && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  statusTone === 'success'
                    ? 'bg-success/10 text-success'
                    : 'bg-surface-weak text-text-weak'
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
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown'
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
