import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { cliStateRoots, geminiUsageLogPath, hermesHomeDir } from './config-paths'
import { getSql, readSqliteSnapshot } from './sqlite'
import { listSessions } from './sessions-history'
import { loadConfig } from './store'
import type {
  CliId,
  CliPriceEntry,
  UsageCliSummary,
  UsageCostTotals,
  UsageDailyBucket,
  UsageModelBreakdown,
  UsageScanResult,
  UsageTokenTotals
} from '@shared/types'

interface UsageEntry {
  cliId: CliId
  sessionId?: string
  model: string
  ts: number
  requestCount?: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cost?: number
}

interface ClaudeUsageCandidate extends UsageEntry {
  messageId: string
  stopReason?: string
}

const CLI_IDS: CliId[] = ['claude-code', 'codex', 'opencode', 'pi', 'hermes', 'gemini']
const ZERO_TOKENS: UsageTokenTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 0
}
const ZERO_COST: UsageCostTotals = {
  inputCost: 0,
  outputCost: 0,
  cacheReadCost: 0,
  cacheCreationCost: 0,
  totalCost: 0
}

function opencodeDbPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'opencode', 'opencode.db')
}

function hermesDbPath(): string {
  return join(hermesHomeDir(), 'state.db')
}

function isPathInside(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

function normalizeTs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return undefined
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value)
    if (Number.isFinite(asNumber) && asNumber > 0) return normalizeTs(asNumber)
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function readJsonLines(file: string): unknown[] {
  try {
    return readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter((value) => value !== null)
  } catch {
    return []
  }
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readNumber(record: Record<string, any> | null | undefined, keys: string[]): number {
  if (!record) return 0
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const n = Number(value)
      if (Number.isFinite(n)) return n
    }
  }
  return 0
}

function normalizeModel(model: unknown): string {
  if (typeof model !== 'string' || !model.trim()) return 'unknown'
  let out = model.trim().toLowerCase()
  const slash = out.lastIndexOf('/')
  if (slash >= 0) out = out.slice(slash + 1)
  out = out.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '')
  return out || 'unknown'
}

function tokensOf(entry: UsageEntry): UsageTokenTotals {
  const rawInputTokens = Math.max(0, Math.round(entry.inputTokens))
  const outputTokens = Math.max(0, Math.round(entry.outputTokens))
  const cacheReadTokens = Math.max(0, Math.round(entry.cacheReadTokens))
  const cacheCreationTokens = Math.max(0, Math.round(entry.cacheCreationTokens))
  const inputTokens =
    entry.cliId === 'codex' ? Math.max(0, rawInputTokens - cacheReadTokens) : rawInputTokens
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  }
}

function addTokens(target: UsageTokenTotals, add: UsageTokenTotals): void {
  target.inputTokens += add.inputTokens
  target.outputTokens += add.outputTokens
  target.cacheReadTokens += add.cacheReadTokens
  target.cacheCreationTokens += add.cacheCreationTokens
  target.totalTokens += add.totalTokens
}

function addCost(target: UsageCostTotals, add: UsageCostTotals): void {
  target.inputCost += add.inputCost
  target.outputCost += add.outputCost
  target.cacheReadCost += add.cacheReadCost
  target.cacheCreationCost += add.cacheCreationCost
  target.totalCost += add.totalCost
}

function priceMatches(entry: CliPriceEntry, model: string): boolean {
  const priceModel = normalizeModel(entry.model || entry.name)
  return (
    priceModel === model ||
    Boolean(priceModel && model.includes(priceModel)) ||
    Boolean(model && priceModel.includes(model))
  )
}

function findPrice(cliId: CliId, model: string): CliPriceEntry | undefined {
  const prices = loadConfig().resources[cliId]?.prices ?? []
  return prices.find((entry) => priceMatches(entry, model))
}

