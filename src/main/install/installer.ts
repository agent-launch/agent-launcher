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
  CliUpdateStatus,
  CodexInstallKind,
  CodexPackageManager,
  CleanupCliResult,
  InstallAction,
  InstallOptions,
  InstallResult,
  SystemCliCandidate,
  SystemCliDetection
} from '@shared/types'
import { fetchJson } from './download'
import {
  codexInstallLabel,
  codexUpdateStrategy,
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
  hermes: 'hermes'
}

type NpmCliId = Exclude<CliId, 'hermes'>

const NPM_CLI_IDS: NpmCliId[] = ['claude-code', 'codex', 'opencode', 'pi']

const NPM_PACKAGES: Record<NpmCliId, string> = {
  'claude-code': '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  opencode: 'opencode-ai',
  pi: '@earendil-works/pi-coding-agent'
}

function isNpmCliId(id: CliId): id is NpmCliId {
  return id !== 'hermes'
}

const NODE_NPM_ENTRY_ROOT: Partial<Record<CliId, string[]>> = {
  pi: ['node_modules', '@earendil-works', 'pi-coding-agent']
}

const OFFICIAL_UPDATE_ARGS: Partial<Record<CliId, string[]>> = {
  'claude-code': ['update'],
  codex: ['update'],
  opencode: ['upgrade']
}

interface SystemUpdateCommand {
  file: string
  args: string[]
  label: string
}

