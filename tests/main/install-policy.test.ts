import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

/**
 * The product rule is narrow: install a CLI the user does not have, and
 * otherwise never touch what is already on their machine. These assertions pin
 * that boundary so a future "while we're here, let's also update it" change has
 * to be a deliberate decision.
 */
describe('CLI installation policy', () => {
  it('exposes linking and installing, but no update/repair/reinstall IPC', () => {
    const ipc = source('src/main/ipc.ts')
    const preload = source('src/preload/index.ts')

    expect(ipc).toContain("ipcMain.handle('cli:link'")
    expect(ipc).toContain("ipcMain.handle('cli:install'")
    expect(preload).toContain("ipcRenderer.invoke('cli:link'")
    expect(preload).toContain("ipcRenderer.invoke('cli:install'")

    for (const channel of ['cli:update', 'cli:repair', 'cli:reinstall', 'install:cli']) {
      expect(ipc).not.toContain(`ipcMain.handle('${channel}'`)
      expect(preload).not.toContain(`ipcRenderer.invoke('${channel}'`)
    }
  })

  it('installs only what is missing: an existing CLI degrades to linking', () => {
    const installer = source('src/main/install/installer.ts')

    expect(installer).toMatch(/if \(detection\.installed\)[\s\S]{0,240}linkExistingSystemCli/)
  })

  it('runs no package-manager update or upgrade path', () => {
    const installer = source('src/main/install/installer.ts')

    expect(installer).not.toMatch(/brew (?:upgrade|install)/i)
    expect(installer).not.toMatch(/npm update -g/i)
    expect(installer).not.toMatch(/(?:pnpm|bun) add -g/i)
    expect(installer).not.toMatch(/winget upgrade/i)
    // No self-updater invocation such as `claude update` / `codex update`.
    expect(installer).not.toMatch(/["']update["']\s*\]/)
  })

  it('keeps the user npm registry primary and scopes the fallback mirror', () => {
    const installer = source('src/main/install/installer.ts')

    expect(installer).not.toContain('--registry')
    expect(installer).toContain("const NPM_FALLBACK_REGISTRY = 'https://registry.npmmirror.com'")
    expect(installer).toMatch(/steps\.push\(npmStep[\s\S]{0,160}steps\.push\(npmMirrorStep/)
    expect(installer).toMatch(/npmMirrorStep[\s\S]{0,500}npm_config_registry/)
  })

  it('pins and verifies the third-party Hermes mirror before executing it', () => {
    const installer = source('src/main/install/installer.ts')

    expect(installer).toContain('gitcode.com/GitHub_Trending/he/hermes-agent.git')
    expect(installer).toContain("tag: 'v2026.8.3'")
    expect(installer).toContain("tagObject: '7de39e700d2c329e15d32eb0b96e2f7cdd9fbdb2'")
    expect(installer).toContain("commit: '3c27eb6234bf91b8ceee9e9071591b31e9b148cb'")
    expect(installer).toMatch(/actual_installer_sha[\s\S]{0,200}expected_installer_sha/)
  })

  it('offers the install button only after detection came back empty', () => {
    const onboarding = source('src/renderer/src/components/onboarding/Onboarding.tsx')

    expect(onboarding).toMatch(/const canInstall =[\s\S]{0,160}!detected\.installed/)
    expect(onboarding).toMatch(/canInstall \? \([\s\S]{0,200}installOne\(id\)/)
  })
})