function calculateCost(entry: UsageEntry): UsageCostTotals {
  if (typeof entry.cost === 'number' && Number.isFinite(entry.cost) && entry.cost > 0) {
    return { ...ZERO_COST, totalCost: entry.cost }
  }
  const price = findPrice(entry.cliId, entry.model)
  if (!price) return { ...ZERO_COST }

  const inputIncludesCacheRead = entry.cliId === 'codex'
  const billableInput = inputIncludesCacheRead
    ? Math.max(0, entry.inputTokens - entry.cacheReadTokens)
    : entry.inputTokens
  const inputCost = (billableInput * (price.inputPerMillion ?? 0)) / 1_000_000
  const outputCost = (entry.outputTokens * (price.outputPerMillion ?? 0)) / 1_000_000
  const cacheReadCost = (entry.cacheReadTokens * (price.cacheReadPerMillion ?? 0)) / 1_000_000
  const cacheCreationCost =
    (entry.cacheCreationTokens * (price.cacheWritePerMillion ?? 0)) / 1_000_000
  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheCreationCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheCreationCost
  }
}

function hasUsage(entry: UsageEntry): boolean {
  return (
    Boolean(entry.requestCount && entry.requestCount > 0) ||
    entry.inputTokens > 0 ||
    entry.outputTokens > 0 ||
    entry.cacheReadTokens > 0 ||
    entry.cacheCreationTokens > 0 ||
    Boolean(entry.cost && entry.cost > 0)
  )
}

function collectJsonlRecursive(dir: string, out: string[], maxDepth = 8, depth = 0): void {
  if (!existsSync(dir) || depth > maxDepth) return
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) collectJsonlRecursive(full, out, maxDepth, depth + 1)
      else if (entry.name.endsWith('.jsonl')) out.push(full)
    }
  } catch {
    /* ignore unreadable dirs */
  }
}

function newestFilesByKey(files: string[], keyFor: (file: string) => string): string[] {
  const selected = new Map<string, { file: string; mtimeMs: number }>()
  for (const file of files) {
    let mtimeMs: number
    try {
      mtimeMs = statSync(file).mtimeMs
    } catch {
      continue
    }
    const key = keyFor(file)
    const existing = selected.get(key)
    if (!existing || mtimeMs > existing.mtimeMs) selected.set(key, { file, mtimeMs })
  }
  return [...selected.values()].map((entry) => entry.file)
}

function collectClaudeUsage(): UsageEntry[] {
  const roots = cliStateRoots('claude-code').map((root) => join(root, 'projects'))
  const files: string[] = []
  for (const root of roots) {
    collectJsonlRecursive(root, files)
  }
  const entries: UsageEntry[] = []
  // Key by the last two path segments (encoded-cwd / session-id) so unrelated
  // sessions in different project dirs are not deduplicated, while exact
  // migrated duplicates across standard/legacy roots are still collapsed.
  for (const file of newestFilesByKey(files, (value) => {
    const normalized = value.replace(/\\/g, '/').replace(/\.jsonl$/, '')
    return normalized.split('/').filter(Boolean).slice(-2).join('/')
  })) {
    let sessionId = file
      .replace(/\.jsonl$/, '')
      .split(/[\\/]/)
      .pop()
    const messages = new Map<string, ClaudeUsageCandidate>()
    let index = 0
    for (const raw of readJsonLines(file)) {
      index += 1
      const record = asRecord(raw)
      if (typeof record?.sessionId === 'string' && record.sessionId.trim())
        sessionId = record.sessionId
      const message = asRecord(record?.message)
      const usage = asRecord(message?.usage)
      if (!record || record.type !== 'assistant' || !message || !usage) continue
      const messageId =
        typeof message.id === 'string' && message.id.trim() ? message.id : `${file}:${index}`
      const entry: ClaudeUsageCandidate = {
        cliId: 'claude-code',
        sessionId,
        messageId,
        stopReason: typeof message.stop_reason === 'string' ? message.stop_reason : undefined,
        model: normalizeModel(message.model),
        ts:
          normalizeTs(record.timestamp ?? record.createdAt ?? record.created_at) ??
          statSync(file).mtimeMs,
        inputTokens: readNumber(usage, ['input_tokens', 'inputTokens']),
        outputTokens: readNumber(usage, ['output_tokens', 'outputTokens']),
        cacheReadTokens: readNumber(usage, ['cache_read_input_tokens', 'cacheReadInputTokens']),
        cacheCreationTokens: readNumber(usage, [
          'cache_creation_input_tokens',
          'cacheCreationInputTokens'
        ])
      }
      if (!hasUsage(entry)) continue
      const existing = messages.get(messageId)
      const sameStopState = Boolean(entry.stopReason) === Boolean(existing?.stopReason)
      const shouldReplace =
        !existing ||
        (Boolean(entry.stopReason) && !existing?.stopReason) ||
        (sameStopState && entry.outputTokens >= existing.outputTokens)
      if (shouldReplace) messages.set(messageId, entry)
    }
    entries.push(
      ...[...messages.values()].map(
        ({ messageId: _messageId, stopReason: _stopReason, ...entry }) => entry
      )
    )
  }
  return entries
}