function pathText(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

function inferInstallManager(binPath: string, realPath = binPath): string {
  const s = `${pathText(binPath)}\n${pathText(realPath)}`
  if (s.includes('/.nvm/')) return 'nvm'
  if (s.includes('/homebrew/') || s.includes('/cellar/')) return 'homebrew'
  if (s.includes('/.volta/') || s.includes('/volta/')) return 'volta'
  if (s.includes('fnm_multishells')) return 'fnm'
  if (s.includes('/mise/')) return 'mise'
  if (s.includes('/.bun/')) return 'bun'
  if (s.includes('/pnpm/')) return 'pnpm'
  if (s.includes('/scoop/')) return 'scoop'
  return 'system'
}

function brewFormulaFromPath(realPath: string): string | null {
  const parts = realPath.replace(/\\/g, '/').split('/')
  const cellarIndex = parts.findIndex((part) => part.toLowerCase() === 'cellar')
  return cellarIndex >= 0 ? parts[cellarIndex + 1] || null : null
}

function brewCommand(binPath: string, realPath: string): string | null {
  const candidates = [
    siblingBin(binPath, 'brew'),
    realPath.startsWith('/opt/homebrew/') ? '/opt/homebrew/bin/brew' : undefined,
    realPath.startsWith('/usr/local/') ? '/usr/local/bin/brew' : undefined
  ]
  return candidates.find((candidate): candidate is string => !!candidate && existsSync(candidate)) ?? null
}

function siblingBin(binPath: string, name: string): string | null {
  const dir = dirname(binPath)
  if (!dir || dir === binPath) return null
  if (process.platform !== 'win32') {
    const candidate = join(dir, name)
    return existsSync(candidate) ? candidate : null
  }
  const hasExt = /\.[A-Za-z0-9]+$/.test(name)
  const base = join(dir, name)
  const candidates = hasExt ? [base] : ['.cmd', '.exe', '.bat', ''].map((ext) => `${base}${ext}`)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
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
  const commandDir = isAbsolute(commandPath) || commandPath.includes('/') || commandPath.includes('\\')
    ? dirname(commandPath)
    : undefined
  env.PATH = uniquePaths([commandDir, ...commonCliPathDirs(), ...existing].filter((path): path is string => !!path)).join(delimiter)
  return env
}

function spawnInstallerProcess(cmd: string, args: string[], options: Parameters<typeof spawnProcess>[2]) {
  return spawnProcess(cmd, args, { ...options, env: { ...envForCommand(cmd), ...options?.env } })
}

function packageManagerUpdateCommand(
  id: CliId,
  binPath: string,
  realPath: string,
  installKind?: CodexInstallKind,
  recordedManager?: CodexPackageManager
): SystemUpdateCommand | null {
  if (id === 'codex' && installKind === 'homebrew-cask') {
    const brew = brewCommand(binPath, realPath)
    return brew ? { file: brew, args: ['upgrade', '--cask', 'codex'], label: 'brew upgrade --cask codex' } : null
  }
  const formula = brewFormulaFromPath(realPath)
  if (formula) {
    const brew = brewCommand(binPath, realPath)
    if (brew) return { file: brew, args: ['upgrade', formula], label: `brew upgrade ${formula}` }
  }

  if (!isNpmCliId(id)) return null
  const pkg = NPM_PACKAGES[id]
  const manager = recordedManager ?? inferInstallManager(binPath, realPath)
  if (manager === 'volta') {
    const volta = siblingBin(binPath, 'volta')
    if (volta) return { file: volta, args: ['install', pkg], label: `volta install ${pkg}` }
  }
  if (manager === 'bun') {
    const bun = siblingBin(binPath, 'bun')
    if (bun) return { file: bun, args: ['add', '-g', `${pkg}@latest`], label: `bun add -g ${pkg}@latest` }
  }
  if (manager === 'pnpm') {
    const pnpm = siblingBin(binPath, 'pnpm')
    if (pnpm) return { file: pnpm, args: ['add', '-g', `${pkg}@latest`], label: `pnpm add -g ${pkg}@latest` }
  }
  if (manager === 'homebrew') return null

  // nvm/fnm/mise/Homebrew npm installs, plus classic /usr/local npm installs,
  // usually place npm next to the CLI shim. Anchor to that npm instead of PATH.
  const npm = siblingBin(binPath, 'npm')
  if (npm) return { file: npm, args: ['i', '-g', `${pkg}@latest`], label: `npm i -g ${pkg}@latest` }
  return null
}

function officialUpdateCommand(id: CliId, binPath: string): SystemUpdateCommand | null {
  const args = OFFICIAL_UPDATE_ARGS[id]
  return args ? { file: binPath, args, label: `${basename(binPath)} ${args.join(' ')}` } : null
}

function systemUpdateCommands(
  id: CliId,
  binPath: string,
  realPath: string,
  installKind?: CodexInstallKind,
  packageManager?: CodexPackageManager
): SystemUpdateCommand[] {
  const packageCommand = packageManagerUpdateCommand(id, binPath, realPath, installKind, packageManager)
  const officialCommand = officialUpdateCommand(id, binPath)
  if (id === 'codex') {
    const strategy = installKind ? codexUpdateStrategy(installKind) : 'npm-reinstall'
    if (strategy === 'self-update') return officialCommand ? [officialCommand] : []
    if (strategy === 'package-manager') return packageCommand ? [packageCommand] : []
    return []
  }
  if ((id === 'claude-code' || id === 'opencode') && officialCommand) {
    return packageCommand ? [officialCommand, packageCommand] : [officialCommand]
  }
  if (packageCommand) return [packageCommand]
  return officialCommand ? [officialCommand] : []
}

function npmMeta(spec: string): Promise<NpmDist> {
  return fetchJson<NpmDist>(`https://registry.npmjs.org/${spec}`)
}

/** Hermes Agent is a Python app installed by the official installer script
 * (pip under the hood); its releases are published on PyPI, not npm. */
async function hermesLatestVersion(): Promise<string> {
  const meta = await fetchJson<{ info?: { version?: string } }>('https://pypi.org/pypi/hermes-agent/json')
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
  let stamp = target
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
    const p = spawnInstallerProcess(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout!.on('data', (d) => (out += decodeProcessOutput(d)))
    p.stderr!.on('data', (d) => (err += decodeProcessOutput(d)))
    p.on('error', reject)
    p.on('close', (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(lastLines(err || out, 8) || `exit ${code}`))
    )
  })
}

async function npmGlobalBinDir(npm: string): Promise<string> {
  try {
    const prefix = (await run(npm, ['prefix', '-g'])).trim()
    if (prefix) return process.platform === 'win32' ? prefix : join(prefix, 'bin')
  } catch {
    /* classic npm layouts place global commands beside npm */
  }
  return dirname(npm)
}

async function npmInstalledCommand(npm: string, command: string): Promise<string | undefined> {
  const dirs = uniquePaths([await npmGlobalBinDir(npm), dirname(npm)])
  return dirs
    .flatMap((dir) => commandNames(command).map((name) => join(dir, name)))
    .find((candidate) => existsSync(candidate))
}

function runStreaming(cmd: string, args: string[], onProgress: Progress, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawnInstallerProcess(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const append = (chunk: Buffer) => {
      tail = `${tail}${decodeProcessOutput(chunk)}`.slice(-3000)
      const line = tail
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .at(-1)
      if (line) onProgress('system', `${label}: ${line}`)
    }
    p.stdout!.on('data', append)
    p.stderr!.on('data', append)
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(lastLines(tail, 8) || `${cmd} ${args.join(' ')} exit ${code}`))
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
  return uniquePaths([...(process.env.PATH ?? '').split(delimiter), ...commonCliPathDirs()])
    .filter(Boolean)
    .flatMap((dir) => names.map((name) => join(dir, name)))
}

