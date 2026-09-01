import { existsSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir, userInfo } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path'

const ENV_START = '__AGENT_LAUNCHER_ENV_START__'
const ENV_END = '__AGENT_LAUNCHER_ENV_END__'
const DEFAULT_TIMEOUT_MS = 5_000

let resolvedShellPath: string | undefined
let shellPathPromise: Promise<string | undefined> | undefined

function uniquePaths(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    if (!path) continue
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    if (seen.has(key)) continue
    seen.add(key)
    result.push(path)
  }
  return result
}

function versionedBinDirs(root: string, suffix: string[]): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
      .map((entry) => join(root, entry.name, ...suffix))
  } catch {
    return []
  }
}

/** Executable locations commonly omitted when a desktop app is opened from the GUI. */
export function knownExecutableDirs(): string[] {
  if (process.platform === 'win32') {
    return uniquePaths([
      process.env.APPDATA ? join(process.env.APPDATA, 'npm') : undefined,
      process.env.NVM_SYMLINK,
      process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs') : undefined,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'nodejs') : undefined,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Volta', 'bin') : undefined,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'pnpm') : undefined,
      join(homedir(), '.bun', 'bin')
    ])
  }

  return uniquePaths([
    join(homedir(), '.local', 'bin'),
    join(homedir(), 'local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    ...versionedBinDirs(join(homedir(), '.nvm', 'versions', 'node'), ['bin']),
    ...versionedBinDirs(join(homedir(), '.local', 'share', 'fnm', 'node-versions'), [
      'installation',
      'bin'
    ]),
    ...versionedBinDirs(join(homedir(), 'Library', 'Application Support', 'fnm', 'node-versions'), [
      'installation',
      'bin'
    ]),
    ...versionedBinDirs(join(homedir(), '.local', 'share', 'mise', 'installs', 'node'), ['bin']),
    join(homedir(), '.local', 'share', 'mise', 'shims'),
    join(homedir(), '.asdf', 'shims'),
    join(homedir(), '.nodenv', 'shims'),
    join(homedir(), '.nodebrew', 'current', 'bin'),
    join(homedir(), '.volta', 'bin'),
    join(homedir(), '.bun', 'bin'),
    process.env.PNPM_HOME,
    join(homedir(), 'Library', 'pnpm'),
    join(homedir(), '.local', 'share', 'pnpm')
  ])
}

function parseShellPath(output: string): string | undefined {
  const start = output.lastIndexOf(ENV_START)
  const end = output.indexOf(ENV_END, start + ENV_START.length)
  if (start < 0 || end < 0) return undefined
  const block = output.slice(start + ENV_START.length, end)
  const match = block.match(/(?:^|\n)PATH=([^\r\n]*)/u)
  return match?.[1]?.trim() || undefined
}

function shellArgs(shell: string): string[] {
  const name = basename(shell).toLowerCase()
  const command = `printf '${ENV_START}\\n'; command env; printf '${ENV_END}\\n'; exit`
  if (name === 'tcsh' || name === 'csh') return ['-ic', command]
  return ['-ilc', command]
}

function readShellPath(shell: string, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const finish = (path?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(path)
    }
    const child = spawn(shell, shellArgs(shell), {
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        DISABLE_AUTO_UPDATE: 'true',
        ZSH_TMUX_AUTOSTARTED: 'true',
        ZSH_TMUX_AUTOSTART: 'false'
      },
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const append = (chunk: Buffer): void => {
      output = `${output}${chunk.toString('utf8')}`.slice(-128_000)
    }
    child.stdout.on('data', append)
    child.on('error', () => finish())
    child.on('close', () => finish(parseShellPath(output)))
    const timer = setTimeout(() => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
      finish()
    }, timeoutMs)
  })
}

/**
 * Cache the PATH produced by the user's login shell. Finder/desktop launches do
 * not inherit shell startup files, so nvm/fnm/mise and custom user bins would
 * otherwise be invisible. Failure is non-fatal; known paths remain available.
 */
export function initializeSystemPath(
  options: { shell?: string; timeoutMs?: number } = {}
): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(process.env.PATH)
  if (shellPathPromise) return shellPathPromise

  shellPathPromise = (async () => {
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    let accountShell: string | undefined
    try {
      accountShell = userInfo().shell ?? undefined
    } catch {
      /* account lookup is unavailable */
    }
    const shells = uniquePaths([
      options.shell ?? process.env.SHELL ?? accountShell,
      '/bin/zsh',
      '/bin/bash'
    ]).filter((shell) => isAbsolute(shell) && existsSync(shell))
    for (const shell of shells) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      const path = await readShellPath(shell, remaining)
      if (path) {
        resolvedShellPath = path
        return path
      }
    }
    return undefined
  })()
  return shellPathPromise
}

export function resolvedPathDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return uniquePaths([
    ...(resolvedShellPath ?? '').split(delimiter),
    ...(env.PATH ?? '').split(delimiter),
    ...knownExecutableDirs()
  ])
}

/** Build a child-process environment with a complete, de-duplicated PATH. */
export function buildSystemEnv(
  env: NodeJS.ProcessEnv = process.env,
  preferredDirs: Array<string | undefined> = []
): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: uniquePaths([...preferredDirs, ...resolvedPathDirs(env)]).join(delimiter)
  }
}

/** Put an absolute command's directory first so its companion runtime is found. */
export function envForCommand(
  commandPath: string,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const commandDir =
    isAbsolute(commandPath) || commandPath.includes('/') || commandPath.includes('\\')
      ? dirname(commandPath)
      : undefined
  return buildSystemEnv(env, [commandDir])
}