interface CodexCumulative {
  input: number
  cachedInput: number
  output: number
}

function parseCodexTokens(value: unknown): CodexCumulative | null {
  const usage = asRecord(value)
  if (!usage) return null
  return {
    input: readNumber(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens']),
    cachedInput: readNumber(usage, [
      'cached_input_tokens',
      'cache_read_input_tokens',
      'cachedTokens'
    ]),
    output: readNumber(usage, [
      'output_tokens',
      'outputTokens',
      'completion_tokens',
      'completionTokens'
    ])
  }
}

function codexDelta(prev: CodexCumulative | null, current: CodexCumulative): CodexCumulative {
  if (!prev) return current
  return {
    input: Math.max(0, current.input - prev.input),
    cachedInput: Math.max(0, current.cachedInput - prev.cachedInput),
    output: Math.max(0, current.output - prev.output)
  }
}

function collectCodexUsage(): UsageEntry[] {
  const roots = cliStateRoots('codex').map((root) => join(root, 'sessions'))
  const files: string[] = []
  for (const root of roots) {
    collectJsonlRecursive(root, files)
  }
  const entries: UsageEntry[] = []
  for (const file of newestFilesByKey(files, (value) => {
    const name = basename(value, '.jsonl')
    return (
      name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] ?? name
    )
  })) {
    let sessionId = file
      .replace(/\.jsonl$/, '')
      .split(/[\\/]/)
      .pop()
    let model = 'unknown'
    let prev: CodexCumulative | null = null
    let index = 0
    for (const raw of readJsonLines(file)) {
      const record = asRecord(raw)
      if (!record) continue
      const payload = asRecord(record.payload)
      if (record.type === 'session_meta') {
        const nextId = payload?.session_id ?? payload?.sessionId ?? payload?.id
        if (typeof nextId === 'string') sessionId = nextId
      }
      if (record.type === 'turn_context') {
        const info = asRecord(payload?.info)
        model = normalizeModel(payload?.model ?? info?.model ?? model)
      }
      if (record.type !== 'event_msg' || payload?.type !== 'token_count') continue
      const info = asRecord(payload.info)
      if (!info) continue
      model = normalizeModel(info.model ?? info.model_name ?? payload.model ?? model)
      const total = parseCodexTokens(info.total_token_usage)
      const last = parseCodexTokens(info.last_token_usage)
      const delta = total ? codexDelta(prev, total) : last
      if (total) prev = total
      if (!delta) continue
      index += 1
      const entry: UsageEntry = {
        cliId: 'codex',
        sessionId,
        model,
        ts: normalizeTs(record.timestamp ?? payload.timestamp) ?? statSync(file).mtimeMs + index,
        inputTokens: delta.input,
        outputTokens: delta.output,
        cacheReadTokens: Math.min(delta.cachedInput, delta.input),
        cacheCreationTokens: 0
      }
      if (hasUsage(entry)) entries.push(entry)
    }
  }
  return entries
}

