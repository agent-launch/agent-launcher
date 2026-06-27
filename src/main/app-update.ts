import { app, BrowserWindow, ipcMain, shell } from 'electron'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import type {
  AppUpdateCheckResult,
  AppUpdateDownloadProgress,
  AppUpdateDownloadResult,
  AppUpdatePolicy,
  AppUpdateRelease,
  AppUpdateStatus
} from '@shared/types'

const GITHUB_OWNER = process.env.AGENT_LAUNCHER_UPDATE_OWNER || 'matrixlabs'
const GITHUB_REPO = process.env.AGENT_LAUNCHER_UPDATE_REPO || 'agent-launcher'
const RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
const DEFAULT_POLICY_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/update-policy.json`
const POLICY_URL = process.env.AGENT_LAUNCHER_UPDATE_POLICY_URL || DEFAULT_POLICY_URL
const AUTO_CHECK_DELAY_MS = 5000

let autoUpdater: typeof import('electron-updater').autoUpdater | null | undefined
let autoCheckTimer: NodeJS.Timeout | null = null

let status: AppUpdateStatus = {
  status: 'idle',
  supported: isAutoUpdateSupported(),
  canAutoDownload: false,
  currentVersion: app.getVersion()
}

function isAutoUpdateSupported(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'darwin' || process.platform === 'win32') return true
  return process.platform === 'linux' && !!process.env.APPIMAGE
}

function getAutoUpdater(): typeof import('electron-updater').autoUpdater | null {
  if (autoUpdater !== undefined) return autoUpdater
  try {
    const mod = require('electron-updater') as typeof import('electron-updater')
    mod.autoUpdater.autoDownload = false
    mod.autoUpdater.autoInstallOnAppQuit = false
    mod.autoUpdater.logger = null
    autoUpdater = mod.autoUpdater
  } catch (err) {
    autoUpdater = null
    console.warn('[AppUpdate] electron-updater unavailable:', err instanceof Error ? err.message : err)
  }
  return autoUpdater
}

function snapshot(patch: Partial<AppUpdateStatus> = {}): AppUpdateStatus {
  status = {
    ...status,
    supported: isAutoUpdateSupported(),
    currentVersion: app.getVersion(),
    ...patch
  }
  return status
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      if (payload === undefined) win.webContents.send(channel)
      else win.webContents.send(channel, payload)
    }
  }
}

function emitStatus(next = status): void {
  broadcast('appUpdate:status', next)
}

function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a).split(/[.-]/)
  const right = normalizeVersion(b).split(/[.-]/)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i += 1) {
    const aa = left[i] ?? '0'
    const bb = right[i] ?? '0'
    const an = /^\d+$/.test(aa) ? Number(aa) : Number.NaN
    const bn = /^\d+$/.test(bb) ? Number(bb) : Number.NaN
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      if (an > bn) return 1
      if (an < bn) return -1
      continue
    }
    if (aa > bb) return 1
    if (aa < bb) return -1
  }

  return 0
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

function releaseUrl(version?: string): string {
  if (!version) return `${RELEASES_URL}/latest`
  return `${RELEASES_URL}/tag/v${normalizeVersion(version)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json, application/json',
      'User-Agent': `AgentLauncher/${app.getVersion()}`
    }
  })
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  return res.json() as Promise<unknown>
}

async function fetchLatestRelease(): Promise<AppUpdateRelease | undefined> {
  const data = await fetchJson(RELEASES_API_URL)
  if (!isRecord(data)) return undefined
  const tagName = stringField(data.tag_name)
  if (!tagName) return undefined
  const assets = Array.isArray(data.assets) ? data.assets : []
  return {
    version: normalizeVersion(tagName),
    tagName,
    name: stringField(data.name) ?? tagName,
    notes: stringField(data.body),
    url: stringField(data.html_url) ?? releaseUrl(tagName),
    publishedAt: stringField(data.published_at),
    assets: assets.filter(isRecord).map((asset) => ({
      name: stringField(asset.name) ?? '',
      url: stringField(asset.browser_download_url) ?? '',
      size: typeof asset.size === 'number' ? asset.size : undefined
    })).filter((asset) => asset.name && asset.url)
  }
}

