import { get, request } from 'node:https'

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

/** Is the host serving this URL reachable at all? Any HTTP response counts —
 * only the network path is being tested, not the resource.
 *
 * An official installer script piped into a shell can hang for minutes when the
 * host is blackholed rather than refused (claude.ai from mainland China). This
 * probe lets a caller pick a fallback install path in seconds instead. */
export function isReachable(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const req = request(
      url,
      { method: 'HEAD', headers: { 'user-agent': 'AgentLauncher' } },
      (res) => {
        res.resume()
        finish(true)
      }
    )
    req.on('error', () => finish(false))
    const timer = setTimeout(() => {
      req.destroy()
      finish(false)
    }, timeoutMs)
    req.end()
  })
}
