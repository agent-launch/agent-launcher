import { createWriteStream, createReadStream, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { get } from 'node:https'
import { pipeline } from 'node:stream/promises'

/** GET a URL into memory as a string (small JSON metadata). */
export function fetchText(url: string, redirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'user-agent': 'AgentLauncher' } }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        if (redirects <= 0) return reject(new Error('Too many redirects'))
        res.resume()
        return resolve(fetchText(new URL(res.headers.location, url).toString(), redirects - 1))
      }
      if (status !== 200) {
        res.resume()
        return reject(new Error(`GET ${url} -> ${status}`))
      }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

export async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T
}

/** Download a URL to a file, following redirects, reporting progress. */
export function downloadFile(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number) => void,
  redirects = 5
): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'user-agent': 'AgentLauncher' } }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        if (redirects <= 0) return reject(new Error('Too many redirects'))
        res.resume()
        return resolve(
          downloadFile(new URL(res.headers.location, url).toString(), dest, onProgress, redirects - 1)
        )
      }
      if (status !== 200) {
        res.resume()
        return reject(new Error(`GET ${url} -> ${status}`))
      }
      const total = Number(res.headers['content-length'] ?? 0)
      let received = 0
      if (onProgress) {
        res.on('data', (c: Buffer) => {
          received += c.length
          onProgress(received, total)
        })
      }
      pipeline(res, createWriteStream(dest)).then(resolve).catch(reject)
    }).on('error', reject)
  })
}

export function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('error', reject)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

function fileHash(file: string, algorithm: string, encoding: 'hex' | 'base64'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm)
    createReadStream(file)
      .on('error', reject)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest(encoding)))
  })
}

/** Verify an npm-style Subresource Integrity string such as `sha512-...`. */
export async function verifyIntegrity(file: string, integrity?: string): Promise<void> {
  if (!integrity) return
  const match = integrity.match(/^(sha256|sha384|sha512)-(.+)$/)
  if (!match) throw new Error(`Unsupported integrity format: ${integrity}`)
  const actual = await fileHash(file, match[1], 'base64')
  if (actual !== match[2]) throw new Error('Downloaded package integrity check failed')
}

/**
 * Extract an archive into destDir using the system `tar`.
 * bsdtar (mac/win10+) handles .zip too, and GNU tar handles .tar.gz everywhere.
 * `strip` removes leading path components (Node tarballs nest under node-v.../).
 */
export function extractArchive(archive: string, destDir: string, strip = 0): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  const args = ['-xf', archive, '-C', destDir]
  if (strip > 0) args.push(`--strip-components=${strip}`)
  return new Promise((resolve, reject) => {
    const p = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${err}`))
    )
  })
}