function normalizePolicy(data: unknown, latest?: AppUpdateRelease): AppUpdatePolicy {
  if (!isRecord(data)) {
    return { force: false, latestVersion: latest?.version, url: latest?.url }
  }

  const minVersion = stringField(data.minVersion) ?? stringField(data.minimumVersion)
  const latestVersion = stringField(data.latestVersion) ?? latest?.version
  const forceFlag = data.force === true || data.forceUpdate === true || data.mandatory === true
  const mustForceByVersion = !!minVersion && compareVersions(app.getVersion(), minVersion) < 0
  const mustForceByLatest = forceFlag && !!latestVersion && compareVersions(app.getVersion(), latestVersion) < 0

  return {
    force: mustForceByVersion || mustForceByLatest || (forceFlag && !minVersion && !latestVersion),
    minVersion,
    latestVersion,
    message: stringField(data.message),
    url: stringField(data.url) ?? latest?.url
  }
}

async function fetchPolicy(latest?: AppUpdateRelease): Promise<AppUpdatePolicy> {
  try {
    return normalizePolicy(await fetchJson(POLICY_URL), latest)
  } catch (err) {
    console.warn('[AppUpdate] policy check failed:', err instanceof Error ? err.message : err)
    return { force: false, latestVersion: latest?.version, url: latest?.url }
  }
}

function releaseFromUpdateInfo(info: UpdateInfo): AppUpdateRelease {
  const releaseNotes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map((item) => (typeof item === 'string' ? item : item.note)).filter(Boolean).join('\n\n')
    : typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : undefined

  return {
    version: normalizeVersion(info.version),
    tagName: `v${normalizeVersion(info.version)}`,
    name: `v${normalizeVersion(info.version)}`,
    notes: releaseNotes,
    url: releaseUrl(info.version),
    publishedAt: info.releaseDate,
    assets: []
  }
}

