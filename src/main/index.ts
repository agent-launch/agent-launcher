import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { killAll } from './pty'
import { killAllChats } from './chat'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: 'AgentLauncher',
    backgroundColor: '#101010',
    // Frameless with a custom titlebar (see renderer Titlebar component).
    titleBarStyle: 'hidden',
    // Windows / Linux: keep native min/max/close controls via the overlay.
    titleBarOverlay: { color: '#10101000', symbolColor: '#9a9a9a', height: 40 },
    // macOS: inset the traffic lights to line up with our 40px titlebar.
    trafficLightPosition: { x: 12, y: 13 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // Open external links in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    win.loadURL(rendererUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  app.setName('AgentLauncher')

  // Window control IPC for the custom titlebar.
  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle('app:platform', () => process.platform)

  registerIpc()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  killAll()
  killAllChats()
})

app.on('window-all-closed', () => {
  killAll()
  killAllChats()
  if (process.platform !== 'darwin') app.quit()
})
