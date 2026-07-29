import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CODEX_MACOS_MIN_SAFE_VERSION,
  cliLaunchBlockMessage
} from '../../src/main/cli-launch-safety'
import {
  codexPackageVersion,
  inspectCodexInstall,
  isExplicitMacSecurityAssessmentFailure
} from '../../src/main/install/codex-safety'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Codex macOS launch safety', () => {
  it('reads an npm Codex version without executing the command shim', () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-safety-'))
    tempDirs.push(root)
    const packageRoot = join(root, 'node_modules', '@openai', 'codex')
    const shim = join(packageRoot, 'bin', 'codex.js')
    mkdirSync(join(packageRoot, 'bin'), { recursive: true })
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@openai/codex', version: '0.144.5' })
    )
    writeFileSync(shim, '#!/usr/bin/env node\n')

    expect(codexPackageVersion(shim)).toBe('0.144.5')

    const windowsBin = join(root, 'AppData', 'Roaming', 'npm')
    const windowsShim = join(windowsBin, 'codex.cmd')
    const windowsPackage = join(windowsBin, 'node_modules', '@openai', 'codex')
    mkdirSync(windowsPackage, { recursive: true })
    writeFileSync(windowsShim, '@echo off\r\n')
    writeFileSync(
      join(windowsPackage, 'package.json'),
      JSON.stringify({ name: '@openai/codex', version: '0.144.6' })
    )
    expect(inspectCodexInstall(windowsShim)).toMatchObject({
      installKind: 'npm',
      packageManager: 'npm',
      version: '0.144.6'
    })
  })

  it('does not infer a launch failure from an older version alone', () => {
    expect(
      cliLaunchBlockMessage(
        'codex',
        { installed: true, source: 'system', version: '0.144.5', binPath: '/usr/local/bin/codex' },
        'darwin'
      )
    ).toBeUndefined()
    const blockedMessage = cliLaunchBlockMessage(
      'codex',
      {
        installed: true,
        source: 'system',
        version: '0.144.5',
        binPath: '/usr/local/bin/codex',
        launchBlockedReason: 'macos-security'
      },
      'darwin'
    )
    expect(blockedMessage).toBe(
      `Your Codex CLI is outdated, so macOS flags it as damaged and won't open it. Please uninstall it and install version ${CODEX_MACOS_MIN_SAFE_VERSION} or later.`
    )
    expect(blockedMessage).not.toMatch(/one-click|repair/i)
    expect(
      cliLaunchBlockMessage(
        'codex',
        { installed: true, source: 'sandbox', version: '0.144.5', binPath: '/sandbox/codex' },
        'darwin'
      )
    ).toBeUndefined()
  })

  it('classifies official standalone, Homebrew, app-bundled and manual release layouts', () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-layouts-'))
    tempDirs.push(root)
    const standalone = join(
      root,
      '.codex',
      'packages',
      'standalone',
      'releases',
      '0.144.6-aarch64-apple-darwin'
    )
    const standaloneBin = join(standalone, 'bin', 'codex')
    mkdirSync(join(standalone, 'bin'), { recursive: true })
    writeFileSync(
      join(standalone, 'codex-package.json'),
      JSON.stringify({
        version: '0.144.6',
        target: 'aarch64-apple-darwin',
        entrypoint: 'bin/codex'
      })
    )
    writeFileSync(standaloneBin, '')

    expect(inspectCodexInstall(join(root, '.local', 'bin', 'codex'), standaloneBin)).toMatchObject({
      installKind: 'standalone',
      version: '0.144.6'
    })
    expect(
      inspectCodexInstall(
        '/opt/homebrew/bin/codex',
        '/opt/homebrew/Caskroom/codex/0.144.6/codex-aarch64-apple-darwin'
      )
    ).toMatchObject({ installKind: 'homebrew-cask', version: '0.144.6' })
    expect(
      inspectCodexInstall(
        '/Applications/ChatGPT.app/Contents/Resources/codex',
        '/Applications/ChatGPT.app/Contents/Resources/codex'
      )
    ).toMatchObject({ installKind: 'app-bundled' })

    const releaseRoot = join(root, 'release')
    const releaseBin = join(releaseRoot, 'bin', 'codex')
    mkdirSync(join(releaseRoot, 'bin'), { recursive: true })
    writeFileSync(join(releaseRoot, 'codex-package.json'), JSON.stringify({ version: '0.144.6' }))
    writeFileSync(releaseBin, '')
    expect(inspectCodexInstall(releaseBin)).toMatchObject({
      installKind: 'github-release',
      version: '0.144.6'
    })
  })

  it('classifies DotSlash and source-built commands without running them', () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-other-layouts-'))
    tempDirs.push(root)
    const dotslash = join(root, 'codex')
    writeFileSync(
      dotslash,
      '#!/usr/bin/env dotslash\n{"platforms":{"macos-aarch64":{"url":"https://example/rust-v0.144.6/codex"}}}\n'
    )
    expect(inspectCodexInstall(dotslash)).toEqual({ installKind: 'dotslash', version: '0.144.6' })

    const sourceRoot = join(root, 'codex-rs')
    const sourceBin = join(sourceRoot, 'target', 'release', 'codex')
    mkdirSync(join(sourceRoot, 'target', 'release'), { recursive: true })
    writeFileSync(join(sourceRoot, 'Cargo.toml'), '[workspace.package]\nversion = "0.144.6"\n')
    writeFileSync(sourceBin, '')
    expect(inspectCodexInstall(sourceBin)).toMatchObject({
      installKind: 'source-build',
      version: '0.144.6'
    })
  })

  it('distinguishes an explicit revoked-certificate verdict from a normal CLI rejection', () => {
    expect(isExplicitMacSecurityAssessmentFailure('/tmp/codex: CSSMERR_TP_CERT_REVOKED')).toBe(true)
    expect(isExplicitMacSecurityAssessmentFailure('malware was blocked by XProtect')).toBe(true)
    expect(
      isExplicitMacSecurityAssessmentFailure(
        '/tmp/codex: rejected (the code is valid but does not seem to be an app)'
      )
    ).toBe(false)
  })

  it('resolves the native Darwin executable behind an npm shim', () => {
    if (process.arch !== 'arm64' && process.arch !== 'x64') return
    const root = mkdtempSync(join(tmpdir(), 'codex-npm-runtime-'))
    tempDirs.push(root)
    const packageRoot = join(root, 'node_modules', '@openai', 'codex')
    const shim = join(packageRoot, 'bin', 'codex.js')
    const triple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    const native = join(
      packageRoot,
      'node_modules',
      '@openai',
      `codex-darwin-${process.arch}`,
      'vendor',
      triple,
      'codex',
      'codex'
    )
    mkdirSync(dirname(shim), { recursive: true })
    mkdirSync(dirname(native), { recursive: true })
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@openai/codex', version: '0.130.0' })
    )
    writeFileSync(shim, '#!/usr/bin/env node\n')
    writeFileSync(native, '')
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    try {
      const inspected = inspectCodexInstall(shim)
      expect(inspected).toMatchObject({
        installKind: 'npm',
        version: '0.130.0',
        executablePath: native
      })
      expect(inspected.runtimeMissing).toBeUndefined()
    } finally {
      platform.mockRestore()
    }
  })

  it('detects an older healthy npm shim without spawning it', async () => {
    if (process.platform === 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'codex-detect-'))
    tempDirs.push(root)
    const binDir = join(root, 'bin')
    const packageRoot = join(root, 'lib', 'node_modules', '@openai', 'codex')
    const shim = join(packageRoot, 'bin', 'codex.js')
    const marker = join(root, 'shim-was-executed')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(join(packageRoot, 'bin'), { recursive: true })
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@openai/codex', version: '0.144.5' })
    )
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const triple = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    const native = join(
      packageRoot,
      'node_modules',
      '@openai',
      `codex-darwin-${arch}`,
      'vendor',
      triple,
      'bin',
      'codex'
    )
    mkdirSync(dirname(native), { recursive: true })
    writeFileSync(native, '')
    writeFileSync(shim, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`)
    chmodSync(shim, 0o755)
    symlinkSync(shim, join(binDir, 'codex'))

    const oldPath = process.env.PATH
    const oldInstallDir = process.env.CODEX_INSTALL_DIR
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    process.env.PATH = '/usr/bin:/bin'
    process.env.CODEX_INSTALL_DIR = binDir
    vi.resetModules()
    vi.doMock('../../src/main/install/download', async (importOriginal) => {
      const original = await importOriginal<typeof import('../../src/main/install/download')>()
      return {
        ...original,
        fetchJson: vi.fn(async () => ({ tag_name: 'rust-v0.144.6', assets: [] }))
      }
    })

    try {
      const { detectSystemCli } = await import('../../src/main/install/installer')
      const result = await detectSystemCli('codex')
      expect(result.candidates[0]).toMatchObject({
        version: '0.144.5',
        installKind: 'npm',
        packageManager: 'npm'
      })
      expect(result.macosSecurityRisk).toBeUndefined()
      expect(existsSync(marker)).toBe(false)
    } finally {
      process.env.PATH = oldPath
      if (oldInstallDir === undefined) delete process.env.CODEX_INSTALL_DIR
      else process.env.CODEX_INSTALL_DIR = oldInstallDir
      platform.mockRestore()
      vi.doUnmock('../../src/main/install/download')
      vi.resetModules()
    }
  })

  it('detects an explicit Gatekeeper certificate revocation without spawning Codex', async () => {
    if (process.platform === 'win32' || (process.arch !== 'arm64' && process.arch !== 'x64')) return
    const root = mkdtempSync(join(tmpdir(), 'codex-revoked-detect-'))
    tempDirs.push(root)
    const binDir = join(root, 'bin')
    const fakeTools = join(root, 'tools')
    const packageRoot = join(root, 'lib', 'node_modules', '@openai', 'codex')
    const shim = join(packageRoot, 'bin', 'codex.js')
    const triple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    const native = join(
      packageRoot,
      'node_modules',
      '@openai',
      `codex-darwin-${process.arch}`,
      'vendor',
      triple,
      'codex',
      'codex'
    )
    const marker = join(root, 'codex-was-executed')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(fakeTools, { recursive: true })
    mkdirSync(dirname(shim), { recursive: true })
    mkdirSync(dirname(native), { recursive: true })
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@openai/codex', version: '0.130.0' })
    )
    writeFileSync(shim, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`)
    writeFileSync(native, '')
    writeFileSync(
      join(fakeTools, 'spctl'),
      '#!/bin/sh\necho "$4: CSSMERR_TP_CERT_REVOKED" >&2\nexit 3\n'
    )
    chmodSync(shim, 0o755)
    chmodSync(native, 0o755)
    chmodSync(join(fakeTools, 'spctl'), 0o755)
    symlinkSync(shim, join(binDir, 'codex'))

    const oldPath = process.env.PATH
    const oldInstallDir = process.env.CODEX_INSTALL_DIR
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    process.env.PATH = `${fakeTools}:/usr/bin:/bin`
    process.env.CODEX_INSTALL_DIR = binDir
    vi.resetModules()

    try {
      const { detectSystemCli } = await import('../../src/main/install/installer')
      const result = await detectSystemCli('codex', join(binDir, 'codex'))
      expect(result).toMatchObject({
        selectedPath: join(binDir, 'codex'),
        macosSecurityRisk: true
      })
      expect(result.candidates[0]).toMatchObject({
        path: join(binDir, 'codex'),
        macosSecurityRisk: true,
        installKind: 'npm',
        packageManager: 'npm'
      })
      expect(existsSync(marker)).toBe(false)
    } finally {
      process.env.PATH = oldPath
      if (oldInstallDir === undefined) delete process.env.CODEX_INSTALL_DIR
      else process.env.CODEX_INSTALL_DIR = oldInstallDir
      platform.mockRestore()
      vi.resetModules()
    }
  })

  it('finds the official standalone current link even when it is absent from PATH', async () => {
    if (process.platform === 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'codex-standalone-detect-'))
    tempDirs.push(root)
    const codexHome = join(root, '.codex')
    const release = join(
      codexHome,
      'packages',
      'standalone',
      'releases',
      '0.144.6-aarch64-apple-darwin'
    )
    const bin = join(release, 'bin', 'codex')
    const marker = join(root, 'standalone-was-executed')
    mkdirSync(join(release, 'bin'), { recursive: true })
    writeFileSync(
      join(release, 'codex-package.json'),
      JSON.stringify({
        version: '0.144.6',
        target: 'aarch64-apple-darwin',
        entrypoint: 'bin/codex'
      })
    )
    writeFileSync(bin, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`)
    chmodSync(bin, 0o755)
    symlinkSync(release, join(codexHome, 'packages', 'standalone', 'current'))

    const oldPath = process.env.PATH
    const oldCodexHome = process.env.CODEX_HOME
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    process.env.PATH = '/usr/bin:/bin'
    process.env.CODEX_HOME = codexHome
    vi.resetModules()
    vi.doMock('../../src/main/install/download', async (importOriginal) => {
      const original = await importOriginal<typeof import('../../src/main/install/download')>()
      return {
        ...original,
        fetchJson: vi.fn(async () => ({ tag_name: 'rust-v0.144.6', assets: [] }))
      }
    })

    try {
      const { detectSystemCli } = await import('../../src/main/install/installer')
      const result = await detectSystemCli('codex')
      expect(result.candidates).toContainEqual(
        expect.objectContaining({ installKind: 'standalone', version: '0.144.6' })
      )
      expect(result.macosSecurityRisk).toBeUndefined()
      expect(existsSync(marker)).toBe(false)
    } finally {
      process.env.PATH = oldPath
      if (oldCodexHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = oldCodexHome
      platform.mockRestore()
      vi.doUnmock('../../src/main/install/download')
      vi.resetModules()
    }
  })
})
