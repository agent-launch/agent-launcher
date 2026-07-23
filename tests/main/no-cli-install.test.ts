import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('CLI installation policy', () => {
  it('exposes linking but no CLI installation IPC', () => {
    const ipc = source('src/main/ipc.ts')
    const preload = source('src/preload/index.ts')

    expect(ipc).toContain("ipcMain.handle('cli:link'")
    expect(preload).toContain("ipcRenderer.invoke('cli:link'")
    expect(ipc).not.toContain("ipcMain.handle('install:cli'")
    expect(preload).not.toContain("ipcRenderer.invoke('install:cli'")
  })

  it('contains no package-manager or official-installer execution path', () => {
    const installer = source('src/main/install/installer.ts')

    expect(installer).not.toMatch(/npm (?:install|i) -g/i)
    expect(installer).not.toMatch(/["']install["']\s*,\s*["']-g["']/i)
    expect(installer).not.toMatch(/install\.(?:sh|ps1)/i)
    expect(installer).not.toMatch(/(?:brew upgrade|pnpm add -g|bun add -g)/i)
  })
})
