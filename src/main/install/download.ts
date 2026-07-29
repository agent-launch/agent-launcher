import { get } from 'node:https'

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
