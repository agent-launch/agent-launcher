import { existsSync, readFileSync } from 'node:fs'
import initSqlJs, { type SqlJsStatic } from 'sql.js'

/** Lazily initialized sql.js runtime, shared by every SQLite reader. */
let sqlPromise: Promise<SqlJsStatic> | null = null
export function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
  return sqlPromise
}

function sqliteMainPageSize(data: Buffer): number | null {
  if (data.length < 100) return null
  const raw = data.readUInt16BE(16)
  const size = raw === 1 ? 65536 : raw
  return size >= 512 && size <= 65536 && (size & (size - 1)) === 0 ? size : null
}

function sqliteWalPageSize(main: Buffer, wal: Buffer): number | null {
  const raw = wal.length >= 12 ? wal.readUInt32BE(8) : 0
  if (raw >= 512 && raw <= 65536 && (raw & (raw - 1)) === 0) return raw
  return sqliteMainPageSize(main)
}

/**
 * Read a SQLite database into memory, merging any committed WAL frames.
 * sql.js only reads a byte snapshot, so a live DB in WAL mode (as the CLIs
 * keep theirs) would otherwise show stale data. Falls back to the main file
 * on any WAL parse problem.
 */
export function readSqliteSnapshot(dbPath: string): Buffer {
  const main = Buffer.from(readFileSync(dbPath))
  const walPath = `${dbPath}-wal`
  if (!existsSync(walPath)) return main
  try {
    const wal = readFileSync(walPath)
    if (wal.length < 32) return main
    const magic = wal.readUInt32BE(0)
    if (magic !== 0x377f0682 && magic !== 0x377f0683) return main
    const pageSize = sqliteWalPageSize(main, wal)
    if (!pageSize) return main
    const salt1 = wal.readUInt32BE(16)
    const salt2 = wal.readUInt32BE(20)
    const frameSize = 24 + pageSize
    const frames: Array<{ pageNo: number; dataOffset: number }> = []
    let committedFrameCount = 0
    let committedPageCount = Math.max(1, Math.ceil(main.length / pageSize))
    for (let offset = 32; offset + frameSize <= wal.length; offset += frameSize) {
      const pageNo = wal.readUInt32BE(offset)
      const pageCount = wal.readUInt32BE(offset + 4)
      if (wal.readUInt32BE(offset + 8) !== salt1 || wal.readUInt32BE(offset + 12) !== salt2) break
      if (pageNo < 1) break
      frames.push({ pageNo, dataOffset: offset + 24 })
      if (pageCount > 0) {
        committedFrameCount = frames.length
        committedPageCount = pageCount
      }
    }
    if (!committedFrameCount) return main
    const out = Buffer.alloc(committedPageCount * pageSize)
    main.copy(out, 0, 0, Math.min(main.length, out.length))
    for (const frame of frames.slice(0, committedFrameCount)) {
      const dest = (frame.pageNo - 1) * pageSize
      if (dest < 0 || dest + pageSize > out.length) continue
      wal.copy(out, dest, frame.dataOffset, frame.dataOffset + pageSize)
    }
    if (out.length >= 32) out.writeUInt32BE(committedPageCount, 28)
    return out
  } catch {
    return main
  }
}
