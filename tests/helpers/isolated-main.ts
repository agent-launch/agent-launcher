import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { vi } from 'vitest'

export async function withIsolatedHome<T>(
  run: (ctx: { home: string }) => Promise<T> | T
): Promise<T> {
  // On Windows os.tmpdir() can return a short 8.3 path (e.g. RUNNER~1). That
  // breaks any test that round-trips a path through a flattened/sanitized name
  // and then walks the filesystem by name. realpathSync resolves the long name.
  const tmpRoot = process.platform === 'win32' ? realpathSync(tmpdir()) : tmpdir()
  const home = mkdtempSync(join(tmpRoot, 'agent-launcher-test-'))
  const isolatedEnv = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    HERMES_HOME: join(home, '.hermes'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    USERPROFILE: home
  }
  const previousEnv = Object.fromEntries(
    Object.keys(isolatedEnv).map((key) => [key, process.env[key]])
  )
  Object.assign(process.env, isolatedEnv)
  vi.resetModules()
  vi.doMock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>()
    return { ...actual, homedir: () => home }
  })

  try {
    return await run({ home })
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    vi.doUnmock('node:os')
    vi.resetModules()
    rmSync(home, { recursive: true, force: true })
  }
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function readJson<T = any>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

export function writeJsonl(path: string, records: unknown[]): void {
  writeText(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
}

export function createMemoryStorage() {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key: string) {
      return data.get(key) ?? null
    },
    key(index: number) {
      return [...data.keys()][index] ?? null
    },
    removeItem(key: string) {
      data.delete(key)
    },
    setItem(key: string, value: string) {
      data.set(key, value)
    }
  }
}
