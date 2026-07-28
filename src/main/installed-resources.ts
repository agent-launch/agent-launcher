import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { cliConfigDir, geminiStateDir, hermesHomeDir, systemCliConfigDir } from './config-paths'
import { getInstallSource } from './store'
import type {
  CliId,
  InstalledMcpEntry,
  InstalledMcpPatch,
  InstalledSkillEntry,
  InstalledSkillFile,
  InstalledSkillPatch,
  McpTransport
} from '@shared/types'

type JsonObject = Record<string, any>

const MAX_SKILL_DEPTH = 5

function safeRead(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  } catch {
    return ''
  }
}

function readJsonObject(path: string): JsonObject {
  const text = safeRead(path)
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeJsonObject(path: string, value: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function pathId(path: string, name: string): string {
  return `${path}#${name}`
}

function parsePathId(id: string): { path: string; name: string } {
  const index = id.lastIndexOf('#')
  if (index < 0) throw new Error('Invalid resource id')
  return { path: id.slice(0, index), name: id.slice(index + 1) }
}

function isInside(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && rel !== '..')
}

function splitArgs(value?: string): string[] {
  if (!value?.trim()) return []
  const matches = value.match(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|\S+/g) ?? []
  return matches.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'")
    }
    return part
  })
}

function parseEnv(value?: string): JsonObject | undefined {
  const out: JsonObject = {}
  for (const line of (value ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf('=')
    if (index < 0) continue
    const key = trimmed.slice(0, index).trim()
    if (!key) continue
    out[key] = trimmed.slice(index + 1).trim()
  }
  return Object.keys(out).length ? out : undefined
}

function stringifyEnv(value: unknown): string | undefined {
  if (!isObject(value)) return undefined
  return Object.entries(value)
    .map(([key, val]) => `${key}=${String(val)}`)
    .join('\n')
}

function commandAndArgs(
  value: unknown,
  fallbackArgs: unknown
): { command?: string; args?: string } {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item))
    return { command: items[0], args: items.slice(1).join(' ') || undefined }
  }
  if (typeof value === 'string') {
    if (Array.isArray(fallbackArgs))
      return { command: value, args: fallbackArgs.map((item) => String(item)).join(' ') }
    return { command: value }
  }
  return {}
}

function normalizeMcpEntry(
  cliId: CliId,
  configPath: string,
  configKind: InstalledMcpEntry['configKind'],
  name: string,
  raw: unknown
): InstalledMcpEntry | null {
  if (!isObject(raw)) return null
  const { command, args } = commandAndArgs(raw.command, raw.args)
  const url = typeof raw.url === 'string' ? raw.url : undefined
  const transport: McpTransport = url ? (raw.type === 'sse' ? 'sse' : 'http') : 'stdio'
  return {
    id: pathId(configPath, name),
    cliId,
    name,
    enabled: raw.enabled !== false && raw.disabled !== true,
    supportsEnabled: configKind !== 'hermes-yaml',
    transport,
    command,
    args,
    url,
    env: stringifyEnv(raw.env),
    configPath,
    configKind
  }
}

function listJsonMcp(cliId: CliId, path: string, key: 'mcp' | 'mcpServers'): InstalledMcpEntry[] {
  const config = readJsonObject(path)
  const servers = isObject(config[key]) ? config[key] : {}
  const kind = key === 'mcp' ? 'json-mcp' : 'json-mcp-servers'
  return Object.entries(servers)
    .map(([name, value]) => normalizeMcpEntry(cliId, path, kind, name, value))
    .filter((entry): entry is InstalledMcpEntry => Boolean(entry))
}

