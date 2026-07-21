import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { paths, bundledNodeBin, bundledNpmCli } from '../sandbox'
import { detectPlatform, nodeDistName } from './platform'
import { fetchText, downloadFile, sha256, extractArchive } from './download'

const DIST = 'https://nodejs.org/dist'

interface NodeIndexEntry {
  version: string // e.g. "v22.14.0"
  lts: string | false
}

/** Pick the latest LTS line >= v20 (satisfies all three CLIs' engines). */
async function latestLtsVersion(): Promise<string> {
  const index = JSON.parse(await fetchText(`${DIST}/index.json`)) as NodeIndexEntry[]
  const lts = index
    .filter((e) => e.lts !== false)
    .map((e) => e.version.replace(/^v/, ''))
    .filter((v) => Number(v.split('.')[0]) >= 20)
  if (!lts.length) throw new Error('No suitable Node LTS found')
  // index.json is newest-first.
  return lts[0]
}

export function isNodeInstalled(): boolean {
  return existsSync(bundledNodeBin()) && existsSync(bundledNpmCli())
}

export interface NodeRuntime {
  nodeBin: string
  npmCli: string
  version: string
}

/**
 * Legacy managed-install helper: ensure a portable Node + npm is present. Downloads the
 * official build, verifies its SHA256 against SHASUMS256.txt, extracts it.
 */
export async function ensureNode(
  onProgress?: (msg: string, fraction?: number) => void
): Promise<NodeRuntime> {
  if (isNodeInstalled()) {
    return { nodeBin: bundledNodeBin(), npmCli: bundledNpmCli(), version: 'bundled' }
  }
  const p = detectPlatform()
  onProgress?.('Resolving Node version…')
  const version = await latestLtsVersion()
  const { file } = nodeDistName(p, version)
  const url = `${DIST}/v${version}/${file}`

  mkdirSync(paths.downloads, { recursive: true })
  const archive = join(paths.downloads, file)

  onProgress?.(`Downloading portable Node v${version}…`, 0)
  await downloadFile(url, archive, (recv, total) => {
    if (total) onProgress?.(`Downloading portable Node v${version}…`, recv / total)
  })

  onProgress?.('Verifying integrity…')
  const shasums = await fetchText(`${DIST}/v${version}/SHASUMS256.txt`)
  const expected = shasums
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .find(([, name]) => name === file)?.[0]
  if (!expected) throw new Error(`No SHA256 entry for ${file}`)
  const actual = await sha256(archive)
  if (actual !== expected) throw new Error(`Node checksum mismatch for ${file}`)

  onProgress?.('Extracting Node…')
  if (existsSync(paths.node)) rmSync(paths.node, { recursive: true, force: true })
  // Node archives nest under node-v.../ — strip that one level.
  await extractArchive(archive, paths.node, 1)
  rmSync(archive, { force: true })

  if (!isNodeInstalled()) throw new Error('Node extracted but binary/npm not found')
  return { nodeBin: bundledNodeBin(), npmCli: bundledNpmCli(), version }
}
