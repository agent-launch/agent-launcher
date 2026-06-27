import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { UsageScanResult } from '@shared/types'

interface UsageWorkerOk {
  ok: true
  result: UsageScanResult
}

interface UsageWorkerError {
  ok: false
  error: string
}

type UsageWorkerMessage = UsageWorkerOk | UsageWorkerError

interface ActiveUsageTask {
  worker: Worker
  resolve: (result: UsageScanResult | null) => void
  settled: boolean
}

const active = new Map<string, ActiveUsageTask>()

export function readUsageInWorker(requestId: string, rangeDays = 365, summaryDays = 30): Promise<UsageScanResult | null> {
  const safeRequestId = requestId.trim()
  if (!safeRequestId) return Promise.reject(new Error('Missing usage request id'))
  cancelUsageRead(safeRequestId)

  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'usage-worker.js'), {
      workerData: { rangeDays, summaryDays }
    })
    const task: ActiveUsageTask = { worker, resolve, settled: false }
    active.set(safeRequestId, task)

    const settle = (fn: () => void) => {
      if (task.settled) return
      task.settled = true
      active.delete(safeRequestId)
      fn()
    }

    worker.once('message', (message: UsageWorkerMessage) => {
      if (message?.ok) {
        settle(() => resolve(message.result))
      } else {
        settle(() => reject(new Error(message?.error || 'Usage scan failed')))
      }
    })

    worker.once('error', (error) => {
      settle(() => reject(error))
    })

    worker.once('exit', (code) => {
      if (task.settled) return
      settle(() => {
        if (code === 0) resolve(null)
        else reject(new Error(`Usage worker exited with code ${code}`))
      })
    })
  })
}

export function cancelUsageRead(requestId: string): boolean {
  const task = active.get(requestId)
  if (!task) return false
  task.settled = true
  active.delete(requestId)
  void task.worker.terminate()
  task.resolve(null)
  return true
}

export function cancelAllUsageReads(): void {
  for (const requestId of [...active.keys()]) {
    cancelUsageRead(requestId)
  }
}