function collectPiUsage(): UsageEntry[] {
  const roots = cliStateRoots('pi').map((root) => join(root, 'sessions'))
  const files: string[] = []
  for (const root of roots) {
    collectJsonlRecursive(root, files)
  }
  const entries: UsageEntry[] = []
  const selectedFiles = newestFilesByKey(files, (file) => {
    for (const raw of readJsonLines(file)) {
      const record = asRecord(raw)
      if (record?.type === 'session' && typeof record.id === 'string' && record.id.trim()) {
        return record.id.trim()
      }
    }
    return file
  })
  for (const file of selectedFiles) {
    if (!roots.some((root) => isPathInside(file, root))) continue
    let sessionId = file
    let model = 'unknown'
    for (const raw of readJsonLines(file)) {
      const record = asRecord(raw)
      if (!record) continue
      if (record.type === 'session' && typeof record.id === 'string') sessionId = record.id
      const message = asRecord(record.message) ?? record
      const usage =
        asRecord(message.usage) ??
        asRecord(message.tokens) ??
        asRecord(record.usage) ??
        asRecord(record.tokens)
      if (!usage) continue
      model = normalizeModel(message.model ?? message.modelID ?? record.model ?? model)
      const cache = asRecord(usage.cache)
      const entry: UsageEntry = {
        cliId: 'pi',
        sessionId,
        model,
        ts:
          normalizeTs(record.timestamp ?? record.createdAt ?? message.createdAt) ??
          statSync(file).mtimeMs,
        inputTokens: readNumber(usage, ['input_tokens', 'inputTokens', 'input', 'prompt_tokens']),
        outputTokens: readNumber(usage, [
          'output_tokens',
          'outputTokens',
          'output',
          'completion_tokens'
        ]),
        cacheReadTokens:
          readNumber(usage, ['cache_read_input_tokens', 'cacheReadTokens']) ||
          readNumber(cache, ['read']),
        cacheCreationTokens:
          readNumber(usage, ['cache_creation_input_tokens', 'cacheWriteTokens']) ||
          readNumber(cache, ['write']),
        cost: numberValue(message.cost ?? record.cost) || undefined
      }
      if (hasUsage(entry)) entries.push(entry)
    }
  }
  return entries
}

async function collectOpencodeUsage(): Promise<UsageEntry[]> {
  const dbPath = opencodeDbPath()
  if (!existsSync(dbPath)) return []
  const SQL = await getSql()
  const db = new SQL.Database(readSqliteSnapshot(dbPath))
  const entries: UsageEntry[] = []
  try {
    const res = db.exec(
      'SELECT id, session_id, data, time_created FROM message ORDER BY time_created'
    )
    if (!res.length) return []
    for (const row of res[0].values) {
      const [id, sessionId, data, timeCreated] = row as [string, string, string, number | string]
      let value: Record<string, any>
      try {
        value = JSON.parse(data)
      } catch {
        continue
      }
      if (value.role !== 'assistant' || !value.tokens) continue
      if (value.time && typeof value.time === 'object' && !value.time.completed) continue
      const tokens = asRecord(value.tokens)
      const cache = asRecord(tokens?.cache)
      const input = readNumber(tokens, ['input'])
      const output = readNumber(tokens, ['output']) + readNumber(tokens, ['reasoning'])
      const entry: UsageEntry = {
        cliId: 'opencode',
        sessionId: String(sessionId),
        model: normalizeModel(value.modelID ?? value.modelId ?? value.model),
        ts: normalizeTs(value.time?.created ?? timeCreated) ?? Date.now(),
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: readNumber(cache, ['read']),
        cacheCreationTokens: readNumber(cache, ['write']),
        cost: numberValue(value.cost) || undefined
      }
      if (hasUsage(entry)) entries.push({ ...entry, sessionId: entry.sessionId || String(id) })
    }
  } finally {
    db.close()
  }
  return entries
}

