import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { paths } from '../sandbox'
import { hermesHomeDir } from '../config-paths'
import { decodeProcessOutput, lastLines, spawnProcess } from '../process'
import { loadConfig, setInstallState } from '../store'
import type {
  CliId,
  CliInstallState,
  CliUpdateStatus,
  CleanupCliResult,
  InstallAction,
  InstallOptions,
  InstallResult,
  SystemCliCandidate,
  SystemCliDetection
} from '@shared/types'
import { detectPlatform, codexTargetTriple, opencodePlatformKey } from './platform'
import { fetchJson, downloadFile, extractArchive, verifyIntegrity } from './download'
import { ensureNode } from './node-runtime'

type Progress = (phase: string, message: string, fraction?: number) => void

interface NpmDist {
  version: string
  dist: { tarball: string; integrity?: string }
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
  return [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
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
  realPath: string
): SystemUpdateCommand | null {
  const formula = brewFormulaFromPath(realPath)
  if (formula) {
    const brew = siblingBin(binPath, 'brew')
    if (brew) return { file: brew, args: ['upgrade', formula], label: `brew upgrade ${formula}` }
  }

  if (!isNpmCliId(id)) return null
  const pkg = NPM_PACKAGES[id]
  const manager = inferInstallManager(binPath, realPath)
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

function systemUpdateCommands(id: CliId, binPath: string, realPath: string): SystemUpdateCommand[] {
  const packageCommand = packageManagerUpdateCommand(id, binPath, realPath)
  const officialCommand = officialUpdateCommand(id, binPath)
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

async function downloadAndExtract(
  tarball: string,
  destDir: string,
  onProgress: Progress,
  integrity?: string
): Promise<void> {
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true })
  mkdirSync(paths.downloads, { recursive: true })
  const archive = join(paths.downloads, `${Date.now()}-pkg.tgz`)
  onProgress('download', 'Downloading binary…', 0)
  await downloadFile(tarball, archive, (r, t) => t && onProgress('download', 'Downloading binary…', r / t))
  await verifyIntegrity(archive, integrity)
  onProgress('extract', 'Extracting…')
  // npm tarballs nest everything under package/ — strip it.
  await extractArchive(archive, destDir, 1)
  rmSync(archive, { force: true })
  await clearMacQuarantine(destDir)
}

function clearMacQuarantine(target: string): Promise<void> {
  if (process.platform !== 'darwin') return Promise.resolve()
  return new Promise((resolve) => {
    const p = spawn('xattr', ['-dr', 'com.apple.quarantine', target], { stdio: 'ignore' })
    p.on('error', () => resolve())
    p.on('close', () => resolve())
  })
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
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : ['']
  const names =
    process.platform === 'win32' && !/\.[A-Za-z0-9]+$/.test(cmd)
      ? exts.map((ext) => `${cmd}${ext.toLowerCase()}`)
      : [cmd]
  const defaultDirs =
    process.platform === 'win32'
      ? []
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  return uniquePaths([...(process.env.PATH ?? '').split(delimiter), ...defaultDirs])
    .filter(Boolean)
    .flatMap((dir) => names.map((name) => join(dir, name)))
}

function commandPathCandidates(cmd: string, id?: CliId): string[] {
  const candidates = pathCandidates(cmd)
  if (id !== 'hermes') return candidates
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : ['']
  const names =
    process.platform === 'win32' && !/\.[A-Za-z0-9]+$/.test(cmd)
      ? exts.map((ext) => `${cmd}${ext.toLowerCase()}`)
      : [cmd]
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
  const direct = uniquePaths(commandPathCandidates(cmd, id).filter((candidate) => existsSync(candidate)))
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
    out.push({ path, realPath, version: await systemVersion(path) })
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
      candidates.unshift({
        path: configuredBinPath,
        realPath: configuredRealPath,
        version: await systemVersion(configuredBinPath)
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

  const detail =
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

  return {
    cliId: id,
    command,
    candidates,
    selectedPath,
    configuredBinPath,
    installed,
    duplicate,
    status,
    detail
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

async function installSystemCli(id: CliId, onProgress: Progress, reinstall: boolean): Promise<void> {
  if (id === 'hermes') {
    await installHermesAgent(onProgress)
    return
  }
  const npm = await which('npm')
  if (npm) {
    if (!isNpmCliId(id)) throw new Error(`${SYSTEM_COMMANDS[id]} does not support automatic installation`)
    const pkg = NPM_PACKAGES[id]
    onProgress('system', `${reinstall ? 'Reinstalling' : 'Installing'} ${pkg}…`)
    const args = ['install', '-g', pkg]
    if (reinstall) {
      await runStreaming(npm, ['uninstall', '-g', pkg], onProgress, 'npm')
    }
    await runStreaming(npm, args, onProgress, 'npm')
    return
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
  const commands = systemUpdateCommands(id, selected, realSelected)
  if (!commands.length) {
    throw new Error('The CLI install manager could not be determined. Update it with the original install method, then check again here.')
  }

  let lastError: unknown
  for (const command of commands) {
    try {
      onProgress('system', `Running ${command.label}…`)
      await runStreaming(command.file, command.args, onProgress, command.label)
      return selected
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function repairSystemCli(id: CliId, onProgress: Progress): Promise<void> {
  const command = SYSTEM_COMMANDS[id]
  onProgress('repair', `Pinning the highest-priority ${command} command on PATH…`)
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
  const detection = await detectSystemCli(id)
  const selected = binPath ?? detection.selectedPath
  if (!selected) throw new Error(`System command ${target} was not found. Use Install to let Agent Launcher install it.`)
  if (!existsSync(selected)) {
    throw new Error(`System command does not exist: ${selected}`)
  }
  onProgress('verify', `Verifying ${basename(selected)}…`)
  const version = await systemVersion(selected)
  setInstallState(id, { installed: true, source: 'system', version, binPath: selected })
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
      await installSystemCli(id, onProgress, action === 'reinstall')
      return linkSystemCli(id, onProgress, binPath)
    }
    if (action === 'reinstall') {
      const selected = await updateSystemCli(id, onProgress, binPath)
      return linkSystemCli(id, onProgress, selected)
    }
    await installSystemCli(id, onProgress, false)
    return linkSystemCli(id, onProgress, binPath)
  }
  if (action === 'repair') {
    await repairSystemCli(id, onProgress)
    return linkSystemCli(id, onProgress, binPath)
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
  if (!a || !b) return !!latest && !!current && latest !== current
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
  if (install.nodeEntry) return existsSync(install.nodeEntry)
  if (NODE_NPM_ENTRY_ROOT[id]) {
    return !!install.nodeEntry && existsSync(install.nodeEntry)
  }
  return true
}

async function systemVersion(binPath: string): Promise<string> {
  try {
    return parseVersion(await run(binPath, ['--version']))
  } catch {
    return 'system'
  }
}

/** Claude Code: native binary from the platform optional-dep package. */
async function installClaude(onProgress: Progress): Promise<InstallResult> {
  const p = detectPlatform()
  onProgress('resolve', 'Resolving version…')
  const main = await npmMeta('@anthropic-ai/claude-code/latest')
  const sub = `@anthropic-ai/claude-code-${p.platformKey}`
  const subMeta = await npmMeta(`${sub}/${main.version}`)
  const dir = paths.cliInstall('claude-code')
  await downloadAndExtract(subMeta.dist.tarball, dir, onProgress, subMeta.dist.integrity)
  const binPath = join(dir, p.os === 'win32' ? 'claude.exe' : 'claude')
  if (!existsSync(binPath)) throw new Error('claude binary missing after extract')
  if (p.os !== 'win32') chmodSync(binPath, 0o755)
  onProgress('verify', 'Verifying…')
  let version = main.version
  try {
    version = (await run(binPath, ['--version'])).split(/\s+/)[0] || main.version
  } catch {
    /* keep registry version if --version fails (e.g. wrong arch under emulation) */
  }
  setInstallState('claude-code', { installed: true, source: 'sandbox', version, binPath })
  return { ok: true, cliId: 'claude-code', version, binPath, source: 'sandbox' }
}

/** Codex: native Rust binary from @openai/codex@<ver>-<platform> (keeps vendor/). */
async function installCodex(onProgress: Progress): Promise<InstallResult> {
  const p = detectPlatform()
  onProgress('resolve', 'Resolving version…')
  const main = await npmMeta('@openai/codex/latest')
  const subMeta = await npmMeta(`@openai/codex/${main.version}-${p.platformKey}`)
  const dir = paths.cliInstall('codex')
  await downloadAndExtract(subMeta.dist.tarball, dir, onProgress, subMeta.dist.integrity)
  const triple = codexTargetTriple(p)
  const binPath = join(dir, 'vendor', triple, 'bin', p.os === 'win32' ? 'codex.exe' : 'codex')
  if (!existsSync(binPath)) throw new Error(`codex binary missing: ${binPath}`)
  if (p.os !== 'win32') chmodSync(binPath, 0o755)
  onProgress('verify', 'Verifying…')
  let version = main.version
  try {
    version = (await run(binPath, ['--version'])).split(/\s+/).pop() || main.version
  } catch {
    /* keep registry version */
  }
  setInstallState('codex', { installed: true, source: 'sandbox', version, binPath })
  return { ok: true, cliId: 'codex', version, binPath, source: 'sandbox' }
}

/** opencode: native binary from the platform optional-dep package (no Node). */
async function installOpencode(onProgress: Progress): Promise<InstallResult> {
  const p = detectPlatform()
  onProgress('resolve', 'Resolving version…')
  const main = await npmMeta('opencode-ai/latest')
  const sub = `opencode-${opencodePlatformKey(p)}`
  const subMeta = await npmMeta(`${sub}/${main.version}`)
  const dir = paths.cliInstall('opencode')
  await downloadAndExtract(subMeta.dist.tarball, dir, onProgress, subMeta.dist.integrity)
  const binPath = join(dir, 'bin', p.os === 'win32' ? 'opencode.exe' : 'opencode')
  if (!existsSync(binPath)) throw new Error('opencode binary missing after extract')
  if (p.os !== 'win32') chmodSync(binPath, 0o755)
  onProgress('verify', 'Verifying…')
  let version = main.version
  try {
    version = (await run(binPath, ['--version'])).trim().split(/\s+/).pop() || main.version
  } catch {
    /* keep registry version */
  }
  setInstallState('opencode', { installed: true, source: 'sandbox', version, binPath })
  return { ok: true, cliId: 'opencode', version, binPath, source: 'sandbox' }
}

/** Pi: Node app — bundled portable Node + npm install into sandbox. */
async function installPi(onProgress: Progress): Promise<InstallResult> {
  onProgress('node', 'Preparing portable Node…')
  const { nodeBin, npmCli } = await ensureNode((msg, f) => onProgress('node', msg, f))
  const dir = paths.cliInstall('pi')
  mkdirSync(dir, { recursive: true })
  mkdirSync(paths.npmCache, { recursive: true })
  const emptyNpmrc = join(paths.root, '.npmrc-empty')
  writeFileSync(emptyNpmrc, '')

  onProgress('npm', 'Installing Pi with npm…')
  await run(nodeBin, [
    npmCli,
    'install',
    '@earendil-works/pi-coding-agent@latest',
    '--prefix',
    dir,
    '--no-audit',
    '--no-fund',
    '--no-update-notifier',
    `--cache=${paths.npmCache}`,
    `--userconfig=${emptyNpmrc}`
  ])

  const pkgRoot = join(dir, 'node_modules', '@earendil-works', 'pi-coding-agent')
  const entry = join(pkgRoot, 'dist', 'cli.js')
  if (!existsSync(entry)) throw new Error('pi entry missing after npm install')
  onProgress('verify', 'Verifying…')
  // pi prints --version to stderr; read the installed package.json instead.
  let version = ''
  try {
    version = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version ?? ''
  } catch {
    /* ignore */
  }
  setInstallState('pi', { installed: true, source: 'sandbox', version, binPath: nodeBin, nodeEntry: entry })
  return { ok: true, cliId: 'pi', version, binPath: nodeBin, source: 'sandbox' }
}

export async function installCli(
  id: CliId,
  onProgress: Progress,
  opts: InstallOptions = {}
): Promise<InstallResult> {
  try {
    if (opts.source !== 'sandbox') return await useSystemCli(id, onProgress, opts.action, opts.binPath)
    if (id === 'hermes') return await useSystemCli(id, onProgress, opts.action ?? 'install', opts.binPath)
    if (id === 'claude-code') return await installClaude(onProgress)
    if (id === 'codex') return await installCodex(onProgress)
    if (id === 'opencode') return await installOpencode(onProgress)
    if (id === 'pi') return await installPi(onProgress)
    throw new Error(`Unknown CLI: ${id}`)
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
      try {
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
          currentVersion: install.version,
          latestVersion,
          updateAvailable: installed ? isVersionNewer(latestVersion, install.version) : configured,
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
          updateAvailable: false,
          canInstallUpdate: installed && !stale,
          binPath: install.binPath,
          error: e instanceof Error ? e.message : String(e),
          checkedAt
        }
      }
    })
  )
}
