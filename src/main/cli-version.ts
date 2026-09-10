import { statSync } from 'node:fs'
import { decodeProcessOutput, spawnProcess } from './process'

const VERSION_PATTERN = /(?:^|\D)(\d+\.\d+\.\d+)(?:\D|$)/
const VERSION_OUTPUT_LIMIT = 16 * 1024
const versionProbeCache = new Map<string, Promise<string | undefined>>()

export function parseCliVersion(output: string): string | undefined {
  return output.match(VERSION_PATTERN)?.[1]
}

function executableStamp(binPath: string): string {
  try {
    const stat = statSync(binPath)
    return `${binPath}\0${stat.size}\0${stat.mtimeMs}`
  } catch {
    return binPath
  }
}

/** Probe the executable that will actually be launched instead of trusting persisted install metadata. */
export function probeCliVersion(binPath: string, timeoutMs = 3000): Promise<string | undefined> {
  const key = executableStamp(binPath)
  const cached = versionProbeCache.get(key)
  if (cached) return cached

  const probe = new Promise<string | undefined>((resolve) => {
    let output = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const finish = (version?: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(version)
    }

    try {
      const child = spawnProcess(binPath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      const append = (chunk: Buffer | string) => {
        if (output.length < VERSION_OUTPUT_LIMIT) {
          output = (output + decodeProcessOutput(chunk)).slice(0, VERSION_OUTPUT_LIMIT)
        }
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      child.on('error', () => finish())
      child.on('close', (code) => finish(code === 0 ? parseCliVersion(output) : undefined))
      timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* process already exited */
        }
        finish()
      }, timeoutMs)
    } catch {
      finish()
    }
  })

  versionProbeCache.set(key, probe)
  return probe
}
