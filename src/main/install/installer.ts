import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { paths } from '../sandbox'
import { spawnProcess } from '../process'
import { setInstallState } from '../store'
import type {
  CliId,
  CleanupCliResult,
  InstallAction,
  InstallOptions,
  InstallResult,
  SystemCliCandidate,
  SystemCliDetection
} from '@shared/types'
import { detectPlatform, codexTargetTriple, opencodePlatformKey } from './platform'
import { fetchJson, downloadFile, extractArchive } from './download'
import { ensureNode } from './node-runtime'

type Progress = (phase: string, message: string, fraction?: number) => void

interface NpmDist {
  version: string
  dist: { tarball: string }
}

const SYSTEM_COMMANDS: Record<CliId, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi'
}

const NPM_PACKAGES: Record<CliId, string> = {
  'claude-code': '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  opencode: 'opencode-ai',
  pi: '@earendil-works/pi-coding-agent'
}

function npmMeta(spec: string): Promise<NpmDist> {
  return fetchJson<NpmDist>(`https://registry.npmjs.org/${spec}`)
}

async function downloadAndExtract(
  tarball: string,
  destDir: string,
  onProgress: Progress
): Promise<void> {
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true })
  mkdirSync(paths.downloads, { recursive: true })
  const archive = join(paths.downloads, `${Date.now()}-pkg.tgz`)
  onProgress('download', '下载二进制…', 0)
  await downloadFile(tarball, archive, (r, t) => t && onProgress('download', '下载二进制…', r / t))
  onProgress('extract', '解压…')
  // npm tarballs nest everything under package/ — strip it.
  await extractArchive(archive, destDir, 1)
  rmSync(archive, { force: true })
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawnProcess(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout!.on('data', (d) => (out += d))
    p.stderr!.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err || `exit ${code}`))))
  })
}

function runStreaming(cmd: string, args: string[], onProgress: Progress, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawnProcess(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const append = (chunk: Buffer) => {
      tail = `${tail}${chunk.toString()}`.slice(-1000)
      const line = tail
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .at(-1)
      if (line) onProgress('system', `${label}：${line}`)
    }
    p.stdout!.on('data', append)
    p.stderr!.on('data', append)
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(tail.trim() || `${cmd} ${args.join(' ')} exit ${code}`))
    })
  })
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

