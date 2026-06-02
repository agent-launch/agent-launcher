import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  CliConfig,
  CliId,
  DetectResult,
  InstallProgress,
  InstallResult
} from '../shared/types'

interface SpawnOptions {
  cliId: CliId
  mode: 'cli' | 'shell'
  cwd?: string
  cols?: number
  rows?: number
}

const api = {
  platform: process.platform as NodeJS.Platform,
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close')
  },
  detect: (): Promise<DetectResult> => ipcRenderer.invoke('detect'),
  pickDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDir'),
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    setCli: (id: CliId, patch: Partial<CliConfig>): Promise<AppConfig> =>
      ipcRenderer.invoke('config:setCli', id, patch)
  },
  install: {
    cli: (id: CliId): Promise<InstallResult> => ipcRenderer.invoke('install:cli', id),
    onProgress: (cb: (p: InstallProgress) => void) => {
      const listener = (_e: unknown, p: InstallProgress) => cb(p)
      ipcRenderer.on('install:progress', listener)
      return () => {
        ipcRenderer.removeListener('install:progress', listener)
      }
    }
  },
  pty: {
    create: (opts: SpawnOptions): Promise<string> => ipcRenderer.invoke('pty:create', opts),
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.send('pty:kill', id),
    onData: (cb: (id: string, data: string) => void) => {
      const l = (_e: unknown, id: string, data: string) => cb(id, data)
      ipcRenderer.on('pty:data', l)
      return () => {
        ipcRenderer.removeListener('pty:data', l)
      }
    },
    onExit: (cb: (id: string, code: number) => void) => {
      const l = (_e: unknown, id: string, code: number) => cb(id, code)
      ipcRenderer.on('pty:exit', l)
      return () => {
        ipcRenderer.removeListener('pty:exit', l)
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
