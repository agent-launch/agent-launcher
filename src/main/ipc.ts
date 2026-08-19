import { app, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import {
  loadConfig,
  addProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  setYolo,
  setUsageTrackingEnabled,
  touchRecentProject
} from './store'
import {
  checkDirectoriesExist,
  listRecentProjects,
  removeRecentProjectAndList,
  selectProjectDirectory
} from './projects'
import { paths } from './sandbox'
import { writeNativeConfig, readNativeFiles, hasNativeConfig } from './native-config'
import { deleteSession, readTranscript } from './sessions-history'
import { defaultWorkspaceForCli } from './launch-cwd'
import { detectEnvironment } from './install/detect'
import {
  cleanupSystemCli,
  getCliUpdateStatuses,
  installMissingCli,
  linkSystemCli
} from './install/installer'
import {
  createSession,
  openExternalAgent,
  writeSession,
  resizeSession,
  killSession,
  type SpawnOptions
} from './pty'
import { startChat, sendChat, stopChat } from './chat'
import { authStatus, startAuthLogin, writeAuth, stopAuth } from './auth'
import { launchDashboard } from './dashboard'
import { ensureSystemConfigImported } from './import-existing-config'
import { cancelUsageRead, readUsageInWorker } from './usage-runner'
import { cancelSessionList, listSessionsInWorker } from './sessions-runner'
import { listInstalledMcp, listInstalledSkills, readInstalledSkill } from './installed-resources'
import { testProfileConnection } from './profile-connectivity'
import { discoverModels } from './model-discovery'
import type {
  AuthLoginMethod,
  CliLinkOptions,
  CliLinkProgress,
  CliId,
  ChatStartOptions,
  CliProfilePatch,
  ModelDiscoveryRequest
} from '@shared/types'

export function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    configPath: paths.config,
    hasConfig: existsSync(paths.config)
  }))
  ipcMain.handle('detect', () => detectEnvironment())

  // ---- config / profiles ----
  // Keep file-configured CLIs' native config in sync after any profile change.
  const synced = (id: CliId, cfg: ReturnType<typeof loadConfig>) => {
    if (hasNativeConfig(id)) writeNativeConfig(id)
    return cfg
  }
  ipcMain.handle('config:get', () => {
    ensureSystemConfigImported()
    return loadConfig()
  })
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
  ipcMain.handle('config:setUsageTrackingEnabled', (_e, id: 'gemini', on: boolean) =>
    setUsageTrackingEnabled(id, on)
  )
  ipcMain.handle('config:testConnection', (_e, id: CliId, patch: CliProfilePatch) =>
    testProfileConnection(id, patch)
  )
  ipcMain.handle('config:listModels', (_e, id: CliId, request: ModelDiscoveryRequest) =>
    discoverModels(id, request)
  )
  ipcMain.handle('resources:listMcp', (_e, id: CliId) => listInstalledMcp(id))
  ipcMain.handle('resources:listSkills', (_e, id: CliId) => listInstalledSkills(id))
  ipcMain.handle('resources:readSkill', (_e, id: CliId, entryId: string) =>
    readInstalledSkill(id, entryId)
  )
  ipcMain.handle('config:nativeFiles', (_e, id: CliId) =>
    hasNativeConfig(id) ? readNativeFiles(id) : null
  )

  ipcMain.handle('cli:link', async (e, id: CliId, opts?: CliLinkOptions) => {
    const send = (p: CliLinkProgress) => {
      if (!e.sender.isDestroyed()) e.sender.send('cli:linkProgress', p)
    }
    return linkSystemCli(id, (phase, message) => send({ cliId: id, phase, message }), opts?.binPath)
  })
  // Installs only what is missing. `installMissingCli` links instead of
  // installing when the CLI is already present, so this can never disturb an
  // existing install.
  ipcMain.handle('cli:install', async (e, id: CliId) => {
    const send = (p: CliLinkProgress) => {
      if (!e.sender.isDestroyed()) e.sender.send('cli:linkProgress', p)
    }
    return installMissingCli(id, (phase, message) => send({ cliId: id, phase, message }))
  })
  ipcMain.handle('cli:cleanup', (_e, id: CliId, binPath: string) => cleanupSystemCli(id, binPath))
  ipcMain.handle('cli:status', () => getCliUpdateStatuses())
  ipcMain.handle('usage:read', (_e, requestId: string, rangeDays?: number, summaryDays?: number) =>
    readUsageInWorker(requestId, rangeDays, summaryDays)
  )
  ipcMain.handle('usage:cancel', (_e, requestId: string) => cancelUsageRead(requestId))

  ipcMain.handle('auth:status', (_e, id: CliId) => authStatus(id))
  ipcMain.handle('auth:startLogin', (e, id: CliId, method: AuthLoginMethod) =>
    startAuthLogin(e.sender, id, method)
  )
  ipcMain.on('auth:write', (_e, id: string, data: string) => writeAuth(id, data))
  ipcMain.on('auth:stop', (_e, id: string) => stopAuth(id))

  ipcMain.handle('terminal:openExternal', (_e, opts: SpawnOptions) => {
    touchRecentProject(opts.cwd)
    return openExternalAgent(opts)
  })
  ipcMain.handle('dashboard:launch', (_e, id: CliId) => launchDashboard(id))

  // ---- sessions (CLI-native conversation history) ----
  ipcMain.handle('sessions:list', (_e, requestId: string, id: CliId) =>
    listSessionsInWorker(requestId, id)
  )
  ipcMain.handle('sessions:cancel', (_e, requestId: string) => cancelSessionList(requestId))
  ipcMain.handle('sessions:transcript', (_e, id: CliId, sid: string) => readTranscript(id, sid))
  ipcMain.handle('sessions:delete', (_e, id: CliId, sid: string) => deleteSession(id, sid))
  // Lets the renderer know what cwd a directory-less "New Session" will
  // actually launch into, so the tab it opens can be tagged with that same
  // cwd up front — needed to later match this tab back to its own history
  // entry (see reconcileNewSessionTabs in Shell.tsx), since resolveLaunchCwd
  // picks this same default whenever no directory is chosen.
  ipcMain.handle('sessions:defaultWorkspace', (_e, id: CliId) => defaultWorkspaceForCli(id))

  // ---- recent projects (user-picked working directories, shared across CLIs) ----
  ipcMain.handle('projects:list', () => listRecentProjects())
  ipcMain.handle('projects:select', (e) => selectProjectDirectory(e.sender))
  ipcMain.handle('projects:remove', (_e, path: string) => removeRecentProjectAndList(path))
  ipcMain.handle('projects:exists', (_e, paths: string[]) => checkDirectoriesExist(paths))

  // ---- PTY terminal ----
  ipcMain.handle('pty:create', (e, opts: SpawnOptions) => {
    // No-op unless opts.cwd is a recorded project — keeps recents ordered by
    // actual use without ever recording scratch workspaces.
    touchRecentProject(opts.cwd)
    return createSession(e.sender, opts)
  })
  ipcMain.on('pty:write', (_e, id: string, data: string) => writeSession(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) =>
    resizeSession(id, cols, rows)
  )
  ipcMain.on('pty:kill', (_e, id: string) => killSession(id))

  // ---- in-UI chat (programmatic CLI mode) ----
  ipcMain.handle('chat:start', (e, opts: ChatStartOptions) => {
    touchRecentProject(opts.cwd)
    return startChat(e.sender, opts)
  })
  ipcMain.on('chat:send', (_e, id: string, text: string) => sendChat(id, text))
  ipcMain.on('chat:stop', (_e, id: string) => stopChat(id))
}
