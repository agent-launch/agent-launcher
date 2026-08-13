import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { paths } from '../sandbox'
import { hermesHomeDir } from '../config-paths'
import { macosSecurityManualUpdateMessage } from '../cli-launch-safety'
import { decodeProcessOutput, lastLines, spawnProcess } from '../process'
import {
  envForCommand,
  initializeSystemPath,
  knownExecutableDirs,
  resolvedPathDirs
} from '../system-path'
import { loadConfig, setInstallState } from '../store'
import type {
  CliId,
  CliInstallState,
  CliLinkProgress,
  CliLinkResult,
  CliUpdateStatus,
  CleanupCliResult,
  SystemCliCandidate,
  SystemCliDetection
} from '@shared/types'
import { fetchJson, isReachable } from './download'
import {
  codexInstallLabel,
  inspectCodexInstall,
  isExplicitMacSecurityAssessmentFailure,
  type CodexInstallInspection
} from './codex-safety'

type Progress = (phase: CliLinkProgress['phase'], message: string, fraction?: number) => void

interface NpmDist {
  version: string
}

const SYSTEM_COMMANDS: Record<CliId, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi',
  hermes: 'hermes',
  gemini: 'gemini'
}

type NpmCliId = Exclude<CliId, 'hermes'>

const NPM_CLI_IDS: NpmCliId[] = ['claude-code', 'codex', 'opencode', 'pi', 'gemini']

const NPM_PACKAGES: Record<NpmCliId, string> = {
  'claude-code': '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  opencode: 'opencode-ai',
  pi: '@earendil-works/pi-coding-agent',
  gemini: '@google/gemini-cli'
}

const NPM_FALLBACK_REGISTRY = 'https://registry.npmmirror.com'
const PYPI_FALLBACK_INDEX = 'https://pypi.tuna.tsinghua.edu.cn/simple'
const PLAYWRIGHT_FALLBACK_HOST = 'https://registry.npmmirror.com/-/binary/playwright'

/** GitCode mirrors the official Git repository inside mainland China. Never
 * trust its floating main branch: this release tag is signed upstream, and all
 * pinned values below were cross-checked against GitHub. PowerShell has two
 * hashes because Git for Windows may materialize the same blob with CRLF. */
const HERMES_MIRROR = {
  repo: 'https://gitcode.com/GitHub_Trending/he/hermes-agent.git',
  officialRepo: 'https://github.com/NousResearch/hermes-agent.git',
  tag: 'v2026.8.3',
  tagObject: '7de39e700d2c329e15d32eb0b96e2f7cdd9fbdb2',
  commit: '3c27eb6234bf91b8ceee9e9071591b31e9b148cb',
  sh256: '45f589461248c7a6ec3aecd7522a69dd49c5c8dbf4798ba1296af5c0c5e7ccd3',
  ps1LfSha256: '4dcbf2b665750cb578f69a6efa40770659e21821a463746f86da68af0d2bb31c',
  ps1CrLfSha256: '7a9c854dabcb7d3e5859902ea626f444196777cfcf74a6bb0508d0f063dbf161'
} as const

function isNpmCliId(id: CliId): id is NpmCliId {
  return id !== 'hermes'
}

const NODE_NPM_ENTRY_ROOT: Partial<Record<CliId, string[]>> = {
  pi: ['node_modules', '@earendil-works', 'pi-coding-agent']
}

function spawnCliProcess(cmd: string, args: string[], options: Parameters<typeof spawnProcess>[2]) {
  return spawnProcess(cmd, args, { ...options, env: { ...envForCommand(cmd), ...options?.env } })
}

function npmMeta(spec: string): Promise<NpmDist> {
  return fetchJson<NpmDist>(`https://registry.npmjs.org/${spec}`)
}

/** Hermes Agent releases are published on PyPI rather than npm. */
async function hermesLatestVersion(): Promise<string> {
  const meta = await fetchJson<{ info?: { version?: string } }>(
    'https://pypi.org/pypi/hermes-agent/json'
  )
  const version = meta.info?.version
  if (!version) throw new Error('PyPI returned no version for hermes-agent')
  return version
}

/** Gatekeeper shows a "will damage your computer" dialog when a quarantined
 * binary is executed — so this must be checked with xattr, never by running
 * the binary. Checks the given path and its symlink target. */
async function isMacQuarantined(...targets: (string | undefined)[]): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  for (const target of targets) {
    if (!target) continue
    const quarantined = await new Promise<boolean>((resolve) => {
      const p = spawn('xattr', ['-p', 'com.apple.quarantine', target], { stdio: 'ignore' })
      p.on('error', () => resolve(false))
      p.on('close', (code) => resolve(code === 0))
    })
    if (quarantined) return true
  }
  return false
}

const macSecurityAssessmentCache = new Map<string, { expiresAt: number; risky: boolean }>()

/** Ask Gatekeeper for a static assessment without executing Codex. A generic
 * CLI rejection is normal; only explicit revoked-certificate/malware verdicts
 * are considered unsafe. */
