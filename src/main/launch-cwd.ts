import { statSync } from 'node:fs'
import { homedir } from 'node:os'

export function resolveLaunchCwd(cwd?: string): string {
  const requested = cwd?.trim()
  if (!requested) return homedir()

  try {
    if (statSync(requested).isDirectory()) return requested
  } catch {
    /* Session history can point at deleted temp/project directories. */
  }

  return homedir()
}
