import { clipboard, contextBridge, ipcRenderer } from 'electron'
import { release } from 'node:os'
import {
  BUNDLED_CONPTY_BUILD_NUMBER,
  useBundledConpty,
  windowsBuildNumber
} from '../shared/windows-conpty'
import type {
  AppConfig,
  AppInfo,
  AppUpdateCheckResult,
  AppUpdateDownloadResult,
  AppUpdateStatus,
  CliId,
  CliLinkOptions,
  CliLinkProgress,
  CliLinkResult,
  CliUpdateStatus,
  CliProfilePatch,
  CleanupCliResult,
  DashboardLaunchResult,
  DetectResult,
  InstalledMcpEntry,
  InstalledSkillEntry,
  InstalledSkillFile,
  NativeFiles,
  SessionDeleteResult,
  SessionInfo,
  Transcript,
  ChatEvent,
  ChatStartOptions,
  AuthLoginMethod,
  AuthStatus,
  UsageScanResult
} from '../shared/types'

interface SpawnOptions {
  cliId: CliId
  mode: 'cli' | 'shell'
  cwd?: string
  resumeId?: string
  cols?: number
  rows?: number
}

interface WindowsPtyInfo {
  backend: 'conpty' | 'winpty'
  buildNumber?: number
}

function getWindowsPtyInfo(): WindowsPtyInfo | null {
  if (process.platform !== 'win32') return null

  const buildNumber = windowsBuildNumber(release())
  if (buildNumber === undefined) return { backend: 'conpty' }
  // Windows 10 sessions run on node-pty's bundled Windows Terminal ConPTY
  // (main/pty.ts), which is newer than any in-box conhost — report a build
  // that keeps xterm's legacy-ConPTY workarounds off.
  if (useBundledConpty(buildNumber)) {
    return { backend: 'conpty', buildNumber: BUNDLED_CONPTY_BUILD_NUMBER }
  }
  return { backend: buildNumber < 18309 ? 'winpty' : 'conpty', buildNumber }
}

const api = {
  platform: process.platform as NodeJS.Platform,
  getWindowsPtyInfo,
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
    close: () => ipcRenderer.send('window:close')
  },
  clipboard: {
    readText: (): string => clipboard.readText(),
    writeText: (text: string): void => clipboard.writeText(text)
  },
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
    setMenuLocale: (locale: 'zh' | 'en') => ipcRenderer.send('app:set-menu-locale', locale),
    checkUpdates: () => ipcRenderer.send('app:check-updates-request'),
    openAbout: () => ipcRenderer.send('app:open-about-request'),
    onCheckUpdates: (cb: () => void) => {
      const listener = () => cb()
      ipcRenderer.on('app:check-updates', listener)
      return () => {
        ipcRenderer.removeListener('app:check-updates', listener)
      }
    },
    onOpenAbout: (cb: () => void) => {
      const listener = () => cb()
      ipcRenderer.on('app:open-about', listener)
      return () => {
        ipcRenderer.removeListener('app:open-about', listener)
      }
    }
  },
  appUpdate: {
    getStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('appUpdate:getStatus'),
    check: (): Promise<AppUpdateCheckResult> => ipcRenderer.invoke('appUpdate:check'),
    download: (): Promise<AppUpdateDownloadResult> => ipcRenderer.invoke('appUpdate:download'),
    install: (): Promise<void> => ipcRenderer.invoke('appUpdate:install'),
    openReleasePage: (version?: string): Promise<void> =>
      ipcRenderer.invoke('appUpdate:openReleasePage', version),
    onStatus: (cb: (status: AppUpdateStatus) => void) => {
      const listener = (_e: unknown, status: AppUpdateStatus) => cb(status)
      ipcRenderer.on('appUpdate:status', listener)
      return () => {
        ipcRenderer.removeListener('appUpdate:status', listener)
      }
    }
  },
  detect: (): Promise<DetectResult> => ipcRenderer.invoke('detect'),
  terminal: {
    openExternal: (opts: SpawnOptions): Promise<void> => ipcRenderer.invoke('terminal:openExternal', opts)
  },
  dashboard: {
    launch: (id: CliId): Promise<DashboardLaunchResult> => ipcRenderer.invoke('dashboard:launch', id)
  },
  resources: {
    listMcp: (id: CliId): Promise<InstalledMcpEntry[]> =>
      ipcRenderer.invoke('resources:listMcp', id),
    listSkills: (id: CliId): Promise<InstalledSkillEntry[]> =>
      ipcRenderer.invoke('resources:listSkills', id),
    readSkill: (id: CliId, entryId: string): Promise<InstalledSkillFile> =>
      ipcRenderer.invoke('resources:readSkill', id, entryId)
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
    setYolo: (id: CliId, on: boolean): Promise<AppConfig> =>
      ipcRenderer.invoke('config:setYolo', id, on),
    nativeFiles: (id: CliId): Promise<NativeFiles | null> =>
      ipcRenderer.invoke('config:nativeFiles', id)
  },
  sessions: {
    list: (requestId: string, id: CliId): Promise<SessionInfo[] | null> =>
      ipcRenderer.invoke('sessions:list', requestId, id),
    cancel: (requestId: string): Promise<boolean> => ipcRenderer.invoke('sessions:cancel', requestId),
    transcript: (id: CliId, sid: string): Promise<Transcript> =>
      ipcRenderer.invoke('sessions:transcript', id, sid),
    delete: (id: CliId, sid: string): Promise<SessionDeleteResult> =>
      ipcRenderer.invoke('sessions:delete', id, sid)
  },
  cli: {
    link: (id: CliId, opts?: CliLinkOptions): Promise<CliLinkResult> =>
      ipcRenderer.invoke('cli:link', id, opts),
    status: (): Promise<CliUpdateStatus[]> => ipcRenderer.invoke('cli:status'),
    cleanupCli: (id: CliId, binPath: string): Promise<CleanupCliResult> =>
      ipcRenderer.invoke('cli:cleanup', id, binPath),
    onLinkProgress: (cb: (p: CliLinkProgress) => void) => {
      const listener = (_e: unknown, p: CliLinkProgress) => cb(p)
      ipcRenderer.on('cli:linkProgress', listener)
      return () => {
        ipcRenderer.removeListener('cli:linkProgress', listener)
      }
    }
  },
  usage: {
    read: (requestId: string, rangeDays?: number, summaryDays?: number): Promise<UsageScanResult | null> =>
      ipcRenderer.invoke('usage:read', requestId, rangeDays, summaryDays),
    cancel: (requestId: string): Promise<boolean> => ipcRenderer.invoke('usage:cancel', requestId)
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