async function hasExplicitMacSecurityFailure(target?: string): Promise<boolean> {
  if (process.platform !== 'darwin' || !target || !existsSync(target)) return false
  let stamp: string
  try {
    const stat = statSync(target)
    stamp = `${target}:${stat.size}:${stat.mtimeMs}`
  } catch {
    return false
  }
  const cached = macSecurityAssessmentCache.get(stamp)
  if (cached && cached.expiresAt > Date.now()) return cached.risky

  const risky = await new Promise<boolean>((resolve) => {
    let output = ''
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const p = spawn('spctl', ['--assess', '--type', 'execute', '-vv', target], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const append = (data: Buffer) => {
      output = `${output}${decodeProcessOutput(data)}`.slice(-4000)
    }
    p.stdout.on('data', append)
    p.stderr.on('data', append)
    p.on('error', () => finish(false))
    p.on('close', () => finish(isExplicitMacSecurityAssessmentFailure(output)))
    const timer = setTimeout(() => {
      p.kill()
      finish(false)
    }, 5000)
  })
  macSecurityAssessmentCache.set(stamp, { expiresAt: Date.now() + 60_000, risky })
  return risky
}

async function codexMacSecurityRisk(
  inspection: CodexInstallInspection | undefined,
  quarantined: boolean
): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  if (quarantined || inspection?.runtimeMissing) return true
  return hasExplicitMacSecurityFailure(inspection?.executablePath)
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawnCliProcess(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout!.on('data', (d) => (out += decodeProcessOutput(d)))
    p.stderr!.on('data', (d) => (err += decodeProcessOutput(d)))
    p.on('error', reject)
    p.on('close', (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(new Error(lastLines(err || out, 8) || `exit ${code}`))
    )
  })
}

/** Run a long install command, reporting its latest output line as progress and
 * failing with the tail of the log so a blocked download or a permission error
 * is visible in the UI rather than swallowed. */
function runStreaming(
  cmd: string,
  args: string[],
  onProgress: Progress,
  label: string,
  timeoutMs?: number,
  env?: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Run installers in their own process group so a timeout can terminate any
    // child processes spawned by the shell (e.g. curl, npm, system package managers).
    const p = spawnProcess(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: envForCommand(cmd, { ...process.env, ...env })
    })
    let tail = ''
    let timedOut = false

    const terminate = (signal: NodeJS.Signals): void => {
      if (p.pid == null) {
        p.kill(signal)
        return
      }
      try {
        if (process.platform !== 'win32') {
          process.kill(-p.pid, signal)
        } else {
          p.kill(signal)
        }
      } catch {
        p.kill(signal)
      }
    }

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          terminate('SIGTERM')
          setTimeout(() => terminate('SIGKILL'), 5000)
        }, timeoutMs)
      : undefined
    const append = (chunk: Buffer): void => {
      tail = `${tail}${decodeProcessOutput(chunk)}`.slice(-3000)
      const line = tail
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .at(-1)
      if (line) onProgress('install', `${label}: ${line}`)
    }
    p.stdout!.on('data', append)
    p.stderr!.on('data', append)
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`${label} timed out`))
      if (code === 0) return resolve()
      reject(new Error(lastLines(tail, 8) || `${label} exit ${code}`))
    })
  })
}

function hermesCommandDirs(): string[] {
  if (process.platform === 'win32') {
    const hermesHome = hermesHomeDir()
    return [
      join(hermesHome, 'hermes-agent', 'venv', 'Scripts'),
      join(hermesHome, 'hermes-agent'),
      join(hermesHome, 'bin')
    ]
  }
  return [join(homedir(), '.local', 'bin'), '/usr/local/bin']
}

function pathCandidates(cmd: string): string[] {
  const names = commandNames(cmd)
  return resolvedPathDirs().flatMap((dir) => names.map((name) => join(dir, name)))
}

function commandNames(cmd: string): string[] {
  const exts =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : ['']
  return process.platform === 'win32' && !/\.[A-Za-z0-9]+$/.test(cmd)
    ? exts.map((ext) => `${cmd}${ext.toLowerCase()}`)
    : [cmd]
}

function npmManagedBinDirs(): string[] {
  if (process.platform === 'win32') {
    return uniquePaths(
      [
        process.env.APPDATA ? join(process.env.APPDATA, 'npm') : undefined,
        process.env.NVM_SYMLINK,
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Volta', 'bin') : undefined,
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'pnpm') : undefined,
        join(homedir(), '.bun', 'bin')
      ].filter((dir): dir is string => !!dir)
    )
  }
  return uniquePaths([...knownExecutableDirs()])
}

function codexExtraCandidates(): string[] {
  const names =
    process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat', 'codex'] : ['codex']
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  const customInstallDir = process.env.CODEX_INSTALL_DIR
  const visibleDirs =
    process.platform === 'win32'
      ? [
          customInstallDir,
          process.env.LOCALAPPDATA
            ? join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin')
            : undefined
        ]
      : [customInstallDir, join(homedir(), '.local', 'bin')]
  const standalone = [
    ...names.map((name) => join(codexHome, 'packages', 'standalone', 'current', 'bin', name)),
    ...names.map((name) => join(codexHome, 'packages', 'standalone', 'current', name))
  ]
  const appBundled =
    process.platform === 'darwin'
      ? [
          '/Applications/Codex.app/Contents/Resources/codex',
          '/Applications/ChatGPT.app/Contents/Resources/codex'
        ]
      : []
  const npmManaged = npmManagedBinDirs().flatMap((dir) => names.map((name) => join(dir, name)))
  return uniquePaths([
    ...visibleDirs
      .filter((dir): dir is string => !!dir)
      .flatMap((dir) => names.map((name) => join(dir, name))),
    ...standalone,
    ...npmManaged,
    ...appBundled
  ]).filter((candidate) => existsSync(candidate))
}

