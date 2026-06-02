import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { PROVIDERS_BY_CLI, CATEGORY_LABEL } from '@/data/providers'
import type { AppConfig, CliId, CliProfile, EnvPair } from '@shared/types'

interface CodexFiles {
  dir: string
  configToml: string
  authJson: string
}

export function ConfigView({ cliId }: { cliId: CliId }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [env, setEnv] = useState<EnvPair[]>([])
  const [codexFiles, setCodexFiles] = useState<CodexFiles | null>(null)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setCfg(await window.api.config.get())
    setEnv(await window.api.config.resolvedEnv(cliId))
    setCodexFiles(cliId === 'codex' ? await window.api.codex.files() : null)
  }, [cliId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!cfg) return <div className="p-6 text-[13px] text-text-weak">加载中…</div>

  const cli = cfg.clis[cliId]
  const activeId = cli.activeProfileId

  const setActive = async (pid: string) => {
    await window.api.config.setActiveProfile(cliId, pid)
    refresh()
  }
  const remove = async (pid: string) => {
    await window.api.config.deleteProfile(cliId, pid)
    refresh()
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[18px] font-semibold text-text-strong">配置管理</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => window.api.config.reveal()}>
            在文件夹中显示
          </Button>
          <Button size="sm" variant="secondary" onClick={() => window.api.config.openFile()}>
            打开 config.json
          </Button>
        </div>
      </div>
      <p className="mb-5 text-[13px] text-text-weak">
        每个 CLI 可存多套配置，一键切换当前生效的那套。配置以明文 JSON 存在 ~/.agent-launcher/config.json。
      </p>

      {/* Profiles */}
      <div className="space-y-2">
        {cli.profiles.length === 0 && (
          <div className="rounded-lg border border-dashed border-border-weak px-4 py-6 text-center text-[13px] text-text-weak">
            还没有配置，点下方「新增配置」。
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
              className={`flex items-center gap-3 rounded-lg border bg-surface px-4 py-3 ${
                activeId === p.id ? 'border-border-selected' : 'border-border-weak'
              }`}
            >
              <button
                onClick={() => setActive(p.id)}
                className="grid size-5 shrink-0 place-items-center rounded-full border"
                style={{
                  borderColor: activeId === p.id ? 'var(--accent)' : 'var(--border-base)'
                }}
                title="设为当前生效"
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
                      生效中
                    </span>
                  )}
                </div>
                <div className="truncate text-[12px] text-text-weak">
                  {p.baseUrl || '官方默认'} {p.model ? `· ${p.model}` : ''}
                </div>
              </div>
              <button
                onClick={() => setEditId(p.id)}
                className="text-[12px] text-text-weak hover:text-text-strong"
              >
                编辑
              </button>
              <button
                onClick={() => remove(p.id)}
                className="text-[12px] text-text-weak hover:text-danger"
              >
                删除
              </button>
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
          + 新增配置
        </Button>
      )}

      {/* Resolved environment preview */}
      <div className="mt-8">
        <h3 className="mb-2 text-[14px] font-medium text-text-strong">Resolved Environment</h3>
        <p className="mb-3 text-[12px] text-text-weak">
          启动 {cliId} 时实际注入的环境变量（密钥已脱敏）。你永远不需要手动 export。
        </p>
        <div className="rounded-lg border border-border-weak bg-surface p-3 font-mono text-[12px]">
          {env.length === 0 ? (
            <span className="text-text-weak">（当前配置无注入项）</span>
          ) : (
            env.map((e) => (
              <div key={e.key} className="flex gap-2 py-0.5">
                <span style={{ color: 'var(--text-interactive-base)' }}>{e.key}</span>
                <span className="text-text-weak">=</span>
                <span className="truncate text-text-strong">{e.value}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Codex writes native config files into CODEX_HOME — show them. */}
      {cliId === 'codex' && codexFiles && (
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-text-strong">
              Codex 配置文件（CODEX_HOME）
            </h3>
            <Button size="sm" variant="ghost" onClick={() => window.api.codex.reveal()}>
              打开目录
            </Button>
          </div>
          <p className="mb-3 text-[12px] text-text-weak">
            Codex 不是只靠环境变量，而是从这个目录读 config.toml + auth.json。
            切换配置时这两个文件会自动写入：<span className="font-mono">{codexFiles.dir}</span>
          </p>
          <div className="space-y-3">
            <FileBlock name="config.toml" content={codexFiles.configToml} />
            <FileBlock name="auth.json" content={codexFiles.authJson} />
          </div>
        </div>
      )}
    </div>
  )
}

function FileBlock({ name, content }: { name: string; content: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-weak bg-surface">
      <div className="border-b border-border-weak px-3 py-1.5 font-mono text-[11px] text-text-weak">
        {name}
      </div>
      <pre className="selectable overflow-x-auto px-3 py-2 font-mono text-[12px] text-text-strong">
        {content}
      </pre>
    </div>
  )
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
    const patch = { name: name || '未命名', providerId, baseUrl, apiKey, model }
    if (initial) await window.api.config.updateProfile(cliId, initial.id, patch)
    else await window.api.config.addProfile(cliId, patch)
    onDone()
  }

  return (
    <div className="rounded-lg border border-border-selected bg-surface p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block">
          <span className="text-[12px] text-text-weak">中转商</span>
          <select
            value={providerId}
            onChange={(e) => onProvider(e.target.value)}
            className="mt-1 w-full rounded-md border border-border-weak bg-surface px-2 py-2 text-[13px] text-text-strong outline-none focus:border-border-selected"
          >
            <option value="">— 选择 —</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{CATEGORY_LABEL[p.category]}）
              </option>
            ))}
          </select>
        </label>
        <Field label="配置名称" value={name} onChange={setName} placeholder="如 AiHubMix · Opus" />
        <Field label="Model（可选）" value={model} onChange={setModel} placeholder="如 opus" />
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
          {initial ? '保存' : '添加'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
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
