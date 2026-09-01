import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { cliStateRoots } from './config-paths'

/**
 * Recovering the project directory behind a gemini-cli history bucket.
 *
 * gemini-cli buckets per-project state under `<state>/tmp/<identifier>/`, and
 * has used two identifier schemes:
 *
 *  - **slug** (current): a ProjectRegistry-assigned name like `port-scan-1`.
 *    The absolute path is stored verbatim in `<bucket>/.project_root`, and
 *    mirrored in `<state>/projects.json` as `{ projects: { <path>: <slug> } }`.
 *  - **hash** (legacy): `sha256(<absolute project path>)` in hex. One-way, so
 *    the path can only be recovered by hashing candidate paths and comparing.
 *
 * Newer gemini-cli migrates hash buckets to slug buckets on startup, so hash
 * buckets only linger for state written before that release (or when the
 * migration did not complete). For those we hash candidate paths gathered from
 * other on-disk sources. Candidates are *guesses*, but a candidate is only
 * accepted on an exact hash match, so a wrong guess can never mislabel a
 * session — it just fails to match and the bucket stays unassociated.
 */

const HEX64 = /^[0-9a-f]{64}$/

/** Bounds the existence-guided decode below; deep enough for any real repo. */
const MAX_DECODE_DEPTH = 12

export interface GeminiProjectResolver {
  /** Absolute project path for a `<state>/tmp/<identifier>` bucket, if known. */
  resolve(bucketDir: string, identifier: string): string | undefined
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** `<state>/projects.json` → `{ projects: { <absolute path>: <slug> } }`. */
function readRegistry(stateRoot: string): Map<string, string> {
  const bySlug = new Map<string, string>()
  const file = join(stateRoot, 'projects.json')
  if (!existsSync(file)) return bySlug
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const projects = (parsed as { projects?: unknown } | null)?.projects
    if (!projects || typeof projects !== 'object') return bySlug
    for (const [path, slug] of Object.entries(projects as Record<string, unknown>)) {
      if (typeof slug === 'string' && slug && path) bySlug.set(slug, path)
    }
  } catch {
    /* A half-written or hand-edited registry just yields no slugs. */
  }
  return bySlug
}

/**
 * Claude Code names its history dirs `<projects>/<cwd with every separator and
 * punctuation flattened to "-">`, which is lossy: `-` from a real `-`, `_`, `.`
 * or `/` are indistinguishable. Rather than guess, walk the actual filesystem
 * and only descend into directories whose own flattened name matches the next
 * chunk of the encoded string. Returns every path that survives the walk, since
 * more than one can legitimately match.
 *
 * On Windows the encoded string starts with a drive letter (e.g. `-C-Users-...`),
 * so we enumerate drive roots instead of starting from a single filesystem root.
 */
function decodeFlattenedPath(encoded: string): string[] {
  if (!encoded.startsWith('-')) return []
  const out: string[] = []
  const walk = (dir: string, rest: string, depth: number): void => {
    if (!rest) {
      out.push(dir)
      return
    }
    if (depth > MAX_DECODE_DEPTH || out.length > 8) return
    let entries: string[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        // Symlinks count: on macOS `/var`, `/tmp` and plenty of user setups are
        // links to real directories, and a Dirent for a link is not isDirectory().
        .filter((e) => e.isDirectory() || e.isSymbolicLink())
        .map((e) => e.name)
    } catch {
      return
    }
    for (const name of entries) {
      const flat = name.replace(/[^A-Za-z0-9]/g, '-')
      if (rest === flat) out.push(join(dir, name))
      else if (rest.startsWith(`${flat}-`))
        walk(join(dir, name), rest.slice(flat.length + 1), depth + 1)
    }
  }

  if (process.platform === 'win32') {
    // Windows: encoded like `-C-Users-xiadd-...`; try every drive letter root.
    // readdirSync on a non-existent drive letter throws ENOENT; we swallow it.
    const rest = encoded.slice(1)
    for (const drive of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${drive}:\\`
      const flat = drive
      if (rest === flat) out.push(root)
      else if (rest.startsWith(`${flat}-`)) walk(root, rest.slice(2), 0)
    }
  } else {
    walk(sep, encoded.slice(1), 0)
  }
  return out
}

/**
 * Directories the user is known to work in, for legacy hash matching.
 *
 * Seeded from the gemini registry and from Claude Code's history dir names,
 * then widened to the siblings of every seed: people keep their repos side by
 * side, so a project gemini saw is very often a sibling of one Claude saw.
 * Widening is safe because candidates are hash-verified, never trusted.
 */
function candidateProjectPaths(registryPaths: Iterable<string>): string[] {
  const seeds = new Set<string>()
  for (const path of registryPaths) seeds.add(resolve(path))
  for (const root of cliStateRoots('claude-code')) {
    const projects = join(root, 'projects')
    if (!existsSync(projects)) continue
    let names: string[]
    try {
      names = readdirSync(projects)
    } catch {
      continue
    }
    for (const name of names) {
      for (const decoded of decodeFlattenedPath(name)) seeds.add(decoded)
    }
  }

  const out = new Set(seeds)
  const scanned = new Set<string>()
  for (const seed of seeds) {
    const parent = dirname(seed)
    if (parent === seed || scanned.has(parent)) continue
    scanned.add(parent)
    try {
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory() || entry.isSymbolicLink()) out.add(join(parent, entry.name))
      }
    } catch {
      /* Unreadable parent just contributes no siblings. */
    }
  }
  return [...out]
}

/**
 * Builds a resolver over one gemini state root. Registry and candidate lookups
 * are done once per listing, not once per bucket; the expensive candidate scan
 * is deferred until a legacy hash bucket is actually seen.
 */
export function geminiProjectResolver(stateRoot: string): GeminiProjectResolver {
  const bySlug = readRegistry(stateRoot)
  let byHash: Map<string, string> | undefined

  const hashIndex = (): Map<string, string> => {
    if (byHash) return byHash
    byHash = new Map()
    for (const path of candidateProjectPaths(bySlug.values())) byHash.set(sha256(path), path)
    return byHash
  }

  return {
    resolve(bucketDir, identifier) {
      try {
        const marker = readFileSync(join(bucketDir, '.project_root'), 'utf8').trim()
        if (marker) return marker
      } catch {
        /* Pre-registry buckets have no marker; fall through. */
      }
      const fromRegistry = bySlug.get(identifier)
      if (fromRegistry) return fromRegistry
      if (HEX64.test(identifier)) return hashIndex().get(identifier)
      return undefined
    }
  }
}

export const __testing = { decodeFlattenedPath }