function updateJsonMcp(
  path: string,
  key: 'mcp' | 'mcpServers',
  entryId: string,
  patch: InstalledMcpPatch
): void {
  const { name } = parsePathId(entryId)
  const config = readJsonObject(path)
  const servers = isObject(config[key]) ? { ...config[key] } : {}
  const existing = isObject(servers[name]) ? { ...servers[name] } : {}
  const nextName = patch.name?.trim() || name
  if (!nextName) throw new Error('MCP name is required')
  if (nextName !== name) delete servers[name]

  const next: JsonObject = { ...existing }
  if (patch.transport) {
    if (patch.transport === 'stdio') delete next.url
    else delete next.command
  }
  if (patch.enabled !== undefined) next.enabled = patch.enabled
  if (patch.command !== undefined || patch.args !== undefined) {
    const command = patch.command?.trim() || String(next.command ?? '')
    const args =
      patch.args !== undefined ? splitArgs(patch.args) : Array.isArray(next.args) ? next.args : []
    if (key === 'mcp') next.command = [command, ...args].filter(Boolean)
    else {
      next.command = command
      next.args = args
    }
  }
  if (patch.url !== undefined) next.url = patch.url.trim() || undefined
  if (patch.env !== undefined) {
    const env = parseEnv(patch.env)
    if (env) next.env = env
    else delete next.env
  }
  if (!next.type) next.type = next.url ? 'remote' : key === 'mcp' ? 'local' : 'stdio'
  servers[nextName] = next
  config[key] = servers
  writeJsonObject(path, config)
}

function deleteJsonMcp(path: string, key: 'mcp' | 'mcpServers', entryId: string): void {
  const { name } = parsePathId(entryId)
  const config = readJsonObject(path)
  if (!isObject(config[key])) return
  delete config[key][name]
  writeJsonObject(path, config)
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function parseTomlValue(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const out: JsonObject = {}
    for (const part of trimmed.slice(1, -1).split(',')) {
      const pair = part.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+?)\s*$/)
      if (pair) out[pair[1]] = parseTomlValue(pair[2])
    }
    return out
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((item) => String(parseTomlValue(item)))
    }
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"')
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed.replace(/\s+#.*$/, '')
}

function listCodexMcp(cliId: CliId, configPath: string): InstalledMcpEntry[] {
  const text = safeRead(configPath)
  // Only match direct server tables `[mcp_servers.<name>]`. A bare key with a
  // dot (e.g. `[mcp_servers.node_repl.env]`) is a TOML subtable, not a server —
  // the old `[^\]]+` captured it as a bogus `node_repl.env` entry. Quoted names
  // may legitimately contain dots (`[mcp_servers."my.server"]`).
  const sections = [
    ...text.matchAll(
      /^\[mcp_servers\.([A-Za-z0-9_-]+|"[^"]*")\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm
    )
  ]
  return sections
    .map((match) => {
      const name = match[1].replace(/^"|"$/g, '')
      const raw: JsonObject = {}
      for (const line of match[2].split(/\r?\n/)) {
        const parts = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+?)\s*$/)
        if (parts) raw[parts[1]] = parseTomlValue(parts[2])
      }
      return normalizeMcpEntry(cliId, configPath, 'codex-toml', name, raw)
    })
    .filter((entry): entry is InstalledMcpEntry => Boolean(entry))
}

/** Parse `[plugins."<name>@<marketplace>"]` blocks that are `enabled = true`
 * from a Codex config.toml. Returns `<name>@<marketplace>` ids. */
