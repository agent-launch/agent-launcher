import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { vi } from 'vitest'

export async function withIsolatedHome<T>(run: (ctx: { home: string }) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), 'agent-launcher-test-'))
  vi.resetModules()
  vi.doMock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>()
    return { ...actual, homedir: () => home }
  })

  try {
    return await run({ home })
  } finally {
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
