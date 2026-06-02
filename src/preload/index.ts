import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  CliId,
  CliProfilePatch,
  DetectResult,
  EnvPair,
  InstallProgress,
  InstallResult,
  NativeFiles,
  SessionInfo
} from '../shared/types'

interface SpawnOptions {
  cliId: CliId
  mode: 'cli' | 'shell'
  cwd?: string
  resumeId?: string
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
    addProfile: (id: CliId, patch: CliProfilePatch): Promise<AppConfig> =>
      ipcRenderer.invoke('config:addProfile', id, patch),
    updateProfile: (id: CliId, pid: string, patch: CliProfilePatch): Promise<AppConfig> =>
      ipcRenderer.invoke('config:updateProfile', id, pid, patch),
    deleteProfile: (id: CliId, pid: string): Promise<AppConfig> =>
      ipcRenderer.invoke('config:deleteProfile', id, pid),
    setActiveProfile: (id: CliId, pid: string): Promise<AppConfig> =>
      ipcRenderer.invoke('config:setActiveProfile', id, pid),
    resolvedEnv: (id: CliId): Promise<EnvPair[]> => ipcRenderer.invoke('config:resolvedEnv', id),
    openFile: (): Promise<string> => ipcRenderer.invoke('config:openFile'),
    reveal: (): Promise<void> => ipcRenderer.invoke('config:reveal'),
    nativeFiles: (id: CliId): Promise<NativeFiles | null> =>
      ipcRenderer.invoke('config:nativeFiles', id),
    revealNative: (id: CliId): Promise<string> => ipcRenderer.invoke('config:revealNative', id)
  },
  sessions: {
    list: (id: CliId): Promise<SessionInfo[]> => ipcRenderer.invoke('sessions:list', id)
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