function enabledCodexPlugins(configPath: string): string[] {
  const text = safeRead(configPath)
  const out: string[] = []
  // Plugin ids are quoted ("computer-use@openai-bundled") and sit in [plugins."..."].
  const sections = [...text.matchAll(/^\[plugins\."([^"]+)"\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm)]
  for (const match of sections) {
    const id = match[1]
    const enabled = /^\s*enabled\s*=\s*true\s*$/m.test(match[2])
    if (enabled) out.push(id)
  }
  return out
}

/** Parse `[marketplaces.<key>]` blocks → { key: sourcePath } for `source_type = "local"`. */
function codexMarketplaceSources(configPath: string): Record<string, string> {
  const text = safeRead(configPath)
  const out: Record<string, string> = {}
  const sections = [
    ...text.matchAll(/^\[marketplaces\.([A-Za-z0-9_.-]+)\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm)
  ]
  for (const match of sections) {
    const key = match[1]
    const body = match[2]
    if (!/^\s*source_type\s*=\s*"local"\s*$/m.test(body)) continue
    const source = body.match(/^\s*source\s*=\s*"([^"]*)"\s*$/m)
    if (source) out[key] = source[1]
  }
  return out
}

/**
 * Codex plugins can bundle MCP servers via their plugin.json's `mcpServers`
 * field pointing at a relative `.mcp.json`. These are real MCP servers (shown
 * by `codex /mcp`) but live outside config.toml's `[mcp_servers.*]`, so they're
 * surfaced read-only — managed by their plugin, not editable from the UI.
 */
function listCodexPluginMcp(cliId: CliId, configPath: string): InstalledMcpEntry[] {
  const plugins = enabledCodexPlugins(configPath)
  if (!plugins.length) return []
  const sources = codexMarketplaceSources(configPath)
  const out: InstalledMcpEntry[] = []
  for (const pluginId of plugins) {
    const at = pluginId.lastIndexOf('@')
    const name = at > 0 ? pluginId.slice(0, at) : pluginId
    const marketplace = at > 0 ? pluginId.slice(at + 1) : ''
    const root = sources[marketplace]
    if (!root) continue
    const pluginJsonPath = join(root, 'plugins', name, '.codex-plugin', 'plugin.json')
    const pluginJson = readJsonObject(pluginJsonPath)
    const mcpServersRef =
      typeof pluginJson.mcpServers === 'string' ? pluginJson.mcpServers : undefined
    if (!mcpServersRef) continue
    const mcpJsonPath = resolve(join(root, 'plugins', name), mcpServersRef)
    if (!existsSync(mcpJsonPath)) continue
    const mcpJson = readJsonObject(mcpJsonPath)
    const servers = isObject(mcpJson.mcpServers) ? mcpJson.mcpServers : {}
    for (const [serverName, raw] of Object.entries(servers)) {
      const entry = normalizeMcpEntry(
        cliId,
        mcpJsonPath,
        'codex-plugin',
        `${pluginId}/${serverName}`,
        raw
      )
      if (!entry) continue
      entry.name = serverName
      entry.readOnly = true
      // The bundled command/path are relative to the plugin dir; show them as-is.
      out.push(entry)
    }
  }
  return out
}

function stripCodexMcpSection(content: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Strip the server's own table plus any of its subtables (e.g. `.env`),
  // which sit as `[mcp_servers.<name>.<sub>]` right after the main block.
  const header = `^\\[mcp_servers\\.(?:"${escaped}"|${escaped})\\]`
  const subHeader = `^\\[mcp_servers\\.(?:"${escaped}"|${escaped})\\.[^\\]]+\\]`
  const block = `${header}\\s*\\n[\\s\\S]*?(?=^\\[|(?![\\s\\S]))(?:${subHeader}\\s*\\n[\\s\\S]*?(?=^\\[|(?![\\s\\S])))*`
  return content.replace(new RegExp(block, 'm'), '').trimEnd()
}

function codexMcpBlock(name: string, patch: InstalledMcpPatch): string {
  const lines = [`[mcp_servers.${tomlString(name)}]`]
  if (patch.command?.trim()) lines.push(`command = ${tomlString(patch.command.trim())}`)
  const args = splitArgs(patch.args)
  if (args.length) lines.push(`args = [${args.map(tomlString).join(', ')}]`)
  if (patch.url?.trim()) lines.push(`url = ${tomlString(patch.url.trim())}`)
  const env = parseEnv(patch.env)
  if (env) {
    const items = Object.entries(env).map(([key, value]) => `${key} = ${tomlString(String(value))}`)
    lines.push(`env = { ${items.join(', ')} }`)
  }
  if (patch.enabled === false) lines.push('disabled = true')
  return lines.join('\n')
}

function updateCodexMcp(
  configPath: string,
  entryId: string | undefined,
  patch: InstalledMcpPatch
): void {
  const name = entryId ? parsePathId(entryId).name : patch.name?.trim()
  const nextName = patch.name?.trim() || name
  if (!nextName) throw new Error('MCP name is required')
  const existing = entryId
    ? listCodexMcp('codex', configPath).find((entry) => entry.id === entryId)
    : undefined
  const merged: InstalledMcpPatch = { ...existing, ...patch, name: nextName }
  const current = safeRead(configPath)
  const stripped = name ? stripCodexMcpSection(current, name) : current.trimEnd()
  writeFileSync(
    configPath,
    `${stripped.trimEnd()}${stripped.trimEnd() ? '\n\n' : ''}${codexMcpBlock(nextName, merged)}\n`,
    { mode: 0o600 }
  )
}

function deleteCodexMcp(configPath: string, entryId: string): void {
  const { name } = parsePathId(entryId)
  const stripped = stripCodexMcpSection(safeRead(configPath), name)
  writeFileSync(configPath, `${stripped.trimEnd()}\n`, { mode: 0o600 })
}

function parseYamlScalar(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((item) => String(parseYamlScalar(item)))
    }
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"')
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed
}