async function collectHermesUsage(): Promise<UsageEntry[]> {
  const dbPath = hermesDbPath()
  if (!existsSync(dbPath)) return []
  const SQL = await getSql()
  const db = new SQL.Database(readSqliteSnapshot(dbPath))
  const entries: UsageEntry[] = []
  try {
    const res = db.exec(
      [
        'SELECT',
        [
          'id',
          'model',
          'started_at',
          'ended_at',
          'input_tokens',
          'output_tokens',
          'cache_read_tokens',
          'cache_write_tokens',
          'reasoning_tokens',
          'api_call_count',
          'estimated_cost_usd',
          'actual_cost_usd'
        ].join(', '),
        'FROM sessions',
        'WHERE COALESCE(archived, 0) = 0'
      ].join(' ')
    )
    if (!res.length) return []
    for (const row of res[0].values) {
      const [
        id,
        model,
        startedAt,
        endedAt,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        reasoningTokens,
        apiCallCount,
        estimatedCost,
        actualCost
      ] = row as Array<string | number | null>
      const entry: UsageEntry = {
        cliId: 'hermes',
        sessionId: String(id),
        model: normalizeModel(model),
        ts: normalizeTs(endedAt) ?? normalizeTs(startedAt) ?? Date.now(),
        requestCount: Math.max(0, Math.round(numberValue(apiCallCount))),
        inputTokens: numberValue(inputTokens),
        outputTokens: numberValue(outputTokens) + numberValue(reasoningTokens),
        cacheReadTokens: numberValue(cacheReadTokens),
        cacheCreationTokens: numberValue(cacheWriteTokens),
        cost: numberValue(actualCost) || numberValue(estimatedCost) || undefined
      }
      if (hasUsage(entry)) entries.push(entry)
    }
  } finally {
    db.close()
  }
  return entries
}

/** Stateful scanner that splits gemini-cli's concatenated JSON telemetry file
 * into individual JSON objects. Each OTEL event is a separate
 * `JSON.stringify(event, null, 2)` call appended back-to-back with no
 * separator, so this walks brace depth while respecting string literals and
 * escapes to find each object's end. It can be fed incrementally in chunks. */
/** @internal Exported for unit testing chunked parsing. */
export class ConcatenatedJsonScanner {
  private buffer = ''
  private depth = 0
  private start = -1
  private inString = false
  private escaped = false
  private scanned = 0
  private readonly maxBuffer: number

  constructor(maxBuffer = 10 * 1024 * 1024) {
    this.maxBuffer = maxBuffer
  }

  push(chunk: string): string[] {
    this.buffer += chunk
    const out: string[] = []

    // Resume scanning from where the previous chunk left off so leftover
    // braces at the buffer boundary are not double-counted.
    for (let i = this.scanned; i < this.buffer.length; i++) {
      const ch = this.buffer[i]
      if (this.inString) {
        if (this.escaped) this.escaped = false
        else if (ch === '\\') this.escaped = true
        else if (ch === '"') this.inString = false
        continue
      }
      if (ch === '"') {
        this.inString = true
      } else if (ch === '{') {
        if (this.depth === 0) this.start = i
        this.depth++
      } else if (ch === '}') {
        this.depth--
        if (this.depth === 0 && this.start >= 0) {
          out.push(this.buffer.slice(this.start, i + 1))
          this.buffer = this.buffer.slice(i + 1)
          i = -1
          this.scanned = 0
          this.start = -1
        }
      }
    }

    this.scanned = this.buffer.length

    // Guard against runaway buffers on malformed/truncated input. If we're not
    // inside an object, trailing garbage can be discarded. If we are inside an
    // object but it exceeds a reasonable size, drop it so a corrupt file can't
    // pin unbounded memory.
    if (this.buffer.length > this.maxBuffer) {
      if (this.depth === 0) {
        this.buffer = ''
      } else {
        this.buffer = ''
        this.depth = 0
        this.start = -1
        this.inString = false
        this.escaped = false
      }
      this.scanned = 0
    }

    return out
  }