function commandNames(cmd: string): string[] {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : ['']
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
    ...versionedBinDirs(join(homedir(), '.local', 'share', 'fnm', 'node-versions'), ['installation', 'bin']),
    ...versionedBinDirs(join(homedir(), 'Library', 'Application Support', 'fnm', 'node-versions'), [
      'installation',
      'bin'
    ]),
    ...versionedBinDirs(join(homedir(), '.local', 'share', 'mise', 'installs', 'node'), ['bin']),
    join(homedir(), '.volta', 'bin'),
    join(homedir(), '.bun', 'bin'),
    ...[process.env.PNPM_HOME, join(homedir(), 'Library', 'pnpm'), join(homedir(), '.local', 'share', 'pnpm')].filter(
      (dir): dir is string => !!dir
    )
  ])
}

function codexExtraCandidates(): string[] {
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat', 'codex'] : ['codex']
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  const customInstallDir = process.env.CODEX_INSTALL_DIR
  const visibleDirs =
    process.platform === 'win32'
      ? [customInstallDir, process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin') : undefined]
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
  if (isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) return existsSync(cmd) ? [cmd] : []
  const direct = uniquePaths(commandSearchCandidates(cmd, id).filter((candidate) => existsSync(candidate)))
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
      version: macosSecurityRisk ? codexInspection?.version : await systemVersion(id, path, realPath),
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
    const configuredKey = process.platform === 'win32' ? configuredRealPath.toLowerCase() : configuredRealPath
    const hasConfigured = candidates.some((c) => {
      const key = process.platform === 'win32' ? (c.realPath ?? c.path).toLowerCase() : (c.realPath ?? c.path)
      return key === configuredKey
    })
    if (!hasConfigured) {
      const codexInspection = id === 'codex' ? inspectCodexInstall(configuredBinPath, configuredRealPath) : undefined
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
    ? candidates.find((candidate) => candidate.path === selectedPath || candidate.realPath === selectedPath)
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

async function installHermesAgent(onProgress: Progress): Promise<void> {
  onProgress('system', 'Running the official Hermes installer…')
  if (process.platform === 'win32') {
    const ps = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe'
    const script = [
      '$ErrorActionPreference = "Stop"',
      '$ProgressPreference = "SilentlyContinue"',
      '$installer = Join-Path $env:TEMP "hermes-agent-install.ps1"',
      'Invoke-WebRequest -UseBasicParsing https://hermes-agent.nousresearch.com/install.ps1 -OutFile $installer',
      '& $installer -SkipSetup -NonInteractive'
    ].join('; ')
    await runStreaming(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], onProgress, 'Hermes')
    return
  }
  await runStreaming(
    'bash',
    ['-lc', 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --skip-setup --non-interactive'],
    onProgress,
    'Hermes'
  )
}

async function installSystemCli(
  id: CliId,
  onProgress: Progress,
  reinstall: boolean
): Promise<string | undefined> {
  if (id === 'hermes') {
    await installHermesAgent(onProgress)
    return undefined
  }
  const npm = await which('npm')
  if (npm) {
    if (!isNpmCliId(id)) throw new Error(`${SYSTEM_COMMANDS[id]} does not support automatic installation`)
    const pkg = NPM_PACKAGES[id]
    onProgress('system', `${reinstall ? 'Reinstalling' : 'Installing'} ${pkg}…`)
    await runStreaming(
      npm,
      ['install', '-g', `${pkg}@latest`, '--no-audit', '--no-fund', '--no-update-notifier'],
      onProgress,
      'npm'
    )
    return npmInstalledCommand(npm, SYSTEM_COMMANDS[id])
  }

  const command = SYSTEM_COMMANDS[id]
  throw new Error(`Cannot install ${command} automatically: npm was not detected. Install Node/npm and try again.`)
}

async function updateSystemCli(id: CliId, onProgress: Progress, binPath?: string): Promise<string> {
  const selected = binPath ?? loadConfig().install[id].binPath
  if (!selected) {
    throw new Error('No system CLI path is recorded. Relink the system CLI first.')
  }
  if (!existsSync(selected)) {
    throw new Error(`System command does not exist: ${selected}`)
  }
  const realSelected = await normalizePath(selected)
  const detection = await detectSystemCli(id, selected)
  const candidate = detection.candidates.find(
    (item) => item.path === selected || item.realPath === selected || item.realPath === realSelected
  )
  const commands = systemUpdateCommands(
    id,
    selected,
    realSelected,
    candidate?.installKind,
    candidate?.packageManager
  )
  if (candidate?.macosSecurityRisk) {
    // Product policy requires a manual uninstall/update for a blocked binary.
    // Do not run either the binary itself or a package-manager repair here.
    throw new Error(macosSecurityManualUpdateMessage(id))
  }
  if (!commands.length) {
    if (id === 'codex') {
      const method = candidate?.installKind
        ? codexInstallLabel(candidate.installKind, candidate.packageManager)
        : 'original install method'
      throw new Error(`Automatic update is not available for this ${method}. Reinstall Codex with npm instead.`)
    }
    throw new Error(
      `Automatic update is not available for ${SYSTEM_COMMANDS[id]}. Reinstall it with the system npm instead.`
    )
  }

  // Self-updaters like `claude update` can exit 0 after updating a different
  // (self-managed) copy of the CLI, leaving the linked binary untouched. Only
  // trust a command when the linked binary's version actually moved (or is
  // already at the registry latest) — otherwise fall through to the next one.
  const before = await systemVersion(id, selected, realSelected)
  let latest: string | undefined
  if (isNpmCliId(id)) {
    try {
      latest = (await npmMeta(`${NPM_PACKAGES[id]}/latest`)).version
    } catch {
      /* offline registry check — fall back to before/after comparison only */
    }
  }

  let lastError: unknown
  for (const command of commands) {
    try {
      onProgress('system', `Running ${command.label}…`)
      await runStreaming(command.file, command.args, onProgress, command.label)
    } catch (e) {
      lastError = e
      continue
    }
    const after = await systemVersion(id, selected, await normalizePath(selected))
    const probed = !!versionParts(after)
    const changed = probed && after !== before
    const atLatest = probed && !!latest && !isVersionNewer(latest, after)
    if (changed || atLatest) return selected
    lastError = new Error(
      `${command.label} finished, but ${basename(selected)} still reports ${after}. ` +
        'The update likely went to another install that shadows this path. Remove this copy and reinstall with Agent Launcher, or update it with its original install method.'
    )
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
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
    if (!matched) throw new Error('This path is not a detected CLI candidate; cleanup was cancelled')

    const backupPath = backupPathForCli(id, binPath)
    mkdirSync(dirname(backupPath), { recursive: true })
    renameSync(binPath, backupPath)
    return { ok: true, cliId: id, path: binPath, backupPath }
  } catch (e) {
    return { ok: false, cliId: id, path: binPath, error: e instanceof Error ? e.message : String(e) }
  }
}

async function linkSystemCli(id: CliId, onProgress: Progress, binPath?: string): Promise<InstallResult> {
  onProgress('link', 'Finding system CLI…')
  const target = SYSTEM_COMMANDS[id]
  const detection = await detectSystemCli(id, binPath)
  const selected = binPath ?? detection.selectedPath
  if (!selected) throw new Error(`System command ${target} was not found. Use Install to let Agent Launcher install it.`)
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
  return { ok: true, cliId: id, version, binPath: selected, source: 'system', warning, candidates: detection.candidates }
}

async function useSystemCli(
  id: CliId,
  onProgress: Progress,
  action: InstallAction = 'link',
  binPath?: string
): Promise<InstallResult> {
  if (action === 'install' || action === 'reinstall') {
    if (id === 'hermes') {
      const installedPath = await installSystemCli(id, onProgress, action === 'reinstall')
      return linkSystemCli(id, onProgress, installedPath ?? binPath)
    }
    if (action === 'reinstall') {
      if (id === 'codex') {
        const configuredPath = binPath ?? loadConfig().install.codex.binPath
        const detection = await detectSystemCli('codex', configuredPath)
        const candidate = detection.candidates.find(
          (entry) => entry.path === configuredPath || entry.realPath === configuredPath
        )
        const strategy = candidate?.installKind
          ? codexUpdateStrategy(candidate.installKind)
          : 'npm-reinstall'
        if (candidate?.macosSecurityRisk) {
          throw new Error(macosSecurityManualUpdateMessage('codex'))
        }
        if (strategy === 'npm-reinstall') {
          onProgress('repair', 'Reinstalling Codex with npm…')
          return installCodexWithNpm(onProgress, configuredPath)
        }
      }
      const selected = await updateSystemCli(id, onProgress, binPath)
      return linkSystemCli(id, onProgress, selected)
    }
    const installedPath = await installSystemCli(id, onProgress, false)
    return linkSystemCli(id, onProgress, installedPath ?? binPath)
  }
  if (action === 'repair') {
    if (id === 'codex') return installCodexWithNpm(onProgress, binPath)
    const installedPath = await installSystemCli(id, onProgress, true)
    return linkSystemCli(id, onProgress, installedPath ?? binPath)
  }
  return linkSystemCli(id, onProgress, binPath)
}

function parseVersion(text: string): string {
  return text.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? text.trim().split(/\s+/).pop() ?? 'system'
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

function installExists(id: CliId, install: CliInstallState): boolean {
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
    if (!existsSync(join(packageRoot, 'codex-package.json')) || !existsSync(helper) || !existsSync(rg)) return false
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

async function npmForCodex(preferredCodexPath?: string): Promise<string> {
  const configuredPath = preferredCodexPath ?? loadConfig().install.codex.binPath
  const adjacent = configuredPath ? siblingBin(configuredPath, 'npm') : null
  if (adjacent) return adjacent

  const detection = await detectSystemCli('codex', configuredPath)
  for (const candidate of detection.candidates) {
    const npm = siblingBin(candidate.path, 'npm')
    if (npm) return npm
  }

  const npm = await which('npm')
  if (npm) return npm
  throw new Error('npm was not detected. Install Node.js/npm, then retry the Codex repair.')
}

/** Codex installation and repair temporarily use the user's npm environment. */
async function installCodexWithNpm(onProgress: Progress, preferredCodexPath?: string): Promise<InstallResult> {
  const npm = await npmForCodex(preferredCodexPath)
  onProgress('npm', 'Installing the latest Codex with npm…')
  await runStreaming(
    npm,
    ['install', '-g', '@openai/codex@latest', '--no-audit', '--no-fund', '--no-update-notifier'],
    onProgress,
    'npm install -g @openai/codex@latest'
  )

  const installedPath = await npmInstalledCommand(npm, 'codex')
  if (!installedPath) {
    throw new Error(`npm completed, but the installed Codex command could not be located from ${basename(npm)}`)
  }
  return linkSystemCli('codex', onProgress, installedPath)
}

export async function installCli(
  id: CliId,
  onProgress: Progress,
  opts: InstallOptions = {}
): Promise<InstallResult> {
  try {
    const action = opts.action ?? 'install'
    const legacyManagedInstall = loadConfig().install[id].source === 'sandbox'
    if (id === 'codex') {
      if (action === 'link') return await linkSystemCli('codex', onProgress, opts.binPath)
      if (action === 'install' || action === 'repair' || legacyManagedInstall) {
        if (process.platform === 'darwin') {
          const configuredPath = opts.binPath ?? loadConfig().install.codex.binPath
          const detection = await detectSystemCli('codex', configuredPath)
          if (detection.macosSecurityRisk) {
            throw new Error(macosSecurityManualUpdateMessage('codex'))
          }
        }
        return await installCodexWithNpm(onProgress, opts.binPath)
      }
      return await useSystemCli('codex', onProgress, action, opts.binPath)
    }
    // The old app-managed installation mode is read-only compatibility now.
    // Any install/repair/update migrates it to the system npm/official path.
    const effectiveAction = legacyManagedInstall && action !== 'link' ? 'install' : action
    return await useSystemCli(
      id,
      onProgress,
      effectiveAction,
      legacyManagedInstall && action !== 'link' ? undefined : opts.binPath
    )
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
      const installed = configured && installExists(cliId, install)
      const stale = configured && !installed
      const legacyManaged = install.source === 'sandbox'
      try {
        // System binaries are also updated outside the app; re-probe the live
        // version instead of trusting the recorded one, so a finished update
        // (or an external one) clears the "update available" badge.
        let currentVersion = install.version
        if (installed && install.source === 'system' && install.binPath) {
          const realPath = await normalizePath(install.binPath)
          const inspection = cliId === 'codex' ? inspectCodexInstall(install.binPath, realPath) : undefined
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
        // Hermes releases live on PyPI; the rest are npm packages. Updating
        // hermes re-runs the official installer, which always installs latest.
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
          canInstallUpdate: installed && !stale,
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
          canInstallUpdate: installed && !stale,
          binPath: install.binPath,
          error: e instanceof Error ? e.message : String(e),
          checkedAt
        }
      }
    })
  )
}