function findTopYamlBlock(lines: string[], key: string): { start: number; end: number } | null {
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*(?:#.*)?$`).test(line))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) {
      end = i
      break
    }
  }
  return { start, end }
}

function parseHermesMcpServers(configPath: string): Record<string, JsonObject> {
  const lines = safeRead(configPath).split(/\r?\n/)
  const block = findTopYamlBlock(lines, 'mcp_servers')
  if (!block) return {}
  const out: Record<string, JsonObject> = {}
  let current = ''
  for (const line of lines.slice(block.start + 1, block.end)) {
    const server = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/)
    if (server) {
      current = server[1]
      out[current] = {}
      continue
    }
    if (!current) continue
    const pair = line.match(/^ {4}([A-Za-z_][A-Za-z0-9_-]*):\s*(.+?)\s*$/)
    if (pair) out[current][pair[1]] = parseYamlScalar(pair[2])
    const emptyMap = line.match(/^ {4}([A-Za-z_][A-Za-z0-9_-]*):\s*$/)
    if (emptyMap) out[current][emptyMap[1]] = {}
  }
  return out
}

function listHermesMcp(cliId: CliId, configPath: string): InstalledMcpEntry[] {
  return Object.entries(parseHermesMcpServers(configPath))
    .map(([name, value]) => normalizeMcpEntry(cliId, configPath, 'hermes-yaml', name, value))
    .filter((entry): entry is InstalledMcpEntry => Boolean(entry))
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function hermesMcpYaml(servers: Record<string, JsonObject>): string[] {
  const lines = ['mcp_servers:']
  for (const [name, config] of Object.entries(servers)) {
    lines.push(`  ${name}:`)
    if (config.command) lines.push(`    command: ${yamlString(String(config.command))}`)
    if (Array.isArray(config.args) && config.args.length) {
      lines.push(`    args: [${config.args.map((arg) => yamlString(String(arg))).join(', ')}]`)
    }
    if (config.url) lines.push(`    url: ${yamlString(String(config.url))}`)
    if (isObject(config.env) && Object.keys(config.env).length) {
      lines.push('    env:')
      for (const [key, value] of Object.entries(config.env)) {
        lines.push(`      ${key}: ${yamlString(String(value))}`)
      }
    }
  }
  return lines
}

function writeHermesMcpServers(configPath: string, servers: Record<string, JsonObject>): void {
  mkdirSync(dirname(configPath), { recursive: true })
  const content = safeRead(configPath)
  const lines = content ? content.split(/\r?\n/) : []
  const block = findTopYamlBlock(lines, 'mcp_servers')
  const nextBlock = hermesMcpYaml(servers)
  const next = block
    ? [...lines.slice(0, block.start), ...nextBlock, ...lines.slice(block.end)].join('\n')
    : `${content.trimEnd()}${content.trimEnd() ? '\n' : ''}${nextBlock.join('\n')}\n`
  writeFileSync(configPath, `${next.trimEnd()}\n`, { mode: 0o600 })
}

function updateHermesMcp(
  configPath: string,
  entryId: string | undefined,
  patch: InstalledMcpPatch
): void {
  const oldName = entryId ? parsePathId(entryId).name : patch.name?.trim()
  const nextName = patch.name?.trim() || oldName
  if (!nextName) throw new Error('MCP name is required')
  const servers = parseHermesMcpServers(configPath)
  const existing = oldName && isObject(servers[oldName]) ? { ...servers[oldName] } : {}
  if (oldName && oldName !== nextName) delete servers[oldName]
  const next: JsonObject = { ...existing }
  if (patch.transport) {
    if (patch.transport === 'stdio') delete next.url
    else delete next.command
  }
  if (patch.command !== undefined) next.command = patch.command.trim() || undefined
  if (patch.args !== undefined) next.args = splitArgs(patch.args)
  if (patch.url !== undefined) next.url = patch.url.trim() || undefined
  if (patch.env !== undefined) {
    const env = parseEnv(patch.env)
    if (env) next.env = env
    else delete next.env
  }
  servers[nextName] = next
  writeHermesMcpServers(configPath, servers)
}

function deleteHermesMcp(configPath: string, entryId: string): void {
  const { name } = parsePathId(entryId)
  const servers = parseHermesMcpServers(configPath)
  delete servers[name]
  writeHermesMcpServers(configPath, servers)
}

function mcpConfigPaths(
  cliId: CliId
): Array<{ path: string; key?: 'mcp' | 'mcpServers'; kind?: 'codex' | 'hermes' }> {
  const dir = cliId === 'gemini' ? geminiStateDir() : cliConfigDir(cliId)
  if (cliId === 'codex') return [{ path: join(dir, 'config.toml'), kind: 'codex' }]
  // Gemini reads `mcpServers` from its own settings.json only — no project-
  // scoped .mcp.json convention here like the generic fallback below assumes.
  if (cliId === 'gemini') return [{ path: join(dir, 'settings.json'), key: 'mcpServers' }]
  if (cliId === 'opencode') return [{ path: join(dir, 'opencode.json'), key: 'mcp' }]
  if (cliId === 'claude-code') {
    // Claude Code keeps user-scope MCP servers in `.claude.json` under
    // `mcpServers`. Where it looks for that file depends on CLAUDE_CONFIG_DIR:
    //   - system install (no env var): `~/.claude.json` (home root, sibling
    //     of the ~/.claude dir, NOT inside it)
    //   - sandbox install (CLAUDE_CONFIG_DIR set): `<configDir>/.claude.json`
    //     (inside the redirected config dir)
    // It does NOT read `settings.json`'s `mcpServers` or a config-dir
    // `.mcp.json` (that one is project-scoped, read from the cwd).
    const claudeJson =
      getInstallSource(cliId) === 'system'
        ? join(homedir(), '.claude.json')
        : join(dir, '.claude.json')
    return [{ path: claudeJson, key: 'mcpServers' }]
  }
  if (cliId === 'hermes') return [{ path: join(dir, 'config.yaml'), kind: 'hermes' }]
  return [
    { path: join(dir, '.mcp.json'), key: 'mcpServers' },
    { path: join(dir, 'settings.json'), key: 'mcpServers' }
  ]
}

export function listInstalledMcp(cliId: CliId): InstalledMcpEntry[] {
  const out: InstalledMcpEntry[] = []
  for (const config of mcpConfigPaths(cliId)) {
    if (config.kind === 'codex') {
      const tomlEntries = listCodexMcp(cliId, config.path)
      out.push(...tomlEntries)
      // Plugin-bundled MCP servers (read-only) live outside config.toml. When
      // the user toggles one, Codex materializes an override under the same
      // name in config.toml's [mcp_servers.*] — that entry carries the real
      // enabled state, so it wins and the bundled copy is hidden.
      const overridden = new Set(tomlEntries.map((entry) => entry.name))
      out.push(
        ...listCodexPluginMcp(cliId, config.path).filter((entry) => !overridden.has(entry.name))
      )
    } else if (config.kind === 'hermes') {
      out.push(...listHermesMcp(cliId, config.path))
    } else if (config.key && existsSync(config.path)) {
      out.push(...listJsonMcp(cliId, config.path, config.key))
    }
  }
  return out
}

export function addInstalledMcp(cliId: CliId, patch: InstalledMcpPatch): InstalledMcpEntry[] {
  const config = mcpConfigPaths(cliId)[0]
  if (!config) throw new Error('MCP configuration is not supported for this agent')
  if (config.kind === 'codex') updateCodexMcp(config.path, undefined, patch)
  else if (config.kind === 'hermes') updateHermesMcp(config.path, undefined, patch)
  else
    updateJsonMcp(
      config.path,
      config.key ?? 'mcpServers',
      pathId(config.path, patch.name?.trim() || ''),
      patch
    )
  return listInstalledMcp(cliId)
}

export function updateInstalledMcp(
  cliId: CliId,
  entryId: string,
  patch: InstalledMcpPatch
): InstalledMcpEntry[] {
  const entry = listInstalledMcp(cliId).find((item) => item.id === entryId)
  if (!entry) throw new Error('MCP server not found')
  if (entry.readOnly)
    throw new Error('This MCP server is managed by a plugin and cannot be edited in the app')
  if (entry.configKind === 'codex-toml') updateCodexMcp(entry.configPath, entryId, patch)
  else if (entry.configKind === 'hermes-yaml') updateHermesMcp(entry.configPath, entryId, patch)
  else
    updateJsonMcp(
      entry.configPath,
      entry.configKind === 'json-mcp' ? 'mcp' : 'mcpServers',
      entryId,
      patch
    )
  return listInstalledMcp(cliId)
}

export function deleteInstalledMcp(cliId: CliId, entryId: string): InstalledMcpEntry[] {
  const entry = listInstalledMcp(cliId).find((item) => item.id === entryId)
  if (!entry) throw new Error('MCP server not found')
  if (entry.readOnly)
    throw new Error('This MCP server is managed by a plugin and cannot be deleted in the app')
  if (entry.configKind === 'codex-toml') deleteCodexMcp(entry.configPath, entryId)
  else if (entry.configKind === 'hermes-yaml') deleteHermesMcp(entry.configPath, entryId)
  else
    deleteJsonMcp(entry.configPath, entry.configKind === 'json-mcp' ? 'mcp' : 'mcpServers', entryId)
  return listInstalledMcp(cliId)
}

function sandboxSkillRoots(cliId: CliId, dir: string): string[] {
  if (cliId === 'opencode')
    return [join(dir, 'xdg-config', 'opencode', 'skills'), join(dir, 'skills')]
  return [join(dir, 'skills')]
}

function systemSkillRoots(cliId: CliId, dir: string): string[] {
  if (cliId === 'opencode') {
    return [
      join(dir, 'skills'),
      join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode', 'skills')
    ]
  }
  if (cliId === 'hermes')
    return [join(hermesHomeDir(), 'skills'), join(systemCliConfigDir('hermes'), 'skills')]
  return [join(systemCliConfigDir(cliId), 'skills')]
}

function skillRoots(cliId: CliId): string[] {
  const dir = cliId === 'gemini' ? geminiStateDir() : cliConfigDir(cliId)
  const roots =
    getInstallSource(cliId) === 'system'
      ? systemSkillRoots(cliId, dir)
      : sandboxSkillRoots(cliId, dir)

  return [...new Set(roots.map((root) => resolve(root)))]
}

function findSkillFiles(root: string, depth = 0): string[] {
  if (!existsSync(root) || depth > MAX_SKILL_DEPTH) return []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue
    const path = join(root, name)
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (stat.isDirectory()) out.push(...findSkillFiles(path, depth + 1))
    else if (name === 'SKILL.md') out.push(path)
  }
  return out
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*/)
  const block = match?.[1] ?? ''
  const out: { name?: string; description?: string } = {}
  for (const key of ['name', 'description'] as const) {
    const line = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    if (!line) continue
    const value = line[1].trim().replace(/^["']|["']$/g, '')
    if (value) out[key] = value
  }
  return out
}

function installedSkillFromPath(cliId: CliId, root: string, path: string): InstalledSkillEntry {
  const content = safeRead(path)
  const frontmatter = parseSkillFrontmatter(content)
  const dir = dirname(path)
  const source = relative(root, dir) || basename(dir)
  return {
    id: path,
    cliId,
    name: frontmatter.name || basename(dir),
    enabled: true,
    path,
    dir,
    root,
    source,
    provider: 'local',
    description: frontmatter.description
  }
}

export function listInstalledSkills(cliId: CliId): InstalledSkillEntry[] {
  const seen = new Set<string>()
  const out: InstalledSkillEntry[] = []
  for (const root of skillRoots(cliId)) {
    for (const path of findSkillFiles(root)) {
      const resolved = resolve(path)
      if (seen.has(resolved)) continue
      seen.add(resolved)
      out.push(installedSkillFromPath(cliId, root, resolved))
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function readInstalledSkill(cliId: CliId, entryId: string): InstalledSkillFile {
  const entry = listInstalledSkills(cliId).find((item) => item.id === entryId)
  if (!entry) throw new Error('Skill not found')
  if (!isInside(entry.path, entry.root))
    throw new Error('Skill path is outside the managed directory')
  if (basename(entry.path) !== 'SKILL.md') throw new Error('This file is not SKILL.md')
  return {
    path: entry.path,
    content: safeRead(entry.path)
  }
}

function updateSkillFrontmatter(content: string, patch: InstalledSkillPatch): string {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*/)
  const bodyStart = match ? match[0].length : 0
  const fields: Record<string, string> = {}
  const block = match?.[1] ?? ''
  for (const line of block.split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/)
    if (item) fields[item[1]] = item[2]
  }
  if (patch.name !== undefined) fields.name = yamlString(patch.name.trim())
  if (patch.description !== undefined) fields.description = yamlString(patch.description.trim())
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`)
  return `---\n${lines.join('\n')}\n---\n${content.slice(bodyStart).replace(/^\s*/, '')}`
}

export function updateInstalledSkill(
  cliId: CliId,
  entryId: string,
  patch: InstalledSkillPatch
): InstalledSkillEntry[] {
  const entry = listInstalledSkills(cliId).find((item) => item.id === entryId)
  if (!entry) throw new Error('Skill not found')
  if (!isInside(entry.path, entry.root))
    throw new Error('Skill path is outside the managed directory')
  writeFileSync(entry.path, updateSkillFrontmatter(safeRead(entry.path), patch), { mode: 0o600 })
  return listInstalledSkills(cliId)
}

export function deleteInstalledSkill(cliId: CliId, entryId: string): InstalledSkillEntry[] {
  const entry = listInstalledSkills(cliId).find((item) => item.id === entryId)
  if (!entry) throw new Error('Skill not found')
  if (!isInside(entry.dir, entry.root))
    throw new Error('Skill path is outside the managed directory')
  if (!existsSync(join(entry.dir, 'SKILL.md')))
    throw new Error('This directory does not contain a Skill')
  rmSync(entry.dir, { recursive: true, force: true })
  return listInstalledSkills(cliId)
}