  /** Discards any trailing incomplete object at EOF. */
  flush(): void {
    this.buffer = ''
    this.scanned = 0
    this.depth = 0
    this.start = -1
    this.inString = false
    this.escaped = false
  }
}

/** Splits a complete concatenated JSON string into individual objects. */
export function splitConcatenatedJsonObjects(text: string): string[] {
  const scanner = new ConcatenatedJsonScanner()
  return scanner.push(text)
}

/** Streams a concatenated JSON file and yields each complete object without
 * loading the whole file into memory. */
async function* streamConcatenatedJsonObjects(filePath: string): AsyncGenerator<string> {
  const scanner = new ConcatenatedJsonScanner()
  const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 })
  for await (const chunk of stream) {
    for (const obj of scanner.push(chunk.toString('utf8'))) {
      yield obj
    }
  }
  scanner.flush()
}

const GEMINI_USAGE_LOG_MAX_BYTES = 256 * 1024 * 1024
const GEMINI_USAGE_LOG_BACKUPS = 2

/** Returns the active Gemini usage log plus any rotated backup files, ordered
 * from newest to oldest so recent events are processed first. */
function geminiUsageLogFiles(): string[] {
  const logPath = geminiUsageLogPath()
  const dir = dirname(logPath)
  const base = basename(logPath, '.log')
  const files: string[] = []
  for (let i = 0; i <= GEMINI_USAGE_LOG_BACKUPS; i++) {
    const file = i === 0 ? logPath : join(dir, `${base}.log.${i}`)
    if (existsSync(file)) files.push(file)
  }
  return files
}

/** Rotates the Gemini usage telemetry log if it has grown too large.
 * Called before a new gemini-cli process starts writing to it. */
export function rotateGeminiUsageLogIfNeeded(
  maxBytes = GEMINI_USAGE_LOG_MAX_BYTES,
  backups = GEMINI_USAGE_LOG_BACKUPS
): void {
  const logPath = geminiUsageLogPath()
  let size: number
  try {
    size = statSync(logPath).size
  } catch {
    return
  }
  if (size <= maxBytes) return

  const dir = dirname(logPath)
  const base = basename(logPath, '.log')

  // Shift existing backups up: .log.1 -> .log.2, etc.
  for (let i = backups; i >= 1; i--) {
    const src = join(dir, `${base}.log.${i}`)
    const dst = join(dir, `${base}.log.${i + 1}`)
    try {
      if (existsSync(dst)) unlinkSync(dst)
      if (existsSync(src)) renameSync(src, dst)
    } catch {
      /* ignore individual rotation failures */
    }
  }

  // Move current log to .log.1
  try {
    renameSync(logPath, join(dir, `${base}.log.1`))
  } catch {
    /* ignore */
  }

  // Drop the backup pushed out of the retention window.
  try {
    const overflow = join(dir, `${base}.log.${backups + 1}`)
    if (existsSync(overflow)) unlinkSync(overflow)
  } catch {
    /* ignore */
  }
}