function registerUpdaterEvents(): void {
  const updater = getAutoUpdater()
  if (!updater) return

  updater.on('update-available', (info) => {
    const latestRelease = status.latestRelease ?? releaseFromUpdateInfo(info)
    snapshot({ status: 'available', latestRelease, error: undefined })
    emitStatus()
  })
  updater.on('update-not-available', () => {
    const knownLatest = status.latestRelease?.version ?? status.policy?.latestVersion
    const stillHasKnownUpdate = !!knownLatest && compareVersions(knownLatest, app.getVersion()) > 0
    snapshot({
      status: stillHasKnownUpdate ? 'available' : 'up-to-date',
      canAutoDownload: false,
      error: undefined,
      checkedAt: Date.now()
    })
    emitStatus()
  })
  updater.on('download-progress', (progress: ProgressInfo) => {
    const payload: AppUpdateDownloadProgress = {
      percent: progress.percent ?? 0,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    }
    snapshot({ status: 'downloading', percent: payload.percent, error: undefined })
    emitStatus()
    broadcast('appUpdate:download-progress', payload)
  })
  updater.on('update-downloaded', (info) => {
    snapshot({ status: 'downloaded', latestRelease: status.latestRelease ?? releaseFromUpdateInfo(info), percent: 100 })
    emitStatus()
  })
  updater.on('error', (err) => {
    snapshot({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    emitStatus()
  })
}

export function registerAppUpdateIpc(): void {
  registerUpdaterEvents()

  ipcMain.handle('appUpdate:getStatus', () => status)
  ipcMain.handle('appUpdate:check', async (): Promise<AppUpdateCheckResult> => {
    cancelAutoCheck()
    return checkForAppUpdate()
  })
  ipcMain.handle('appUpdate:download', async (): Promise<AppUpdateDownloadResult> => downloadAppUpdate())
  ipcMain.handle('appUpdate:install', () => {
    const updater = getAutoUpdater()
    if (!updater) return
    updater.quitAndInstall(false, true)
  })
  ipcMain.handle('appUpdate:openReleasePage', (_event, version?: string) => {
    void shell.openExternal(status.latestRelease?.url || status.policy?.url || releaseUrl(version))
  })
}

export function startAppUpdateAutoCheck(delayMs = AUTO_CHECK_DELAY_MS): void {
  cancelAutoCheck()
  autoCheckTimer = setTimeout(() => {
    autoCheckTimer = null
    void checkForAppUpdate({ silent: true })
  }, delayMs)
  autoCheckTimer.unref?.()
}

function cancelAutoCheck(): void {
  if (autoCheckTimer) {
    clearTimeout(autoCheckTimer)
    autoCheckTimer = null
  }
}

async function checkForAppUpdate(opts: { silent?: boolean } = {}): Promise<AppUpdateCheckResult> {
  const started = snapshot({ status: 'checking', error: undefined })
  if (!opts.silent) emitStatus(started)

  try {
    const latestReleaseResult = await fetchLatestRelease()
      .then((release) => ({ ok: true as const, release }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    const latestRelease = latestReleaseResult.ok ? latestReleaseResult.release : undefined
    const policy = await fetchPolicy(latestRelease)
    if (!latestReleaseResult.ok) {
      console.warn(
        '[AppUpdate] release check failed:',
        latestReleaseResult.error instanceof Error ? latestReleaseResult.error.message : latestReleaseResult.error
      )
    }
    const hasReleaseUpdate = !!latestRelease && compareVersions(latestRelease.version, app.getVersion()) > 0
    const hasPolicyUpdate = !!policy.latestVersion && compareVersions(policy.latestVersion, app.getVersion()) > 0
    const hasUpdate = hasReleaseUpdate || hasPolicyUpdate

    if (!latestReleaseResult.ok && !policy.latestVersion && !policy.force) {
      const error = latestReleaseResult.error instanceof Error
        ? latestReleaseResult.error.message
        : String(latestReleaseResult.error)
      const failed = snapshot({ status: 'error', policy, error, checkedAt: Date.now() })
      emitStatus(failed)
      return { ok: false, status: failed, error }
    }
    const next = snapshot({
      status: hasUpdate ? 'available' : 'up-to-date',
      latestRelease,
      policy,
      canAutoDownload: false,
      checkedAt: Date.now(),
      error: undefined,
      percent: undefined
    })
    emitStatus(next)

    if (hasUpdate && isAutoUpdateSupported()) {
      const updater = getAutoUpdater()
      if (updater) {
        const updaterResult = await updater.checkForUpdates().catch((err) => {
          console.warn('[AppUpdate] updater feed check failed:', err instanceof Error ? err.message : err)
          return null
        })
        if (updaterResult?.updateInfo) snapshot({ canAutoDownload: true })
      }
    }

    return { ok: true, status }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const next = snapshot({ status: 'error', error, checkedAt: Date.now() })
    emitStatus(next)
    return { ok: false, status: next, error }
  }
}

async function downloadAppUpdate(): Promise<AppUpdateDownloadResult> {
  if (!isAutoUpdateSupported()) {
    const error = '当前安装包格式不支持应用内自动更新，请前往 GitHub Releases 下载。'
    const next = snapshot({ status: 'error', error })
    return { ok: false, status: next, error }
  }

  const updater = getAutoUpdater()
  if (!updater) {
    const error = '更新模块不可用。'
    const next = snapshot({ status: 'error', error })
    return { ok: false, status: next, error }
  }

  try {
    if (!status.canAutoDownload) {
      const result = await updater.checkForUpdates().catch(() => null)
      if (!result?.updateInfo) {
        const error = '未找到当前平台的自动更新元数据，请前往 GitHub Releases 下载。'
        const next = snapshot({ status: 'error', error, canAutoDownload: false })
        return { ok: false, status: next, error }
      }
      snapshot({ canAutoDownload: true })
    }
    const next = snapshot({ status: 'downloading', percent: 0, error: undefined })
    emitStatus(next)
    await updater.downloadUpdate()
    return { ok: true, status }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const next = snapshot({ status: 'error', error })
    emitStatus(next)
    return { ok: false, status: next, error }
  }
}
