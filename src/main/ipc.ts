import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import {
  loadConfig,
  addProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  setYolo
} from './store'
import { paths } from './sandbox'
import { writeNativeConfig, readNativeFiles, hasNativeConfig } from './native-config'
import { deleteSession, readTranscript } from './sessions-history'
import { detectEnvironment } from './install/detect'
import { cleanupSystemCli, getCliUpdateStatuses, installCli } from './install/installer'
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
import type {
  AuthLoginMethod,
  CliId,
  ChatStartOptions,
  CliProfilePatch,
  InstallOptions,
  InstallProgress
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

  // ---- config / profiles (cc-switch style) ----
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
  ipcMain.handle('resources:listMcp', (_e, id: CliId) => listInstalledMcp(id))
  ipcMain.handle('resources:listSkills', (_e, id: CliId) => listInstalledSkills(id))
  ipcMain.handle('resources:readSkill', (_e, id: CliId, entryId: string) =>
    readInstalledSkill(id, entryId)
  )
  ipcMain.handle('config:nativeFiles', (_e, id: CliId) => (hasNativeConfig(id) ? readNativeFiles(id) : null))

  ipcMain.handle('install:cli', async (e: IpcMainInvokeEvent, id: CliId, opts?: InstallOptions) => {
    const send = (p: InstallProgress) => {
      if (!e.sender.isDestroyed()) e.sender.send('install:progress', p)
    }
    return installCli(
      id,
      (phase, message, fraction) =>
        send({ cliId: id, phase: phase as InstallProgress['phase'], message, fraction }),
      opts
    )
  })
  ipcMain.handle('install:cleanupCli', (_e, id: CliId, binPath: string) => cleanupSystemCli(id, binPath))
  ipcMain.handle('install:status', () => getCliUpdateStatuses())
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

  ipcMain.handle('terminal:openExternal', (_e, opts: SpawnOptions) => openExternalAgent(opts))
  ipcMain.handle('dashboard:launch', (_e, id: CliId) => launchDashboard(id))

  // ---- sessions (CLI-native conversation history) ----
  ipcMain.handle('sessions:list', (_e, requestId: string, id: CliId) =>
    listSessionsInWorker(requestId, id)
  )
  ipcMain.handle('sessions:cancel', (_e, requestId: string) => cancelSessionList(requestId))
  ipcMain.handle('sessions:transcript', (_e, id: CliId, sid: string) => readTranscript(id, sid))
  ipcMain.handle('sessions:delete', (_e, id: CliId, sid: string) => deleteSession(id, sid))

  // ---- PTY terminal ----
  ipcMain.handle('pty:create', (e, opts: SpawnOptions) => createSession(e.sender, opts))
  ipcMain.on('pty:write', (_e, id: string, data: string) => writeSession(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) =>
    resizeSession(id, cols, rows)
  )
  ipcMain.on('pty:kill', (_e, id: string) => killSession(id))

  // ---- in-UI chat (programmatic CLI mode) ----
  ipcMain.handle('chat:start', (e, opts: ChatStartOptions) => startChat(e.sender, opts))
  ipcMain.on('chat:send', (_e, id: string, text: string) => sendChat(id, text))
  ipcMain.on('chat:stop', (_e, id: string) => stopChat(id))
}
