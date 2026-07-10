import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnProcess, decodeProcessOutput, lastLines } from './process'
import { buildCliEnv } from './cli-env'
import { paths } from './sandbox'
import { addSkillEntry, loadConfig, updateSkillEntry } from './store'
import { ensureNode } from './install/node-runtime'
import type {
  AppConfig,
  CliId,
  CliSkillEntry,
  SkillsShInstallResult,
  SkillsShSearchResult,
  SkillsShSkill
} from '@shared/types'

const API_BASE = 'https://skills.sh/api'

const SKILLS_AGENT_BY_CLI: Record<CliId, string> = {
  'claude-code': 'claude-code',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi',
  hermes: 'hermes-agent'
}

interface SkillsShErrorResponse {
  error?: string
  message?: string
}

interface SkillsShSearchEnvelope {
  skills?: unknown
  results?: unknown
  data?: unknown
  items?: unknown
}

function skillListFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const envelope = payload as SkillsShSearchEnvelope
  if (Array.isArray(envelope.skills)) return envelope.skills
  if (Array.isArray(envelope.results)) return envelope.results
  if (Array.isArray(envelope.data)) return envelope.data
  if (Array.isArray(envelope.items)) return envelope.items
  return []
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeSkill(raw: unknown): SkillsShSkill | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = stringField(item.id)
  const slug = stringField(item.slug) ?? stringField(item.skillId) ?? stringField(item.name)
  const name = stringField(item.name)
  const source = stringField(item.source)
  if (!slug || !name || !source) return null
  const nextId = id ?? `${source}/${slug}`
  return {
    id: nextId,
    slug,
    name,
    source,
    description: stringField(item.description),
    installs: numberField(item.installs),
    sourceType: stringField(item.sourceType),
    installUrl: stringField(item.installUrl) ?? `${source}/${slug}`,
    url: stringField(item.url) ?? `https://skills.sh/${source}/${slug}`,
    isDuplicate: item.isDuplicate === true
  }
}

function isSkill(value: SkillsShSkill | null): value is SkillsShSkill {
  return value !== null
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as SkillsShErrorResponse
    if (payload.message) return payload.message
    if (payload.error) return payload.error
  } catch {
    /* fall through */
  }
  return `skills.sh API returned ${response.status}`
}

export async function searchSkillsSh(query: string, limit = 8): Promise<SkillsShSearchResult> {
  const url = new URL(`${API_BASE}/search`)
  url.searchParams.set('q', query.trim())
  url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 20))))

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AgentLauncher'
      }
    })
    if (!response.ok) {
      return {
        ok: false,
        authRequired: response.status === 401,
        error: await parseError(response)
      }
    }
    const payload = await response.json()
    return { ok: true, skills: skillListFromPayload(payload).map(normalizeSkill).filter(isSkill) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function emptyNpmrcPath(): string {
  mkdirSync(paths.root, { recursive: true })
  const file = join(paths.root, '.npmrc-empty')
  if (!existsSync(file)) writeFileSync(file, '')
  return file
}

function preparePiSkillSync(cliId: CliId, env: NodeJS.ProcessEnv): (() => void) | null {
  if (cliId !== 'pi' || !env.PI_CODING_AGENT_DIR) return null
  const installerHome = join(paths.root, 'skills-installer-home', 'pi')
  env.HOME = installerHome
  env.USERPROFILE = installerHome
  const source = join(installerHome, '.pi', 'agent', 'skills')
  const target = join(env.PI_CODING_AGENT_DIR, 'skills')
  return () => {
    if (!existsSync(source)) return
    mkdirSync(target, { recursive: true })
    cpSync(source, target, { recursive: true, force: true })
  }
}

function runSkillsCli(cliId: CliId, installUrl: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const { nodeBin, npmCli } = await ensureNode()
      mkdirSync(paths.npmCache, { recursive: true })
      const env = buildCliEnv(cliId)
      env.DISABLE_TELEMETRY = '1'
      env.npm_config_cache = paths.npmCache
      env.npm_config_userconfig = emptyNpmrcPath()
      const syncPiSkills = preparePiSkillSync(cliId, env)

      const args = [
        npmCli,
        'exec',
        '--yes',
        '--package',
        'skills@latest',
        '--',
        'skills',
        'add',
        installUrl,
        '--global',
        '--agent',
        SKILLS_AGENT_BY_CLI[cliId],
        '--yes',
        '--copy'
      ]
      const child = spawnProcess(nodeBin, args, {
        cwd: tmpdir(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      let output = ''
      child.stdout?.on('data', (chunk) => {
        output += decodeProcessOutput(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        output += decodeProcessOutput(chunk)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          try {
            syncPiSkills?.()
          } catch (error) {
            reject(error)
            return
          }
          resolve(output.trim())
        }
        else reject(new Error(lastLines(output, 8) || `skills CLI exited ${code}`))
      })
    } catch (error) {
      reject(error)
    }
  })
}

function upsertInstalledSkill(cliId: CliId, skill: SkillsShSkill, output?: string): {
  config: AppConfig
  entry: CliSkillEntry
} {
  const installNote = output ? lastLines(output, 3) : undefined
  const patch = {
    name: skill.name,
    enabled: true,
    source: `skills.sh · ${skill.source}`,
    provider: 'skills.sh' as const,
    description: skill.description,
    installUrl: skill.installUrl ?? undefined,
    skillsShId: skill.id,
    skillsShSlug: skill.slug,
    skillsShSource: skill.source,
    skillsShUrl: skill.url,
    notes: [skill.description, installNote].filter(Boolean).join('\n\n') || undefined
  }
  const existing = loadConfig().resources[cliId].skills.find(
    (entry) =>
      entry.provider === 'skills.sh' &&
      ((skill.id && entry.skillsShId === skill.id) ||
        (skill.installUrl && entry.installUrl === skill.installUrl) ||
        (entry.skillsShSource === skill.source && entry.skillsShSlug === skill.slug))
  )
  const config = existing ? updateSkillEntry(cliId, existing.id, patch) : addSkillEntry(cliId, patch)
  const entry =
    config.resources[cliId].skills.find((item) =>
      existing ? item.id === existing.id : item.provider === 'skills.sh' && item.skillsShId === skill.id
    ) ?? config.resources[cliId].skills[config.resources[cliId].skills.length - 1]
  return { config, entry }
}

export async function installSkillFromSkillsSh(
  cliId: CliId,
  skill: SkillsShSkill
): Promise<SkillsShInstallResult> {
  const installUrl = skill.installUrl?.trim()
  if (!installUrl) return { ok: false, error: 'This skills.sh result has no installUrl and cannot be installed.' }

  try {
    const output = await runSkillsCli(cliId, installUrl)
    const { config, entry } = upsertInstalledSkill(cliId, skill, output)
    return { ok: true, config, skill: entry, output }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
