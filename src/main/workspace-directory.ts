import { statSync } from 'node:fs'
import { resolve } from 'node:path'

export function resolveProjectDirectory(candidate?: string): string | null {
  const requested = candidate?.trim()
  if (!requested) return null

  const absolute = resolve(requested)
  try {
    return statSync(absolute).isDirectory() ? absolute : null
  } catch {
    return null
  }
}