async function whichAll(cmd: string): Promise<string[]> {
  if (isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) return existsSync(cmd) ? [cmd] : []
  const direct = uniquePaths(pathCandidates(cmd).filter((candidate) => existsSync(candidate)))
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
  const paths = await whichAll(command)
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
        ? `已固定使用 ${selectedPath}，仍检测到 ${candidates.length} 个 ${command}`
        : `已链接 ${selectedPath}`
      : status === 'available'
        ? `检测到 ${selectedPath}`
        : status === 'duplicate'
          ? `检测到 ${candidates.length} 个 ${command}`
          : status === 'stale'
            ? '记录存在但命令已丢失'
            : `未检测到 ${command}`

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

async function installSystemCli(id: CliId, onProgress: Progress, reinstall: boolean): Promise<void> {
  const npm = await which('npm')
  if (npm) {
    const pkg = NPM_PACKAGES[id]
    onProgress('system', `${reinstall ? '重新安装' : '安装'} ${pkg}…`)
    const args = ['install', '-g', pkg]
    if (reinstall) {
      await runStreaming(npm, ['uninstall', '-g', pkg], onProgress, 'npm')
    }
    await runStreaming(npm, args, onProgress, 'npm')
    return
  }

  const command = SYSTEM_COMMANDS[id]
  throw new Error(`无法自动安装 ${command}：未检测到 npm，请先安装 Node/npm 后重试`)
}

async function repairSystemCli(id: CliId, onProgress: Progress): Promise<void> {
  const command = SYSTEM_COMMANDS[id]
  onProgress('repair', `固定使用 PATH 中优先级最高的 ${command}…`)
}

function backupPathForCli(id: CliId, binPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(paths.root, 'removed-clis', id, stamp, basename(binPath))
}

export async function cleanupSystemCli(id: CliId, binPath: string): Promise<CleanupCliResult> {
  try {
    if (!binPath || !existsSync(binPath)) throw new Error('路径不存在')
    const detection = await detectSystemCli(id)
    const targetRealPath = await normalizePath(binPath)
    const matched = detection.candidates.some((candidate) => {
      const candidateRealPath = candidate.realPath ?? candidate.path
      const a = process.platform === 'win32' ? candidateRealPath.toLowerCase() : candidateRealPath
      const b = process.platform === 'win32' ? targetRealPath.toLowerCase() : targetRealPath
      return a === b || candidate.path === binPath
    })
    if (!matched) throw new Error('该路径不是当前检测到的 CLI 候选，已取消清理')

    const backupPath = backupPathForCli(id, binPath)
    mkdirSync(dirname(backupPath), { recursive: true })
    renameSync(binPath, backupPath)
    return { ok: true, cliId: id, path: binPath, backupPath }
  } catch (e) {
    return { ok: false, cliId: id, path: binPath, error: e instanceof Error ? e.message : String(e) }
  }
}

async function linkSystemCli(id: CliId, onProgress: Progress, binPath?: string): Promise<InstallResult> {
  onProgress('link', '查找系统 CLI…')
  const target = SYSTEM_COMMANDS[id]
  const detection = await detectSystemCli(id)
  const selected = binPath ?? detection.selectedPath
  if (!selected) {
    throw new Error(`未找到系统命令 ${target}，可以点击安装让 AgentLauncher 帮你安装`)
  }
  if (!existsSync(selected)) {
    throw new Error(`系统命令不存在：${selected}`)
  }
  onProgress('verify', `验证 ${basename(selected)}…`)
  const version = await systemVersion(selected)
  setInstallState(id, { installed: true, source: 'system', version, binPath: selected })
  const warning =
    detection.duplicate && !binPath
      ? `检测到 ${detection.candidates.length} 个 ${target}，已临时使用 PATH 中优先级最高的版本`
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
    await installSystemCli(id, onProgress, action === 'reinstall')
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
  onProgress('resolve', '查询版本…')
  const main = await npmMeta('@anthropic-ai/claude-code/latest')
  const sub = `@anthropic-ai/claude-code-${p.platformKey}`
  const subMeta = await npmMeta(`${sub}/${main.version}`)
  const dir = paths.cliInstall('claude-code')
  await downloadAndExtract(subMeta.dist.tarball, dir, onProgress)
  const binPath = join(dir, p.os === 'win32' ? 'claude.exe' : 'claude')
  if (!existsSync(binPath)) throw new Error('claude binary missing after extract')
  if (p.os !== 'win32') chmodSync(binPath, 0o755)
  onProgress('verify', '验证…')
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
  onProgress('resolve', '查询版本…')
  const main = await npmMeta('@openai/codex/latest')
  const subMeta = await npmMeta(`@openai/codex/${main.version}-${p.platformKey}`)
  const dir = paths.cliInstall('codex')
  await downloadAndExtract(subMeta.dist.tarball, dir, onProgress)
  const triple = codexTargetTriple(p)
  const binPath = join(dir, 'vendor', triple, 'bin', p.os === 'win32' ? 'codex.exe' : 'codex')
  if (!existsSync(binPath)) throw new Error(`codex binary missing: ${binPath}`)
  if (p.os !== 'win32') chmodSync(binPath, 0o755)
  onProgress('verify', '验证…')
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
  onProgress('resolve', '查询版本…')
  const main = await npmMeta('opencode-ai/latest')
  const sub = `opencode-${opencodePlatformKey(p)}`
  const subMeta = await npmMeta(`${sub}/${main.version}`)
  const dir = paths.cliInstall('opencode')
  await downloadAndExtract(subMeta.dist.tarball, dir, onProgress)
  const binPath = join(dir, 'bin', p.os === 'win32' ? 'opencode.exe' : 'opencode')
  if (!existsSync(binPath)) throw new Error('opencode binary missing after extract')
  if (p.os !== 'win32') chmodSync(binPath, 0o755)
  onProgress('verify', '验证…')
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
  onProgress('node', '准备便携 Node…')
  const { nodeBin, npmCli } = await ensureNode((msg, f) => onProgress('node', msg, f))
  const dir = paths.cliInstall('pi')
  mkdirSync(dir, { recursive: true })
  mkdirSync(paths.npmCache, { recursive: true })
  const emptyNpmrc = join(paths.root, '.npmrc-empty')
  writeFileSync(emptyNpmrc, '')

  onProgress('npm', 'npm 安装 Pi…')
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
  onProgress('verify', '验证…')
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
