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

export function listSessionsInWorker(
  requestId: string,
  cliId: CliId
): Promise<SessionInfo[] | null> {
  const safeRequestId = requestId.trim()
  if (!safeRequestId) return Promise.reject(new Error('Missing sessions request id'))
  cancelSessionList(safeRequestId)

  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'sessions-worker.js'), {
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
