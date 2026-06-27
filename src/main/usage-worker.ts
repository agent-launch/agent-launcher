import { parentPort, workerData } from 'node:worker_threads'
import { readUsage } from './usage'

async function main(): Promise<void> {
  if (!parentPort) throw new Error('Usage worker requires a parent port')
  try {
    const rangeDays = typeof workerData?.rangeDays === 'number' ? workerData.rangeDays : 365
    const summaryDays = typeof workerData?.summaryDays === 'number' ? workerData.summaryDays : 30
    const result = await readUsage(rangeDays, summaryDays)
    parentPort.postMessage({ ok: true, result })
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

void main()
