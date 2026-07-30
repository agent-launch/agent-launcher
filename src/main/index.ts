import { app, shell, BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { killAll } from './pty'
import { killAllChats } from './chat'
import { killAllAuth } from './auth'
import { cancelAllUsageReads } from './usage-runner'
import { cancelAllSessionLists } from './sessions-runner'
import { registerAppUpdateIpc, startAppUpdateAutoCheck } from './app-update'
import { hasNativeConfig, writeNativeConfig } from './native-config'
import { loadConfig } from './store'
import type { CliId } from '@shared/types'

type MenuLocale = 'zh' | 'en'

let menuLocale: MenuLocale | null = null

function sendCheckUpdates(): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.webContents.isDestroyed()) return
  win.show()
  win.focus()
  win.webContents.send('app:check-updates')
}

function sendOpenAbout(): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.webContents.isDestroyed()) return
  win.show()
  win.focus()
  win.webContents.send('app:open-about')
}

function installApplicationMenu(locale = menuLocale): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const zh = locale ? locale === 'zh' : app.getLocale().toLowerCase().startsWith('zh')
  const name = app.getName()
  const label = {
    file: zh ? '文件' : 'File',
    edit: zh ? '编辑' : 'Edit',
    view: zh ? '显示' : 'View',
    window: zh ? '窗口' : 'Window',
    help: zh ? '帮助' : 'Help',
    about: zh ? `关于 ${name}` : `About ${name}`,
    checkUpdates: zh ? '检查更新…' : 'Check for Updates…',
    close: zh ? '关闭窗口' : 'Close Window',
    quit: zh ? `退出 ${name}` : `Quit ${name}`
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: name,
      submenu: [
        { role: 'about', label: label.about },
        { label: label.checkUpdates, click: sendCheckUpdates },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: label.quit }
      ]
    },
    {
      label: label.file,
      submenu: [{ role: 'close', label: label.close }]
    },
    {
      label: label.edit,
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: label.view,
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: label.window,
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      label: label.help,
      submenu: []
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: 'Agent Launcher',
    backgroundColor: '#ffffff',
    // Netcatty uses native macOS traffic lights with this window shape:
    // frame + hiddenInset + explicit trafficLightPosition. Keeping the controls
    // native preserves the system hover glyphs and window menu behavior.
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    // Windows / Linux: keep native min/max/close controls via the overlay.
    ...(!isMac
      ? { titleBarOverlay: { color: '#ffffff00', symbolColor: '#6e6e73', height: 40 } }
      : {}),
    ...(isMac ? { trafficLightPosition: { x: 16, y: 8 } } : {}),
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

  // A file/folder dropped outside a renderer drop zone would otherwise
  // navigate the window to file:// and wipe the whole UI state. Same-URL
  // navigation stays allowed so renderer-initiated reloads keep working.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    win.loadURL(rendererUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

const isPrimaryInstance = app.requestSingleInstanceLock()

if (!isPrimaryInstance) {
  app.quit()
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    if (app.isReady()) createWindow()
    return
  }

  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
})

app.whenReady().then(() => {
  if (!isPrimaryInstance) return

  app.setName('Agent Launcher')
  installApplicationMenu()

  // Window control IPC for the custom titlebar.
  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('window:toggle-fullscreen', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    w.setFullScreen(!w.isFullScreen())
  })
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle('app:platform', () => process.platform)
  ipcMain.on('app:set-menu-locale', (_e, locale: MenuLocale) => {
    menuLocale = locale
    installApplicationMenu(locale)
  })
  ipcMain.on('app:check-updates-request', sendCheckUpdates)
  ipcMain.on('app:open-about-request', sendOpenAbout)

  // Legacy app-managed installs used to redirect each CLI's config home into
  // ~/.agent-launcher/cli-config/<cliId>. We now use standard config dirs, so
  // re-materialize relay/API-key settings for any remaining legacy installs so
  // their first launch after upgrade still works. writeNativeConfig is merge-
  // based and safe to call repeatedly.
  const config = loadConfig()
  for (const id of Object.keys(config.install) as CliId[]) {
    const install = config.install[id]
    if (install.installed && install.legacyManaged && hasNativeConfig(id)) {
      try {
        writeNativeConfig(id)
      } catch (error) {
        console.warn(`Failed to migrate ${id} native config:`, error)
      }
    }
  }

  registerIpc()
  registerAppUpdateIpc()

  createWindow()
  startAppUpdateAutoCheck()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  killAll()
  killAllChats()
  killAllAuth()
  cancelAllUsageReads()
  cancelAllSessionLists()
})

app.on('window-all-closed', () => {
  killAll()
  killAllChats()
  killAllAuth()
  cancelAllUsageReads()
  cancelAllSessionLists()
  if (process.platform !== 'darwin') app.quit()
})
