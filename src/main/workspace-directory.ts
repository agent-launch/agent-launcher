import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export function resolveProjectDirectory(candidate?: string): string | null {
  const requested = candidate?.trim()
  if (!requested) return null
  // Relative input would resolve against the main-process cwd ("/" in a
  // packaged app), which is never what the renderer means.
  if (!isAbsolute(requested)) return null

  const absolute = resolve(requested)
  try {
    return statSync(absolute).isDirectory() ? absolute : null
  } catch {
    return null
  }
}
