import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { CliId, SessionInfo } from '@shared/types'

interface SessionsWorkerOk {
  ok: true
  result: SessionInfo[]
}

interface SessionsWorkerError {
  ok: false
  error: string
}

type SessionsWorkerMessage = SessionsWorkerOk | SessionsWorkerError

interface ActiveSessionsTask {
  worker: Worker
  resolve: (result: SessionInfo[] | null) => void
  settled: boolean
}

const active = new Map<string, ActiveSessionsTask>()

// Load the worker source once. In a packaged app the worker script lives
// inside the asar archive, but node:worker_threads cannot spawn a Worker from
// an asar path (it needs a real filesystem entry). Evaluating the source as a
// string keeps the non-blocking benefit of a worker while avoiding the asar
// path problem. Inside an eval worker, relative require() paths resolve from
// '/[worker eval]' and bare imports do not inherit the main module's search
// paths, so we prepend the main module's module.paths and rewrite bundled
// chunk imports to absolute paths based on the main-process __dirname.
const mainModulePaths = require.resolve.paths('sql.js') ?? []
const workerCode = [
  `module.paths.push(${mainModulePaths.map((p) => JSON.stringify(p)).join(', ')})`,
  readFileSync(join(__dirname, 'sessions-worker.js'), 'utf8').replace(
    /require\(["']\.\/chunks\/([^"']+)["']\)/g,
    (_, chunk) => `require(${JSON.stringify(join(__dirname, 'chunks', chunk))})`
  )
].join(';\n')

export function listSessionsInWorker(
  requestId: string,
  cliId: CliId
): Promise<SessionInfo[] | null> {
  const safeRequestId = requestId.trim()
  if (!safeRequestId) return Promise.reject(new Error('Missing sessions request id'))
  cancelSessionList(safeRequestId)

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { cliId }
    })
    const task: ActiveSessionsTask = { worker, resolve, settled: false }
    active.set(safeRequestId, task)

    const settle = (fn: () => void) => {
      if (task.settled) return
      task.settled = true
      active.delete(safeRequestId)
      fn()
    }

    worker.once('message', (message: SessionsWorkerMessage) => {
      if (message?.ok) {
        settle(() => resolve(message.result))
      } else {
        settle(() => reject(new Error(message?.error || 'Sessions scan failed')))
      }
    })

    worker.once('error', (error) => {
      settle(() => reject(error))
    })

    worker.once('exit', (code) => {
      if (task.settled) return
      settle(() => {
        if (code === 0) resolve(null)
        else reject(new Error(`Sessions worker exited with code ${code}`))
      })
    })
  })
}

export function cancelSessionList(requestId: string): boolean {
  const task = active.get(requestId)
  if (!task) return false
  task.settled = true
  active.delete(requestId)
  void task.worker.terminate()
  task.resolve(null)
  return true
}

export function cancelAllSessionLists(): void {
  for (const requestId of [...active.keys()]) {
    cancelSessionList(requestId)
  }
}
