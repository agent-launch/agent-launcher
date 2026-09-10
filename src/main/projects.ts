import { statSync } from 'node:fs'
import { BrowserWindow, dialog, type WebContents } from 'electron'
import type { CliId, RecentProjectInfo } from '@shared/types'
import { addRecentProject, loadConfig, removeRecentProject } from './store'

/** Renderer-supplied path lists are capped so a buggy caller can't turn one
 * IPC round-trip into thousands of stat calls. */
const MAX_EXISTS_CHECKS = 200

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function listRecentProjects(id: CliId): RecentProjectInfo[] {
  return loadConfig().recentProjects[id].map((p) => ({ ...p, exists: directoryExists(p.path) }))
}

export function removeRecentProjectAndList(id: CliId, path: string): RecentProjectInfo[] {
  removeRecentProject(id, path)
  return listRecentProjects(id)
}

/** Existence check for arbitrary directories the renderer only knows from
 * CLI session history (it has no fs access of its own). */
export function checkDirectoriesExist(paths: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (!Array.isArray(paths)) return out
  for (const path of paths.slice(0, MAX_EXISTS_CHECKS)) {
    if (typeof path !== 'string' || !path.trim()) continue
    out[path] = directoryExists(path)
  }
  return out
}

/** Native folder picker; a confirmed pick is recorded as a recent project. */
export async function selectProjectDirectory(
  sender: WebContents,
  id: CliId
): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(sender)
  const options = {
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  const path = result.canceled ? undefined : result.filePaths[0]
  if (!path) return null
  addRecentProject(id, path)
  return path
}