async function collectGeminiUsage(): Promise<UsageEntry[]> {
  const entries: UsageEntry[] = []
  const files = geminiUsageLogFiles()
  if (files.length === 0) return []

  for (const file of files) {
    let fallbackTs: number
    try {
      // Matches the other collectors' convention (e.g. collectClaudeUsage) of
      // falling back to the source file's mtime rather than "now" — "now" would
      // misattribute an old event to today if a future gemini-cli release ever
      // omits/malforms event.timestamp.
      fallbackTs = statSync(file).mtimeMs
    } catch {
      continue
    }
    for await (const chunk of streamConcatenatedJsonObjects(file)) {
      let event: unknown
      try {
        event = JSON.parse(chunk)
      } catch {
        continue
      }
      const record = asRecord(event)
      const attributes = asRecord(record?.attributes)
      if (!attributes || attributes['event.name'] !== 'gemini_cli.api_response') continue
      const entry: UsageEntry = {
        cliId: 'gemini',
        sessionId:
          typeof attributes['session.id'] === 'string' ? attributes['session.id'] : undefined,
        model: normalizeModel(attributes.model),
        ts: normalizeTs(attributes['event.timestamp']) ?? fallbackTs,
        // tool_token_count is deliberately left out — its OTEL semantics aren't
        // documented precisely enough to confidently fold into input or output.
        inputTokens: readNumber(attributes, ['input_token_count']),
        outputTokens:
          readNumber(attributes, ['output_token_count']) +
          readNumber(attributes, ['thoughts_token_count']),
        cacheReadTokens: readNumber(attributes, ['cached_content_token_count']),
        // Gemini's API has no "cache write/creation" concept the way Claude's
        // prompt caching does — cached_content_token_count is a cache *read*
        // (reused context), so there's nothing to map here.
        cacheCreationTokens: 0
      }
      if (hasUsage(entry)) entries.push(entry)
    }
  }
  return entries
}

