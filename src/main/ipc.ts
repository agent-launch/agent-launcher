import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { loadConfig, setCliConfig } from './store'
import { detectEnvironment } from './install/detect'
import { installCli } from './install/installer'
import {
  createSession,
  writeSession,
  resizeSession,
  killSession,
  type SpawnOptions
} from './pty'
import type { CliConfig, CliId, InstallProgress } from '@shared/types'

export function registerIpc(): void {
  ipcMain.handle('detect', () => detectEnvironment())

  ipcMain.handle('config:get', () => loadConfig())
  ipcMain.handle('config:setCli', (_e, id: CliId, patch: Partial<CliConfig>) =>
    setCliConfig(id, patch)
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

  // ---- PTY terminal ----
  ipcMain.handle('pty:create', (e, opts: SpawnOptions) => createSession(e.sender, opts))
  ipcMain.on('pty:write', (_e, id: string, data: string) => writeSession(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) =>
    resizeSession(id, cols, rows)
  )
  ipcMain.on('pty:kill', (_e, id: string) => killSession(id))
}
