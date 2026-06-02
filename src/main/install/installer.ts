import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { paths } from '../sandbox'
import { setInstallState } from '../store'
import type { CliId, InstallResult } from '@shared/types'
import { detectPlatform, codexTargetTriple } from './platform'
import { fetchJson, downloadFile, extractArchive } from './download'
import { ensureNode } from './node-runtime'

type Progress = (phase: string, message: string, fraction?: number) => void

interface NpmDist {
  version: string
  dist: { tarball: string }
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
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err || `exit ${code}`))))
  })
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
  setInstallState('claude-code', { installed: true, version, binPath })
  return { ok: true, cliId: 'claude-code', version, binPath }
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
  setInstallState('codex', { installed: true, version, binPath })
  return { ok: true, cliId: 'codex', version, binPath }
}

/** Gemini: real Node app — bundled portable Node + npm install into sandbox. */
async function installGemini(onProgress: Progress): Promise<InstallResult> {
  onProgress('node', '准备便携 Node…')
  const { nodeBin } = await ensureNode((msg, f) => onProgress('node', msg, f))
  const dir = paths.cliInstall('gemini')
  mkdirSync(dir, { recursive: true })
  mkdirSync(paths.npmCache, { recursive: true })
  // Empty userconfig so we never read the user's ~/.npmrc (proxies/registries).
  const emptyNpmrc = join(paths.root, '.npmrc-empty')
  writeFileSync(emptyNpmrc, '')

  onProgress('npm', 'npm 安装 Gemini CLI…')
  const { npmCli } = await ensureNode()
  await run(nodeBin, [
    npmCli,
    'install',
    '@google/gemini-cli@latest',
    '--prefix',
    dir,
    '--no-audit',
    '--no-fund',
    '--no-update-notifier',
    `--cache=${paths.npmCache}`,
    `--userconfig=${emptyNpmrc}`
  ])

  const entry = join(dir, 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js')
  if (!existsSync(entry)) throw new Error('gemini entry missing after npm install')
  onProgress('verify', '验证…')
  let version = 'installed'
  try {
    version = (await run(nodeBin, [entry, '--version'])).trim() || version
  } catch {
    /* ignore */
  }
  setInstallState('gemini', { installed: true, version, binPath: nodeBin, nodeEntry: entry })
  return { ok: true, cliId: 'gemini', version, binPath: nodeBin }
}

export async function installCli(id: CliId, onProgress: Progress): Promise<InstallResult> {
  try {
    if (id === 'claude-code') return await installClaude(onProgress)
    if (id === 'codex') return await installCodex(onProgress)
    if (id === 'gemini') return await installGemini(onProgress)
    throw new Error(`Unknown CLI: ${id}`)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    onProgress('error', error)
    return { ok: false, cliId: id, error }
  }
}