function dateKey(ts: number): string {
  const date = new Date(ts)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function emptyTokens(): UsageTokenTotals {
  return { ...ZERO_TOKENS }
}

function emptyCost(): UsageCostTotals {
  return { ...ZERO_COST }
}

function roundCost(cost: UsageCostTotals): UsageCostTotals {
  return {
    inputCost: Number(cost.inputCost.toFixed(6)),
    outputCost: Number(cost.outputCost.toFixed(6)),
    cacheReadCost: Number(cost.cacheReadCost.toFixed(6)),
    cacheCreationCost: Number(cost.cacheCreationCost.toFixed(6)),
    totalCost: Number(cost.totalCost.toFixed(6))
  }
}

function buildDailyBuckets(
  rangeDays: number,
  startedAt: number,
  map: Map<string, UsageDailyBucket>
): UsageDailyBucket[] {
  const out: UsageDailyBucket[] = []
  for (let i = 0; i < rangeDays; i += 1) {
    const ts = startedAt + i * 86_400_000
    const key = dateKey(ts)
    out.push(
      map.get(key) ?? { date: key, requestCount: 0, tokens: emptyTokens(), cost: emptyCost() }
    )
  }
  return out
}

async function countListedSessions(errors: string[]): Promise<Map<CliId, number>> {
  const counts = new Map<CliId, number>()
  await Promise.all(
    CLI_IDS.map(async (cliId) => {
      try {
        counts.set(cliId, (await listSessions(cliId)).length)
      } catch (error) {
        errors.push(`${cliId} sessions: ${error instanceof Error ? error.message : String(error)}`)
        counts.set(cliId, 0)
      }
    })
  )
  return counts
}

export async function readUsage(rangeDays = 365, summaryDays = 30): Promise<UsageScanResult> {
  const safeRangeDays = Math.min(730, Math.max(1, Math.round(rangeDays || 365)))
  const safeSummaryDays = Math.min(safeRangeDays, Math.max(1, Math.round(summaryDays || 30)))
  const endedAt = Date.now()
  const start = new Date(endedAt)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - safeRangeDays + 1)
  const startedAt = start.getTime()
  const summaryStart = new Date(endedAt)
  summaryStart.setHours(0, 0, 0, 0)
  summaryStart.setDate(summaryStart.getDate() - safeSummaryDays + 1)
  const summaryStartedAt = summaryStart.getTime()
  const errors: string[] = []
  const collectors: Array<[CliId, () => UsageEntry[] | Promise<UsageEntry[]>]> = [
    ['claude-code', collectClaudeUsage],
    ['codex', collectCodexUsage],
    ['opencode', collectOpencodeUsage],
    ['pi', collectPiUsage],
    ['hermes', collectHermesUsage],
    ['gemini', collectGeminiUsage]
  ]

  const entries: UsageEntry[] = []
  for (const [cliId, collect] of collectors) {
    try {
      entries.push(...(await collect()))
    } catch (error) {
      errors.push(`${cliId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const inRange = entries.filter((entry) => entry.ts >= startedAt && entry.ts <= endedAt)
  const inSummaryRange = inRange.filter((entry) => entry.ts >= summaryStartedAt)
  const totals = emptyTokens()
  const costTotals = emptyCost()
  const byCli = new Map<CliId, UsageCliSummary>()
  const byModel = new Map<string, UsageModelBreakdown>()
  const daily = new Map<string, UsageDailyBucket>()
  const listedSessionCounts = await countListedSessions(errors)

  for (const entry of inRange) {
    const tokens = tokensOf(entry)
    const cost = calculateCost(entry)
    const requests = Math.max(1, Math.round(entry.requestCount ?? 1))
    const dayKey = dateKey(entry.ts)
    const day = daily.get(dayKey) ?? {
      date: dayKey,
      requestCount: 0,
      tokens: emptyTokens(),
      cost: emptyCost()
    }
    day.requestCount += requests
    addTokens(day.tokens, tokens)
    addCost(day.cost, cost)
    daily.set(dayKey, day)
  }

  for (const entry of inSummaryRange) {
    const tokens = tokensOf(entry)
    const cost = calculateCost(entry)
    const requests = Math.max(1, Math.round(entry.requestCount ?? 1))
    addTokens(totals, tokens)
    addCost(costTotals, cost)

    const cli = byCli.get(entry.cliId) ?? {
      cliId: entry.cliId,
      requestCount: 0,
      sessionCount: 0,
      tokens: emptyTokens(),
      cost: emptyCost()
    }
    cli.requestCount += requests
    addTokens(cli.tokens, tokens)
    addCost(cli.cost, cost)
    byCli.set(entry.cliId, cli)

    const modelKey = entry.model || 'unknown'
    const model = byModel.get(modelKey) ?? {
      model: modelKey,
      requestCount: 0,
      tokens: emptyTokens(),
      cost: emptyCost()
    }
    model.requestCount += requests
    addTokens(model.tokens, tokens)
    addCost(model.cost, cost)
    byModel.set(modelKey, model)
  }

  return {
    rangeDays: safeRangeDays,
    summaryDays: safeSummaryDays,
    generatedAt: endedAt,
    startedAt,
    summaryStartedAt,
    endedAt,
    requestCount: inSummaryRange.reduce(
      (sum, entry) => sum + Math.max(1, Math.round(entry.requestCount ?? 1)),
      0
    ),
    sessionCount: CLI_IDS.reduce((sum, cliId) => sum + (listedSessionCounts.get(cliId) ?? 0), 0),
    tokens: totals,
    cost: roundCost(costTotals),
    byCli: CLI_IDS.map(
      (cliId) =>
        byCli.get(cliId) ?? {
          cliId,
          requestCount: 0,
          sessionCount: listedSessionCounts.get(cliId) ?? 0,
          tokens: emptyTokens(),
          cost: emptyCost()
        }
    ).map((summary) => ({
      ...summary,
      sessionCount: listedSessionCounts.get(summary.cliId) ?? summary.sessionCount,
      cost: roundCost(summary.cost)
    })),
    byModel: [...byModel.values()]
      .sort((a, b) => b.tokens.totalTokens - a.tokens.totalTokens)
      .slice(0, 12)
      .map((item) => ({ ...item, cost: roundCost(item.cost) })),
    daily: buildDailyBuckets(safeRangeDays, startedAt, daily).map((bucket) => ({
      ...bucket,
      cost: roundCost(bucket.cost)
    })),
    errors
  }
}
