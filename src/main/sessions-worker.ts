import { parentPort, workerData } from 'node:worker_threads'
import { listSessions } from './sessions-history'
import type { CliId } from '@shared/types'

const CLI_IDS = new Set<CliId>(['claude-code', 'codex', 'opencode', 'pi', 'hermes', 'gemini'])

async function main(): Promise<void> {
  if (!parentPort) throw new Error('Sessions worker requires a parent port')
  try {
    const cliId = workerData?.cliId
    if (!CLI_IDS.has(cliId)) throw new Error('Invalid CLI id')
    const result = await listSessions(cliId)
    parentPort.postMessage({ ok: true, result })
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

void main()
