import { ipcMain, dialog, shell, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  loadConfig,
  addProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  setYolo
} from './store'
import { paths } from './sandbox'
import { resolvedEnvPreview } from './cli-env'
import { writeNativeConfig, readNativeFiles, hasNativeConfig } from './native-config'
import { listSessions, readTranscript } from './sessions-history'
import { detectEnvironment } from './install/detect'
import { installCli } from './install/installer'
import {
  createSession,
  writeSession,
  resizeSession,
  killSession,
  type SpawnOptions
} from './pty'
import type { CliId, CliProfilePatch, InstallProgress } from '@shared/types'

export function registerIpc(): void {
  ipcMain.handle('detect', () => detectEnvironment())

  // ---- config / profiles (cc-switch style) ----
  // Keep file-configured CLIs' native config in sync after any profile change.
  const synced = (id: CliId, cfg: ReturnType<typeof loadConfig>) => {
    if (hasNativeConfig(id)) writeNativeConfig(id)
    return cfg
  }
  ipcMain.handle('config:get', () => loadConfig())
  ipcMain.handle('config:addProfile', (_e, id: CliId, patch: CliProfilePatch) =>
    synced(id, addProfile(id, patch))
  )
  ipcMain.handle('config:updateProfile', (_e, id: CliId, pid: string, patch: CliProfilePatch) =>
    synced(id, updateProfile(id, pid, patch))
  )
  ipcMain.handle('config:deleteProfile', (_e, id: CliId, pid: string) =>
    synced(id, deleteProfile(id, pid))
  )
  ipcMain.handle('config:setActiveProfile', (_e, id: CliId, pid: string) =>
    synced(id, setActiveProfile(id, pid))
  )
  ipcMain.handle('config:setYolo', (_e, id: CliId, on: boolean) => setYolo(id, on))
  ipcMain.handle('config:resolvedEnv', (_e, id: CliId) => resolvedEnvPreview(id))
  ipcMain.handle('config:openFile', () => shell.openPath(paths.config))
  ipcMain.handle('config:reveal', () => shell.showItemInFolder(paths.config))
  ipcMain.handle('config:nativeFiles', (_e, id: CliId) =>
    hasNativeConfig(id) ? readNativeFiles(id) : null
  )
  ipcMain.handle('config:revealNative', (_e, id: CliId) =>
    shell.openPath(paths.cliConfig(id))
  )

  ipcMain.handle('install:cli', async (e: IpcMainInvokeEvent, id: CliId) => {
    const send = (p: InstallProgress) => {
      if (!e.sender.isDestroyed()) e.sender.send('install:progress', p)
    }
    return installCli(id, (phase, message, fraction) =>
      send({ cliId: id, phase: phase as InstallProgress['phase'], message, fraction })
    )
  })

  ipcMain.handle('dialog:pickDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  // ---- sessions (CLI-native conversation history) ----
  ipcMain.handle('sessions:list', (_e, id: CliId) => listSessions(id))
  ipcMain.handle('sessions:transcript', (_e, id: CliId, sid: string) => readTranscript(id, sid))

  // ---- PTY terminal ----
  ipcMain.handle('pty:create', (e, opts: SpawnOptions) => createSession(e.sender, opts))
  ipcMain.on('pty:write', (_e, id: string, data: string) => writeSession(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) =>
    resizeSession(id, cols, rows)
  )
  ipcMain.on('pty:kill', (_e, id: string) => killSession(id))
}
