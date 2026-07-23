import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import type { CodexInstallKind, CodexPackageManager } from '@shared/types'

export interface CodexInstallInspection {
  installKind: CodexInstallKind
  packageManager?: CodexPackageManager
  version?: string
  metadataPath?: string
  /** Native executable behind a launcher/shim, when it can be resolved without
   * spawning Codex. */
  executablePath?: string
  /** The npm platform package is incomplete, so the JS shim cannot launch. */
  runtimeMissing?: boolean
}

interface PackageJson {
  name?: string
  version?: string
}

interface CodexPackageJson {
  version?: string
  target?: string
  entrypoint?: string
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

function findParentFile(startPath: string, name: string, maxDepth = 12): string | undefined {
  let current = dirname(startPath)
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const candidate = join(current, name)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

function pathText(path: string): string {
  return path.replace(/\\/g, '/')
}

function npmManager(paths: string[]): CodexPackageManager {
  const text = paths.map((path) => pathText(path).toLowerCase()).join('\n')
  if (text.includes('/.bun/')) return 'bun'
  if (text.includes('/pnpm/') || text.includes('/.pnpm/')) return 'pnpm'
  if (text.includes('/.volta/') || text.includes('/volta/')) return 'volta'
  return 'npm'
}

function standaloneVersionFromPath(path: string): string | undefined {
  const match = pathText(path).match(/\/packages\/standalone\/releases\/([^/]+)/i)
  return match?.[1]?.match(/^\d+\.\d+\.\d+(?:-(?:alpha|beta)(?:\.\d+)?)?/)?.[0]
}

function homebrewVersion(path: string): string | undefined {
  const normalized = pathText(path)
  return normalized.match(/\/(?:Caskroom|Cellar)\/codex\/([^/]+)/i)?.[1]
}

function npmDarwinRuntime(packageRoot: string): Pick<CodexInstallInspection, 'executablePath' | 'runtimeMissing'> {
  if (process.platform !== 'darwin' || (process.arch !== 'arm64' && process.arch !== 'x64')) return {}
  const platformPackage = `@openai/codex-darwin-${process.arch}`
  const triple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  const roots: string[] = []

  try {
    const requireFromPackage = createRequire(join(packageRoot, 'package.json'))
    roots.push(dirname(requireFromPackage.resolve(`${platformPackage}/package.json`)))
  } catch {
    /* fall back to the layouts used by npm and hoisting package managers */
  }

  roots.push(
    join(packageRoot, 'node_modules', '@openai', `codex-darwin-${process.arch}`),
    join(dirname(packageRoot), `codex-darwin-${process.arch}`)
  )

  const uniqueRoots = [...new Set(roots)]
  const names = [
    join('vendor', triple, 'bin', 'codex'),
    join('vendor', triple, 'codex', 'codex')
  ]
  for (const root of uniqueRoots) {
    for (const name of names) {
      const executablePath = join(root, name)
      if (existsSync(executablePath)) return { executablePath }
    }
  }
  return { runtimeMissing: true }
}

function readPrefix(path: string, maxBytes = 16_384): Buffer | undefined {
  try {
    const fd = openSync(path, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      const size = readSync(fd, buffer, 0, buffer.length, 0)
      return buffer.subarray(0, size)
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
}

function isNativeExecutable(prefix: Buffer | undefined): boolean {
  if (!prefix || prefix.length < 4) return false
  if (prefix[0] === 0x7f && prefix.subarray(1, 4).toString() === 'ELF') return true
  if (prefix[0] === 0x4d && prefix[1] === 0x5a) return true
  const magic = prefix.readUInt32BE(0)
  return [0xcafebabe, 0xbebafeca, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(magic)
}

function dotslashVersion(prefix: Buffer | undefined): string | undefined {
  if (!prefix) return undefined
  const text = prefix.toString('utf8')
  const looksLikeDotslash = /dotslash/i.test(text) || (/"platforms"\s*:/.test(text) && /"url"\s*:/.test(text))
  if (!looksLikeDotslash) return undefined
  return text.match(/rust-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1]
}

function sourceVersion(path: string): string | undefined {
  let current = dirname(path)
  for (let depth = 0; depth < 10; depth += 1) {
    const cargo = join(current, 'Cargo.toml')
    if (existsSync(cargo)) {
      try {
        const text = readFileSync(cargo, 'utf8')
        const workspace = text.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/)?.[1]
        const version = (workspace ?? text).match(/^version\s*=\s*"([^"]+)"/m)?.[1]
        if (version) return version
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

/** Classifies every documented Codex distribution without executing it. */
export function inspectCodexInstall(binPath: string, realPath = binPath): CodexInstallInspection {
  const paths = [binPath, realPath]
  const normalized = paths.map(pathText)
  const combined = normalized.join('\n')
  const lower = combined.toLowerCase()

  if (/\.app\/contents\/resources\/codex(?:\.exe)?(?:\n|$)/i.test(combined)) {
    return { installKind: 'app-bundled', executablePath: realPath }
  }

  const packageMetadataPath = findParentFile(realPath, 'codex-package.json', 4)
  const packageMetadata = packageMetadataPath
    ? readJson<CodexPackageJson>(packageMetadataPath)
    : undefined
  const isStandalone = lower.includes('/packages/standalone/releases/')
  if (isStandalone) {
    return {
      installKind: 'standalone',
      version: packageMetadata?.version ?? standaloneVersionFromPath(realPath),
      metadataPath: packageMetadataPath,
      executablePath: realPath
    }
  }

  const voltaRoot = normalized
    .map((path) => path.match(/^(.*\/\.volta)\/bin\/codex(?:\.exe|\.cmd|\.bat)?$/i)?.[1])
    .find((path): path is string => !!path)
  const npmMetadataPaths = [
    findParentFile(realPath, 'package.json'),
    join(dirname(binPath), 'node_modules', '@openai', 'codex', 'package.json'),
    voltaRoot
      ? join(voltaRoot, 'tools', 'image', 'packages', '@openai', 'codex', 'lib', 'node_modules', '@openai', 'codex', 'package.json')
      : undefined
  ].filter((path): path is string => !!path && existsSync(path))
  const npmMetadataEntry = npmMetadataPaths
    .map((path) => ({ path, value: readJson<PackageJson>(path) }))
    .find((entry) => entry.value?.name?.startsWith('@openai/codex'))
  const npmMetadataPath = npmMetadataEntry?.path
  const npmMetadata = npmMetadataEntry?.value
  if (npmMetadata?.name?.startsWith('@openai/codex')) {
    const runtime = npmDarwinRuntime(dirname(npmMetadataPath as string))
    return {
      installKind: 'npm',
      packageManager: npmManager(paths),
      version: npmMetadata.version,
      metadataPath: npmMetadataPath,
      ...runtime
    }
  }

  if (lower.includes('/.volta/bin/codex')) {
    return { installKind: 'npm', packageManager: 'volta' }
  }

  const brewVersion = homebrewVersion(realPath)
  if (brewVersion || /\/(?:Caskroom|Cellar)\/codex(?:\/|$)/i.test(combined)) {
    return { installKind: 'homebrew-cask', version: brewVersion, executablePath: realPath }
  }

  if (/\/target\/(?:debug|release)\/codex(?:\.exe)?$/i.test(pathText(realPath))) {
    return { installKind: 'source-build', version: sourceVersion(realPath), executablePath: realPath }
  }

  const prefix = readPrefix(realPath)
  const dotVersion = dotslashVersion(prefix)
  if (dotVersion || prefix?.toString('utf8', 0, 256).toLowerCase().includes('dotslash')) {
    return { installKind: 'dotslash', version: dotVersion }
  }

  if (packageMetadata?.version) {
    return {
      installKind: 'github-release',
      version: packageMetadata.version,
      metadataPath: packageMetadataPath,
      executablePath: realPath
    }
  }

  if (isNativeExecutable(prefix)) return { installKind: 'github-release', executablePath: realPath }
  return { installKind: 'unknown' }
}

/** `spctl` rejects healthy command-line binaries with messages such as
 * "the code is valid but does not seem to be an app". Only classify explicit
 * certificate revocation or malware/XProtect verdicts as launch-blocking. */
export function isExplicitMacSecurityAssessmentFailure(output: string): boolean {
  return /CSSMERR_TP_CERT_REVOKED|cert(?:ificate)?[^\n]*revoked|revoked[^\n]*cert(?:ificate)?|malware|XProtect|will damage your computer/i.test(
    output
  )
}

/** Backwards-compatible convenience used by existing callers and tests. */
export function codexPackageVersion(...candidatePaths: string[]): string | undefined {
  for (const candidatePath of candidatePaths) {
    const inspected = inspectCodexInstall(candidatePath, candidatePath)
    if (inspected.version) return inspected.version
  }
  return undefined
}

export function codexInstallLabel(kind: CodexInstallKind, manager?: CodexPackageManager): string {
  if (kind === 'npm') return manager ?? 'npm'
  const labels: Record<CodexInstallKind, string> = {
    standalone: 'OpenAI standalone installer',
    npm: 'npm',
    'homebrew-cask': 'Homebrew Cask',
    'github-release': 'GitHub Release binary',
    dotslash: 'DotSlash',
    'source-build': 'source build',
    'app-bundled': 'app-bundled Codex',
    unknown: 'unknown install'
  }
  return labels[kind]
}
