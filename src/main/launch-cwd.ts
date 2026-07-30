import { mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliId } from '@shared/types'
import { paths } from './sandbox'

/**
 * Per-CLI scratch workspace used whenever no project directory is chosen.
 *
 * Never fall back to the home directory for real work: macOS attributes a
 * child process's file access to its responsible process (this app), so an
 * agent scanning `~` triggers a cascade of TCC prompts for Desktop,
 * Documents, Downloads, Reminders, Calendars and friends in Agent Launcher's
 * name. A dedicated workspace under the state root contains no such paths.
 */
export function defaultWorkspaceForCli(cliId: CliId): string {
  const candidates = [
    join(paths.root, 'workspaces', cliId),
    join(tmpdir(), 'agent-launcher-workspaces', cliId)
  ]
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true })
      if (statSync(dir).isDirectory()) return dir
    } catch {
      /* Try the next non-sensitive location. */
    }
  }
  return tmpdir()
}

export function resolveLaunchCwd(cliId: CliId, cwd?: string): string {
  const requested = cwd?.trim()
  if (!requested) return defaultWorkspaceForCli(cliId)

  try {
    if (statSync(requested).isDirectory()) return requested
  } catch {
    /* Session history can point at deleted temp/project directories. */
  }

  return defaultWorkspaceForCli(cliId)
}
