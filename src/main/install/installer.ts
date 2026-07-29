import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { paths } from '../sandbox'
import { hermesHomeDir } from '../config-paths'
import { macosSecurityManualUpdateMessage } from '../cli-launch-safety'
import { decodeProcessOutput, lastLines, spawnProcess } from '../process'
import { loadConfig, setInstallState } from '../store'
import type {
  CliId,
  CliInstallState,
  CliLinkResult,
  CliUpdateStatus,
  CleanupCliResult,
  SystemCliCandidate,
  SystemCliDetection
} from '@shared/types'
import { fetchJson } from './download'
import {
  codexInstallLabel,
  inspectCodexInstall,
  isExplicitMacSecurityAssessmentFailure,
  type CodexInstallInspection
} from './codex-safety'

type Progress = (phase: string, message: string, fraction?: number) => void

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

function isNpmCliId(id: CliId): id is NpmCliId {
  return id !== 'hermes'
}

const NODE_NPM_ENTRY_ROOT: Partial<Record<CliId, string[]>> = {
  pi: ['node_modules', '@earendil-works', 'pi-coding-agent']
}

function commonCliPathDirs(): string[] {
  if (process.platform === 'win32') return []
  return [
    join(homedir(), '.local', 'bin'),
    join(homedir(), 'local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ]
}

function envForCommand(commandPath: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const existing = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const commandDir =
    isAbsolute(commandPath) || commandPath.includes('/') || commandPath.includes('\\')
      ? dirname(commandPath)
      : undefined
  env.PATH = uniquePaths(
    [commandDir, ...commonCliPathDirs(), ...existing].filter((path): path is string => !!path)
  ).join(delimiter)
  return env
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
  return uniquePaths([...(process.env.PATH ?? '').split(delimiter), ...commonCliPathDirs()])
    .filter(Boolean)
    .flatMap((dir) => names.map((name) => join(dir, name)))
}

function commandNames(cmd: string): string[] {
  const exts =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : ['']
  return process.platform === 'win32' && !/\.[A-Za-z0-9]+$/.test(cmd)
    ? exts.map((ext) => `${cmd}${ext.toLowerCase()}`)
    : [cmd]
}

function versionedBinDirs(root: string, suffix: string[]): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
      .map((entry) => join(root, entry.name, ...suffix))
  } catch {
    return []
  }
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
  return uniquePaths([
    ...commonCliPathDirs(),
    ...versionedBinDirs(join(homedir(), '.nvm', 'versions', 'node'), ['bin']),
    ...versionedBinDirs(join(homedir(), '.local', 'share', 'fnm', 'node-versions'), [
      'installation',
      'bin'
    ]),
    ...versionedBinDirs(join(homedir(), 'Library', 'Application Support', 'fnm', 'node-versions'), [
      'installation',
      'bin'
    ]),
    ...versionedBinDirs(join(homedir(), '.local', 'share', 'mise', 'installs', 'node'), ['bin']),
    join(homedir(), '.volta', 'bin'),
    join(homedir(), '.bun', 'bin'),
    ...[
      process.env.PNPM_HOME,
      join(homedir(), 'Library', 'pnpm'),
      join(homedir(), '.local', 'share', 'pnpm')
    ].filter((dir): dir is string => !!dir)
  ])
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
  if (id === 'codex') return uniquePaths([...candidates, ...codexExtraCandidates()])
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
    const p = spawn(finder, args, { stdio: ['ignore', 'pipe', 'ignore'] })
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
export function findSystemCommand(cmd: string): Promise<string | null> {
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
  const candidates = await systemCandidates(id)
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
  if (install.source !== 'sandbox') return true
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

export async function getCliUpdateStatuses(): Promise<CliUpdateStatus[]> {
  const cfg = loadConfig()
  const checkedAt = Date.now()
  return Promise.all(
    ([...NPM_CLI_IDS, 'hermes'] as CliId[]).map(async (cliId) => {
      const install = cfg.install[cliId]
      const configured = install.installed
      const installed = configured && cliFilesExist(cliId, install)
      const stale = configured && !installed
      const legacyManaged = install.source === 'sandbox'
      try {
        // System binaries are also updated outside the app; re-probe the live
        // version instead of trusting the recorded one, so a finished update
        // (or an external one) clears the "update available" badge.
        let currentVersion = install.version
        if (installed && install.source === 'system' && install.binPath) {
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
