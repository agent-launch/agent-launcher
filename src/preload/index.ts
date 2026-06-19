import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  AppInfo,
  CliId,
  CliUpdateStatus,
  CliMcpPatch,
  CliPricePatch,
  CliProfilePatch,
  CliSkillPatch,
  CleanupCliResult,
  DashboardLaunchResult,
  DetectResult,
  EnvPair,
  InstalledMcpEntry,
  InstalledMcpPatch,
  InstalledSkillEntry,
  InstalledSkillPatch,
  InstallOptions,
  InstallProgress,
  InstallResult,
  NativeFiles,
  SessionDeleteResult,
  SessionInfo,
  SkillsShInstallResult,
  SkillsShSearchResult,
  SkillsShSkill,
  Transcript,
  ChatEvent,
  ChatStartOptions,
  AuthLoginMethod,
  AuthStatus
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
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info')
  },
  detect: (): Promise<DetectResult> => ipcRenderer.invoke('detect'),
  pickDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDir'),
  terminal: {
    openExternal: (opts: SpawnOptions): Promise<void> => ipcRenderer.invoke('terminal:openExternal', opts)
  },
  dashboard: {
    launch: (id: CliId): Promise<DashboardLaunchResult> => ipcRenderer.invoke('dashboard:launch', id)
  },
  skillsSh: {
    search: (query: string, limit?: number): Promise<SkillsShSearchResult> =>
      ipcRenderer.invoke('skillsSh:search', query, limit),
    install: (id: CliId, skill: SkillsShSkill): Promise<SkillsShInstallResult> =>
      ipcRenderer.invoke('skillsSh:install', id, skill)
  },
  resources: {
    listMcp: (id: CliId): Promise<InstalledMcpEntry[]> =>
      ipcRenderer.invoke('resources:listMcp', id),
    addMcp: (id: CliId, patch: InstalledMcpPatch): Promise<InstalledMcpEntry[]> =>
      ipcRenderer.invoke('resources:addMcp', id, patch),
    updateMcp: (id: CliId, entryId: string, patch: InstalledMcpPatch): Promise<InstalledMcpEntry[]> =>
      ipcRenderer.invoke('resources:updateMcp', id, entryId, patch),
    deleteMcp: (id: CliId, entryId: string): Promise<InstalledMcpEntry[]> =>
      ipcRenderer.invoke('resources:deleteMcp', id, entryId),
    listSkills: (id: CliId): Promise<InstalledSkillEntry[]> =>
      ipcRenderer.invoke('resources:listSkills', id),
    updateSkill: (id: CliId, entryId: string, patch: InstalledSkillPatch): Promise<InstalledSkillEntry[]> =>
      ipcRenderer.invoke('resources:updateSkill', id, entryId, patch),
    deleteSkill: (id: CliId, entryId: string): Promise<InstalledSkillEntry[]> =>
      ipcRenderer.invoke('resources:deleteSkill', id, entryId)
  },
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
    setAuthMode: (id: CliId, mode: 'official' | 'api'): Promise<AppConfig> =>
      ipcRenderer.invoke('config:setAuthMode', id, mode),
    setYolo: (id: CliId, on: boolean): Promise<AppConfig> =>
      ipcRenderer.invoke('config:setYolo', id, on),
    addPrice: (id: CliId, patch: CliPricePatch): Promise<AppConfig> =>
      ipcRenderer.invoke('config:addPrice', id, patch),
    updatePrice: (id: CliId, entryId: string, patch: CliPricePatch): Promise<AppConfig> =>
      ipcRenderer.invoke('config:updatePrice', id, entryId, patch),
    deletePrice: (id: CliId, entryId: string): Promise<AppConfig> =>
      ipcRenderer.invoke('config:deletePrice', id, entryId),
    addMcp: (id: CliId, patch: CliMcpPatch): Promise<AppConfig> =>
      ipcRenderer.invoke('config:addMcp', id, patch),
    updateMcp: (id: CliId, entryId: string, patch: CliMcpPatch): Promise<AppConfig> =>
      ipcRenderer.invoke('config:updateMcp', id, entryId, patch),
    deleteMcp: (id: CliId, entryId: string): Promise<AppConfig> =>
      ipcRenderer.invoke('config:deleteMcp', id, entryId),
    addSkill: (id: CliId, patch: CliSkillPatch): Promise<AppConfig> =>
      ipcRenderer.invoke('config:addSkill', id, patch),
    updateSkill: (id: CliId, entryId: string, patch: CliSkillPatch): Promise<AppConfig> =>
      ipcRenderer.invoke('config:updateSkill', id, entryId, patch),
    deleteSkill: (id: CliId, entryId: string): Promise<AppConfig> =>
      ipcRenderer.invoke('config:deleteSkill', id, entryId),
    resolvedEnv: (id: CliId): Promise<EnvPair[]> => ipcRenderer.invoke('config:resolvedEnv', id),
    openFile: (): Promise<string> => ipcRenderer.invoke('config:openFile'),
    reveal: (): Promise<void> => ipcRenderer.invoke('config:reveal'),
    nativeFiles: (id: CliId): Promise<NativeFiles | null> =>
      ipcRenderer.invoke('config:nativeFiles', id),
    revealNative: (id: CliId): Promise<string> => ipcRenderer.invoke('config:revealNative', id)
  },
  sessions: {
    list: (id: CliId): Promise<SessionInfo[]> => ipcRenderer.invoke('sessions:list', id),
    transcript: (id: CliId, sid: string): Promise<Transcript> =>
      ipcRenderer.invoke('sessions:transcript', id, sid),
    remove: (id: CliId, sid: string): Promise<SessionDeleteResult> =>
      ipcRenderer.invoke('sessions:delete', id, sid),
    delete: (id: CliId, sid: string): Promise<SessionDeleteResult> =>
      ipcRenderer.invoke('sessions:delete', id, sid)
  },
  install: {
    cli: (id: CliId, opts?: InstallOptions): Promise<InstallResult> =>
      ipcRenderer.invoke('install:cli', id, opts),
    status: (): Promise<CliUpdateStatus[]> => ipcRenderer.invoke('install:status'),
    cleanupCli: (id: CliId, binPath: string): Promise<CleanupCliResult> =>
      ipcRenderer.invoke('install:cleanupCli', id, binPath),
    onProgress: (cb: (p: InstallProgress) => void) => {
      const listener = (_e: unknown, p: InstallProgress) => cb(p)
      ipcRenderer.on('install:progress', listener)
      return () => {
        ipcRenderer.removeListener('install:progress', listener)
      }
    }
  },
  auth: {
    status: (id: CliId): Promise<AuthStatus> => ipcRenderer.invoke('auth:status', id),
    startLogin: (id: CliId, method: AuthLoginMethod): Promise<string> =>
      ipcRenderer.invoke('auth:startLogin', id, method),
    write: (id: string, data: string) => ipcRenderer.send('auth:write', id, data),
    stop: (id: string) => ipcRenderer.send('auth:stop', id),
    onData: (cb: (id: string, cliId: CliId, data: string) => void) => {
      const l = (_e: unknown, id: string, cliId: CliId, data: string) => cb(id, cliId, data)
      ipcRenderer.on('auth:data', l)
      return () => {
        ipcRenderer.removeListener('auth:data', l)
      }
    },
    onExit: (cb: (id: string, cliId: CliId, code: number) => void) => {
      const l = (_e: unknown, id: string, cliId: CliId, code: number) => cb(id, cliId, code)
      ipcRenderer.on('auth:exit', l)
      return () => {
        ipcRenderer.removeListener('auth:exit', l)
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
  },
  chat: {
    start: (opts: ChatStartOptions): Promise<string> => ipcRenderer.invoke('chat:start', opts),
    send: (id: string, text: string) => ipcRenderer.send('chat:send', id, text),
    stop: (id: string) => ipcRenderer.send('chat:stop', id),
    onEvent: (cb: (id: string, ev: ChatEvent) => void) => {
      const l = (_e: unknown, id: string, ev: ChatEvent) => cb(id, ev)
      ipcRenderer.on('chat:event', l)
      return () => {
        ipcRenderer.removeListener('chat:event', l)
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