export function commandSearchCandidates(cmd: string, id?: CliId): string[] {
  const candidates = pathCandidates(cmd)
  if (id === 'codex') {
    const names = commandNames(cmd)
    const explicit = process.env.CODEX_INSTALL_DIR
      ? names.map((name) => join(process.env.CODEX_INSTALL_DIR as string, name))
      : []
    return uniquePaths([...explicit, ...candidates, ...codexExtraCandidates()])
  }
  const names = commandNames(cmd)
  if (cmd === 'npm' || (id && isNpmCliId(id))) {
    return uniquePaths([
      ...candidates,
      ...npmManagedBinDirs().flatMap((dir) => names.map((name) => join(dir, name)))
    ])
  }
  if (id !== 'hermes') return candidates
  return uniquePaths([
    ...candidates,
    ...hermesCommandDirs().flatMap((dir) => names.map((name) => join(dir, name)))
  ])
}

async function normalizePath(p: string): Promise<string> {
  try {
    return await realpath(p)
  } catch {
    return resolve(p)
  }
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const key = process.platform === 'win32' ? p.toLowerCase() : p
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

async function whichAll(cmd: string, id?: CliId): Promise<string[]> {
  if (isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\'))
    return existsSync(cmd) ? [cmd] : []
  const direct = uniquePaths(
    commandSearchCandidates(cmd, id).filter((candidate) => existsSync(candidate))
  )
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const fromFinder = await new Promise<string[]>((resolve) => {
    const args = process.platform === 'win32' ? [cmd] : ['-a', cmd]
    const p = spawn(finder, args, {
      env: envForCommand(finder),
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => resolve([]))
    p.on('close', (code) =>
      resolve(
        code === 0
          ? out
              .trim()
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean)
          : []
      )
    )
  })
  return uniquePaths([...direct, ...fromFinder])
}

async function which(cmd: string): Promise<string | null> {
  const [first] = await whichAll(cmd)
  return first ?? null
}

/** Detect commands from a GUI process whose PATH may omit /usr/local/bin,
 * Homebrew, nvm, fnm, mise, Volta, pnpm, or user-local bin directories. */
export async function findSystemCommand(cmd: string): Promise<string | null> {
  const detected = await which(cmd)
  if (detected) return detected
  await initializeSystemPath()
  return which(cmd)
}

async function systemCandidates(id: CliId): Promise<SystemCliCandidate[]> {
  const command = SYSTEM_COMMANDS[id]
  const paths = await whichAll(command, id)
  const out: SystemCliCandidate[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    const realPath = await normalizePath(path)
    const key = process.platform === 'win32' ? realPath.toLowerCase() : realPath
    if (seen.has(key)) continue
    seen.add(key)
    const codexInspection = id === 'codex' ? inspectCodexInstall(path, realPath) : undefined
    const quarantined = await isMacQuarantined(path, realPath, codexInspection?.executablePath)
    const macosSecurityRisk =
      id === 'codex'
        ? await codexMacSecurityRisk(codexInspection, quarantined)
        : process.platform === 'darwin' && quarantined
    out.push({
      path,
      realPath,
      version: macosSecurityRisk
        ? codexInspection?.version
        : await systemVersion(id, path, realPath),
      quarantined: quarantined || undefined,
      macosSecurityRisk: macosSecurityRisk || undefined,
      installKind: codexInspection?.installKind,
      packageManager: codexInspection?.packageManager
    })
  }
  return out
}

export async function detectSystemCli(
  id: CliId,
  configuredBinPath?: string
): Promise<SystemCliDetection> {
  const command = SYSTEM_COMMANDS[id]
  let candidates = await systemCandidates(id)
  // Fast paths and explicit locations do not need to wait on shell startup.
  // Only retry through the login-shell PATH when normal discovery found nothing.
  if (!candidates.length) {
    await initializeSystemPath()
    candidates = await systemCandidates(id)
  }
  const configuredExists = !!configuredBinPath && existsSync(configuredBinPath)
  if (configuredExists) {
    const configuredRealPath = await normalizePath(configuredBinPath)
    const configuredKey =
      process.platform === 'win32' ? configuredRealPath.toLowerCase() : configuredRealPath
    const hasConfigured = candidates.some((c) => {
      const key =
        process.platform === 'win32' ? (c.realPath ?? c.path).toLowerCase() : (c.realPath ?? c.path)
      return key === configuredKey
    })
    if (!hasConfigured) {
      const codexInspection =
        id === 'codex' ? inspectCodexInstall(configuredBinPath, configuredRealPath) : undefined
      const quarantined = await isMacQuarantined(
        configuredBinPath,
        configuredRealPath,
        codexInspection?.executablePath
      )
      const macosSecurityRisk =
        id === 'codex'
          ? await codexMacSecurityRisk(codexInspection, quarantined)
          : process.platform === 'darwin' && quarantined
      candidates.unshift({
        path: configuredBinPath,
        realPath: configuredRealPath,
        version: macosSecurityRisk
          ? codexInspection?.version
          : await systemVersion(id, configuredBinPath, configuredRealPath),
        quarantined: quarantined || undefined,
        macosSecurityRisk: macosSecurityRisk || undefined,
        installKind: codexInspection?.installKind,
        packageManager: codexInspection?.packageManager
      })
    }
  }
  const installed = candidates.length > 0
  const duplicate = candidates.length > 1
  let selectedPath = configuredExists ? configuredBinPath : candidates[0]?.path
  const configuredMatched =
    configuredExists &&
    candidates.some((c) => {
      if (c.path === configuredBinPath || c.realPath === configuredBinPath) return true
      return false
    })

  let status: SystemCliDetection['status'] = 'missing'
  if (configuredBinPath && !configuredExists) status = 'stale'
  else if (configuredExists && configuredMatched) status = 'linked'
  else if (duplicate) status = 'duplicate'
  else if (installed) status = 'available'

  if (status === 'stale') selectedPath = candidates[0]?.path

  const baseDetail =
    status === 'linked'
      ? duplicate
        ? `Pinned ${selectedPath}; ${candidates.length} ${command} commands are still detected`
        : `Linked ${selectedPath}`
      : status === 'available'
        ? `Detected ${selectedPath}`
        : status === 'duplicate'
          ? `Detected ${candidates.length} ${command} commands`
          : status === 'stale'
            ? 'The recorded command is missing'
            : `${command} was not detected`

  const selectedCandidate = selectedPath
    ? candidates.find(
        (candidate) => candidate.path === selectedPath || candidate.realPath === selectedPath
      )
    : undefined
  const quarantined = selectedCandidate?.quarantined
  const macosSecurityRisk = selectedCandidate?.macosSecurityRisk
  const installKind = selectedCandidate?.installKind
  const packageManager = selectedCandidate?.packageManager
  const detail =
    id === 'codex' && selectedPath && installKind
      ? `${baseDetail} · ${codexInstallLabel(installKind, packageManager)}`
      : baseDetail

  return {
    cliId: id,
    command,
    candidates,
    selectedPath,
    configuredBinPath,
    installed,
    duplicate,
    status,
    detail,
    quarantined,
    macosSecurityRisk,
    installKind,
    packageManager
  }
}

function backupPathForCli(id: CliId, binPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(paths.root, 'removed-clis', id, stamp, basename(binPath))
}

export async function cleanupSystemCli(id: CliId, binPath: string): Promise<CleanupCliResult> {
  try {
    if (!binPath || !existsSync(binPath)) throw new Error('Path does not exist')
    const detection = await detectSystemCli(id)
    const targetRealPath = await normalizePath(binPath)
    const matched = detection.candidates.some((candidate) => {
      const candidateRealPath = candidate.realPath ?? candidate.path
      const a = process.platform === 'win32' ? candidateRealPath.toLowerCase() : candidateRealPath
      const b = process.platform === 'win32' ? targetRealPath.toLowerCase() : targetRealPath
      return a === b || candidate.path === binPath
    })
    if (!matched)
      throw new Error('This path is not a detected CLI candidate; cleanup was cancelled')

    const backupPath = backupPathForCli(id, binPath)
    mkdirSync(dirname(backupPath), { recursive: true })
    renameSync(binPath, backupPath)
    return { ok: true, cliId: id, path: binPath, backupPath }
  } catch (e) {
    return {
      ok: false,
      cliId: id,
      path: binPath,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

async function linkExistingSystemCli(
  id: CliId,
  onProgress: Progress,
  binPath?: string
): Promise<CliLinkResult> {
  onProgress('link', 'Finding system CLI…')
  const target = SYSTEM_COMMANDS[id]
  const detection = await detectSystemCli(id, binPath)
  const selected = binPath ?? detection.selectedPath
  if (!selected)
    throw new Error(
      `System command ${target} was not found. Install it separately, then detect it again.`
    )
  if (!existsSync(selected)) {
    throw new Error(`System command does not exist: ${selected}`)
  }
  const selectedCandidate = detection.candidates.find(
    (candidate) => candidate.path === selected || candidate.realPath === selected
  )
  if (selectedCandidate?.macosSecurityRisk) {
    throw new Error(macosSecurityManualUpdateMessage(id))
  }
  if (await isMacQuarantined(selected, await normalizePath(selected))) {
    throw new Error(macosSecurityManualUpdateMessage(id))
  }
  onProgress('verify', `Verifying ${basename(selected)}…`)
  const version = await systemVersion(id, selected, selectedCandidate?.realPath)
  setInstallState(id, {
    installed: true,
    source: 'system',
    version,
    binPath: selected,
    installKind: selectedCandidate?.installKind,
    packageManager: selectedCandidate?.packageManager
  })
  const warning =
    detection.duplicate && !binPath
      ? `Detected ${detection.candidates.length} ${target} commands; temporarily using the highest-priority version on PATH`
      : undefined
  return {
    ok: true,
    cliId: id,
    version,
    binPath: selected,
    source: 'system',
    warning,
    candidates: detection.candidates
  }
}

function parseVersion(text: string): string {
  return (
    text.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ??
    text.trim().split(/\s+/).pop() ??
    'system'
  )
}

function versionParts(version?: string): number[] | null {
  const match = version?.match(/\d+(?:\.\d+){1,3}/)
  if (!match) return null
  return match[0].split('.').map((part) => Number(part))
}

function isVersionNewer(latest?: string, current?: string): boolean {
  const a = versionParts(latest)
  const b = versionParts(current)
  // Unknown versions (e.g. a probe that failed and recorded 'system') can't be
  // compared — claiming an update would show a permanent phantom "update available".
  if (!a || !b) return false
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff > 0) return true
    if (diff < 0) return false
  }
  return false
}

function cliFilesExist(id: CliId, install: CliInstallState): boolean {
  if (!install.binPath || !existsSync(install.binPath)) return false
  if (!install.legacyManaged) return true
  if (id === 'codex' && install.installKind === 'standalone') {
    const packageRoot = dirname(dirname(install.binPath))
    const helper = join(
      packageRoot,
      'bin',
      process.platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host'
    )
    const rg = join(packageRoot, 'codex-path', process.platform === 'win32' ? 'rg.exe' : 'rg')
    if (
      !existsSync(join(packageRoot, 'codex-package.json')) ||
      !existsSync(helper) ||
      !existsSync(rg)
    )
      return false
  }
  if (install.nodeEntry) return existsSync(install.nodeEntry)
  if (NODE_NPM_ENTRY_ROOT[id]) {
    return !!install.nodeEntry && existsSync(install.nodeEntry)
  }
  return true
}

async function systemVersion(id: CliId, binPath: string, realPath?: string): Promise<string> {
  try {
    if (id === 'codex') {
      const inspected = inspectCodexInstall(binPath, realPath ?? (await normalizePath(binPath)))
      if (inspected.version) return inspected.version
      if (process.platform === 'darwin') return 'system'
    }
    // Never execute a quarantined binary — that pops the Gatekeeper dialog.
    if (await isMacQuarantined(binPath, await normalizePath(binPath))) return 'system'
    return parseVersion(await run(binPath, ['--version']))
  } catch {
    return 'system'
  }
}

export async function linkSystemCli(
  id: CliId,
  onProgress: Progress,
  binPath?: string
): Promise<CliLinkResult> {
  try {
    return await linkExistingSystemCli(id, onProgress, binPath)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    onProgress('error', error)
    return { ok: false, cliId: id, error }
  }
}

/** Where each CLI's official installer script is hosted. Reachability of this
 * host decides whether the native path is worth attempting at all. */
const NATIVE_INSTALL_HOST: Partial<Record<CliId, string>> = {
  'claude-code': 'claude.ai',
  hermes: 'hermes-agent.nousresearch.com'
}

export interface InstallStep {
  /** 'native' and 'official' run a vendor install script; 'npm' uses the
   * user's registry, and 'mirror' is attempted only after the primary source
   * is unreachable or fails. */
  kind: 'native' | 'npm' | 'official' | 'mirror'
  file: string
  args: string[]
  label: string
  timeoutMs: number
  env?: NodeJS.ProcessEnv
}

function powershellFile(): string {
  return process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
}

function powershellStep(
  kind: InstallStep['kind'],
  script: string[],
  label: string,
  timeoutMs: number
): InstallStep {
  return {
    kind,
    file: powershellFile(),
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      [
        '$ErrorActionPreference = "Stop"',
        '$ProgressPreference = "SilentlyContinue"',
        ...script
      ].join('; ')
    ],
    label,
    timeoutMs
  }
}

function bashStep(
  kind: InstallStep['kind'],
  command: string,
  label: string,
  timeoutMs: number
): InstallStep {
  return { kind, file: 'bash', args: ['-lc', command], label, timeoutMs }
}

/** The official Claude Code installer. It is the recommended path because it
 * self-updates in the background, but it is served from claude.ai, which is not
 * reachable everywhere — hence the npm fallback in `installStepsFor`. */
function claudeNativeStep(platform: NodeJS.Platform): InstallStep {
  const timeoutMs = 5 * 60_000
  if (platform === 'win32') {
    return powershellStep(
      'native',
      ['irm https://claude.ai/install.ps1 | iex'],
      'irm https://claude.ai/install.ps1 | iex',
      timeoutMs
    )
  }
  return bashStep(
    'native',
    'curl -fsSL --connect-timeout 10 --max-time 300 https://claude.ai/install.sh | bash',
    'curl -fsSL https://claude.ai/install.sh | bash',
    timeoutMs
  )
}

/** Hermes Agent is a Python app distributed by its own installer script. */
function hermesOfficialStep(platform: NodeJS.Platform): InstallStep {
  const timeoutMs = 10 * 60_000
  const label = 'Hermes official installer'
  if (platform === 'win32') {
    return powershellStep(
      'official',
      [
        '$tmp = [System.IO.Path]::GetTempFileName()',
        '$installer = $tmp + ".ps1"',
        'Invoke-WebRequest -UseBasicParsing https://hermes-agent.nousresearch.com/install.ps1 -OutFile $installer',
        '& $installer -SkipSetup -NonInteractive',
        'Remove-Item $installer -ErrorAction SilentlyContinue'
      ],
      label,
      timeoutMs
    )
  }
  return bashStep(
    'official',
    'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --skip-setup --non-interactive',
    label,
    timeoutMs
  )
}

function hermesMirrorBashCommand(): string {
  return [
    'set -euo pipefail',
    `mirror_repo='${HERMES_MIRROR.repo}'`,
    `official_repo='${HERMES_MIRROR.officialRepo}'`,
    `release_tag='${HERMES_MIRROR.tag}'`,
    `expected_tag_object='${HERMES_MIRROR.tagObject}'`,
    `expected_commit='${HERMES_MIRROR.commit}'`,
    `expected_installer_sha='${HERMES_MIRROR.sh256}'`,
    'hermes_home="${HERMES_HOME:-$HOME/.hermes}"',
    'install_dir="${HERMES_INSTALL_DIR:-$hermes_home/hermes-agent}"',
    'if [ -e "$install_dir" ] && [ ! -d "$install_dir/.git" ]; then echo "Hermes install directory exists but is not a Git repository: $install_dir" >&2; exit 1; fi',
    'if [ -d "$install_dir/.git" ]; then git -C "$install_dir" fetch --depth 1 "$mirror_repo" "+refs/tags/$release_tag:refs/tags/$release_tag"; else mkdir -p "$(dirname "$install_dir")"; GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --branch "$release_tag" "$mirror_repo" "$install_dir"; fi',
    'actual_tag_object="$(git -C "$install_dir" rev-parse "refs/tags/$release_tag")"',
    '[ "$actual_tag_object" = "$expected_tag_object" ] || { echo "Hermes mirror tag object mismatch" >&2; exit 1; }',
    'actual_commit="$(git -C "$install_dir" rev-parse "refs/tags/$release_tag^{}")"',
    '[ "$actual_commit" = "$expected_commit" ] || { echo "Hermes mirror commit mismatch" >&2; exit 1; }',
    'git -C "$install_dir" checkout --detach "$expected_commit"',
    'if command -v sha256sum >/dev/null 2>&1; then actual_installer_sha="$(sha256sum "$install_dir/scripts/install.sh" | awk \'{print $1}\')"; elif command -v shasum >/dev/null 2>&1; then actual_installer_sha="$(shasum -a 256 "$install_dir/scripts/install.sh" | awk \'{print $1}\')"; else echo "No SHA-256 tool is available to verify the Hermes installer" >&2; exit 1; fi',
    '[ "$actual_installer_sha" = "$expected_installer_sha" ] || { echo "Hermes mirror installer checksum mismatch" >&2; exit 1; }',
    'git -C "$install_dir" remote set-url origin "$official_repo"',
    'if [ ! -e "$hermes_home/bin/uv" ] && command -v uv >/dev/null 2>&1; then mkdir -p "$hermes_home/bin"; ln -s "$(command -v uv)" "$hermes_home/bin/uv"; fi',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$mirror_repo.insteadOf" GIT_CONFIG_VALUE_0="$official_repo" bash "$install_dir/scripts/install.sh" --branch "$release_tag" --commit "$expected_commit" --skip-setup --non-interactive'
  ].join('\n')
}

function hermesMirrorPowerShellScript(): string[] {
  return [
    `$mirrorRepo = '${HERMES_MIRROR.repo}'`,
    `$officialRepo = '${HERMES_MIRROR.officialRepo}'`,
    `$releaseTag = '${HERMES_MIRROR.tag}'`,
    `$expectedTagObject = '${HERMES_MIRROR.tagObject}'`,
    `$expectedCommit = '${HERMES_MIRROR.commit}'`,
    `$expectedInstallerShas = @('${HERMES_MIRROR.ps1LfSha256}', '${HERMES_MIRROR.ps1CrLfSha256}')`,
    '$hermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } elseif ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "hermes" } else { Join-Path $env:USERPROFILE ".hermes" }',
    '$installDir = if ($env:HERMES_INSTALL_DIR) { $env:HERMES_INSTALL_DIR } else { Join-Path $hermesHome "hermes-agent" }',
    'if ((Test-Path -LiteralPath $installDir) -and -not (Test-Path -LiteralPath (Join-Path $installDir ".git"))) { throw "Hermes install directory exists but is not a Git repository: $installDir" }',
    'if (Test-Path -LiteralPath (Join-Path $installDir ".git")) { & git -C $installDir fetch --depth 1 $mirrorRepo "+refs/tags/${releaseTag}:refs/tags/${releaseTag}"; if ($LASTEXITCODE -ne 0) { throw "Failed to fetch the pinned Hermes mirror tag" } } else { New-Item -ItemType Directory -Force -Path (Split-Path $installDir -Parent) | Out-Null; $env:GIT_LFS_SKIP_SMUDGE = "1"; & git clone --depth 1 --branch $releaseTag $mirrorRepo $installDir; if ($LASTEXITCODE -ne 0) { throw "Failed to clone the Hermes mirror" } }',
    '$actualTagObject = ((& git -C $installDir rev-parse "refs/tags/$releaseTag") | Out-String).Trim(); if ($LASTEXITCODE -ne 0 -or $actualTagObject -ne $expectedTagObject) { throw "Hermes mirror tag object mismatch" }',
    '$actualCommit = ((& git -C $installDir rev-parse "refs/tags/$releaseTag^{}") | Out-String).Trim(); if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $expectedCommit) { throw "Hermes mirror commit mismatch" }',
    '& git -C $installDir checkout --detach $expectedCommit; if ($LASTEXITCODE -ne 0) { throw "Failed to check out the pinned Hermes release" }',
    '$installer = Join-Path $installDir "scripts\\install.ps1"',
    '$actualInstallerSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant(); if ($expectedInstallerShas -notcontains $actualInstallerSha) { throw "Hermes mirror installer checksum mismatch" }',
    '& git -C $installDir remote set-url origin $officialRepo; if ($LASTEXITCODE -ne 0) { throw "Failed to restore the official Hermes Git remote" }',
    '$managedUv = Join-Path $hermesHome "bin\\uv.exe"; $systemUv = Get-Command uv.exe -ErrorAction SilentlyContinue; if (-not (Test-Path -LiteralPath $managedUv) -and $systemUv) { New-Item -ItemType Directory -Force -Path (Split-Path $managedUv -Parent) | Out-Null; Copy-Item -LiteralPath $systemUv.Source -Destination $managedUv }',
    '$env:GIT_CONFIG_COUNT = "1"',
    '$env:GIT_CONFIG_KEY_0 = "url.$mirrorRepo.insteadOf"',
    '$env:GIT_CONFIG_VALUE_0 = $officialRepo',
    '& $installer -Branch $releaseTag -Commit $expectedCommit -SkipSetup -NonInteractive'
  ]
}

function hermesMirrorStep(platform: NodeJS.Platform): InstallStep {
  const timeoutMs = 15 * 60_000
  const env = {
    npm_config_registry: NPM_FALLBACK_REGISTRY,
    PIP_INDEX_URL: PYPI_FALLBACK_INDEX,
    UV_DEFAULT_INDEX: PYPI_FALLBACK_INDEX,
    UV_INDEX_URL: PYPI_FALLBACK_INDEX,
    PLAYWRIGHT_DOWNLOAD_HOST: PLAYWRIGHT_FALLBACK_HOST
  }
  if (platform === 'win32') {
    return {
      ...powershellStep(
        'mirror',
        hermesMirrorPowerShellScript(),
        'Hermes verified mirror',
        timeoutMs
      ),
      env
    }
  }
  return {
    ...bashStep('mirror', hermesMirrorBashCommand(), 'Hermes verified mirror', timeoutMs),
    env
  }
}

function npmStep(npmPath: string, pkg: string): InstallStep {
  return {
    kind: 'npm',
    file: npmPath,
    // No registry flag is passed: the user's own npm configuration (and
    // therefore any mirror they rely on) must win.
    args: ['install', '-g', `${pkg}@latest`, '--no-audit', '--no-fund', '--no-update-notifier'],
    label: `npm install -g ${pkg}@latest`,
    timeoutMs: 10 * 60_000
  }
}

function npmMirrorStep(npmPath: string, pkg: string): InstallStep {
  return {
    kind: 'mirror',
    file: npmPath,
    args: ['install', '-g', `${pkg}@latest`, '--no-audit', '--no-fund', '--no-update-notifier'],
    label: `npm install -g ${pkg}@latest via npmmirror.com`,
    timeoutMs: 10 * 60_000,
    env: { npm_config_registry: NPM_FALLBACK_REGISTRY }
  }
}

/** The ordered install attempts for a CLI that is not on this machine. Pure, so
 * the fallback ordering is unit-testable without touching the network. */
export function installStepsFor(
  id: CliId,
  opts: {
    platform?: NodeJS.Platform
    npmPath?: string
    /** Result of probing `NATIVE_INSTALL_HOST[id]`; `false` skips the native
     * attempt entirely instead of waiting for it to time out. */
    nativeReachable?: boolean
  } = {}
): InstallStep[] {
  const platform = opts.platform ?? process.platform
  if (id === 'hermes') {
    return opts.nativeReachable === false
      ? [hermesMirrorStep(platform)]
      : [hermesOfficialStep(platform), hermesMirrorStep(platform)]
  }
  const steps: InstallStep[] = []
  if (id === 'claude-code' && opts.nativeReachable !== false) {
    steps.push(claudeNativeStep(platform))
  }
  if (isNpmCliId(id) && opts.npmPath) {
    steps.push(npmStep(opts.npmPath, NPM_PACKAGES[id]))
    steps.push(npmMirrorStep(opts.npmPath, NPM_PACKAGES[id]))
  }
  return steps
}

function noInstallerMessage(id: CliId): string {
  const command = SYSTEM_COMMANDS[id]
  if (id === 'hermes') {
    return `Cannot install ${command}: neither the official source nor the verified mirror is available. Check your network, then install it from the official docs.`
  }
  return `Cannot install ${command} automatically: npm was not detected. Install a current version of Node.js / npm, then try again.`
}

/**
 * One-click install for a CLI the user does not have. Deliberately never
 * reinstalls, repairs, or updates: if the command is already on disk this
 * degrades to plain linking, so an existing install is left untouched.
 *
 * Claude Code tries its official native installer first and falls back to npm
 * when claude.ai is unreachable or the script fails. Every npm install keeps
 * the user's registry first and uses npmmirror only after that attempt fails.
 * Hermes falls back to a checksum-pinned official release from GitCode.
 */
export async function installMissingCli(id: CliId, onProgress: Progress): Promise<CliLinkResult> {
  try {
    const configured = loadConfig().install[id].binPath
    // Explicit guard: if the user already has a configured binary on disk, link
    // it rather than installing anything — even if it is not currently on PATH.
    if (configured && existsSync(configured)) {
      onProgress('link', `${SYSTEM_COMMANDS[id]} is already installed; linking it instead`)
      return await linkExistingSystemCli(id, onProgress, configured)
    }

    const detection = await detectSystemCli(id, configured)
    if (detection.installed) {
      onProgress('link', `${detection.command} is already installed; linking it instead`)
      return await linkExistingSystemCli(id, onProgress, detection.selectedPath)
    }

    const npmPath = isNpmCliId(id) ? ((await which('npm')) ?? undefined) : undefined
    const nativeHost = NATIVE_INSTALL_HOST[id]
    let nativeReachable: boolean | undefined
    if (nativeHost) {
      onProgress('install', `Checking whether ${nativeHost} is reachable…`)
      nativeReachable = await isReachable(`https://${nativeHost}/`)
      if (!nativeReachable) {
        onProgress(
          'install',
          npmPath
            ? `${nativeHost} is unreachable; installing with npm instead`
            : `${nativeHost} is unreachable`
        )
      }
    }

    const steps = installStepsFor(id, { npmPath, nativeReachable })
    if (!steps.length) throw new Error(noInstallerMessage(id))

    let lastError: unknown
    for (const step of steps) {
      onProgress(step.kind, `Running ${step.label}…`)
      try {
        await runStreaming(step.file, step.args, onProgress, step.label, step.timeoutMs, step.env)
      } catch (e) {
        lastError = e
        // A failed installer may still have placed the binary somewhere we
        // search on the next detection pass. If so, link it instead of falling
        // back to another installer.
        const retry = await detectSystemCli(id, configured)
        if (retry.installed) {
          onProgress('link', `${retry.command} is already installed; linking it instead`)
          return await linkExistingSystemCli(id, onProgress, retry.selectedPath)
        }
        continue
      }
      try {
        return await linkExistingSystemCli(id, onProgress)
      } catch (e) {
        // The command finished but nothing landed on a path we search — try the
        // next strategy rather than reporting a successful install.
        lastError = new Error(
          `${step.label} finished, but ${SYSTEM_COMMANDS[id]} could not be located: ${
            e instanceof Error ? e.message : String(e)
          }`
        )
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    onProgress('error', error)
    return { ok: false, cliId: id, error }
  }
}

export async function getCliUpdateStatuses(): Promise<CliUpdateStatus[]> {
  const cfg = loadConfig()
  const checkedAt = Date.now()
  return Promise.all(
    ([...NPM_CLI_IDS, 'hermes'] as CliId[]).map(async (cliId) => {
      const install = cfg.install[cliId]
      const configured = install.installed
      const installed = configured && cliFilesExist(cliId, install)
      const stale = configured && !installed
      const legacyManaged = install.legacyManaged === true
      try {
        // System binaries are also updated outside the app; re-probe the live
        // version instead of trusting the recorded one, so a finished update
        // (or an external one) clears the "update available" badge.
        let currentVersion = install.version
        if (installed && !legacyManaged && install.binPath) {
          const realPath = await normalizePath(install.binPath)
          const inspection =
            cliId === 'codex' ? inspectCodexInstall(install.binPath, realPath) : undefined
          const live = await systemVersion(cliId, install.binPath, realPath)
          const nextVersion = versionParts(live) ? live : currentVersion
          if (
            nextVersion !== currentVersion ||
            inspection?.installKind !== install.installKind ||
            inspection?.packageManager !== install.packageManager
          ) {
            setInstallState(cliId, {
              ...install,
              version: nextVersion,
              installKind: inspection?.installKind,
              packageManager: inspection?.packageManager
            })
            currentVersion = nextVersion
          }
        }
        // Hermes releases live on PyPI; the other CLIs publish to npm.
        const latestVersion = isNpmCliId(cliId)
          ? (await npmMeta(`${NPM_PACKAGES[cliId]}/latest`)).version
          : await hermesLatestVersion()
        return {
          cliId,
          installed,
          configured,
          stale,
          source: install.source,
          legacyManaged,
          currentVersion,
          latestVersion,
          updateAvailable: installed
            ? legacyManaged || isVersionNewer(latestVersion, currentVersion)
            : configured,
          binPath: install.binPath,
          checkedAt
        }
      } catch (e) {
        return {
          cliId,
          installed,
          configured,
          stale,
          source: install.source,
          legacyManaged,
          currentVersion: install.version,
          updateAvailable: installed && legacyManaged,
          binPath: install.binPath,
          error: e instanceof Error ? e.message : String(e),
          checkedAt
        }
      }
    })
  )
}
