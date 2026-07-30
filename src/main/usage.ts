import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { geminiUsageLogPath, hermesHomeDir } from './config-paths'
import { getSql, readSqliteSnapshot } from './sqlite'
import { paths } from './sandbox'
import { listSessions } from './sessions-history'
import { getInstallSource, loadConfig } from './store'
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

function cliStateRoot(cliId: CliId): string {
  if (getInstallSource(cliId) !== 'system') return paths.cliConfig(cliId)
  if (cliId === 'claude-code') return join(homedir(), '.claude')
  if (cliId === 'codex') return join(homedir(), '.codex')
  if (cliId === 'pi') return join(homedir(), '.pi', 'agent')
  if (cliId === 'hermes') return hermesHomeDir()
  return paths.cliConfig(cliId)
}

function opencodeDbPath(): string {
  if (getInstallSource('opencode') !== 'system') {
    return join(paths.cliConfig('opencode'), 'xdg-data', 'opencode', 'opencode.db')
  }
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'opencode', 'opencode.db')
}

function hermesDbPath(): string {
  return join(cliStateRoot('hermes'), 'state.db')
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

function collectClaudeUsage(): UsageEntry[] {
  const root = join(cliStateRoot('claude-code'), 'projects')
  const files: string[] = []
  collectJsonlRecursive(root, files)
  const entries: UsageEntry[] = []
  for (const file of files) {
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
  const root = join(cliStateRoot('codex'), 'sessions')
  const files: string[] = []
  collectJsonlRecursive(root, files)
  const entries: UsageEntry[] = []
  for (const file of files) {
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
  const root = join(cliStateRoot('pi'), 'sessions')
  const files: string[] = []
  collectJsonlRecursive(root, files)
  const entries: UsageEntry[] = []
  for (const file of files) {
    if (!isPathInside(file, root)) continue
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

/** Splits gemini-cli's local telemetry outfile into individual JSON objects.
 * It's NOT valid JSON (array) or JSONL — each OTEL event is a separate
 * `JSON.stringify(event, null, 2)` call appended back-to-back with no
 * separator (verified against a real `--telemetry` run), so this walks brace
 * depth while respecting string literals/escapes to find each object's end. */
export function splitConcatenatedJsonObjects(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  return out
}

function collectGeminiUsage(): UsageEntry[] {
  const logPath = geminiUsageLogPath()
  if (!existsSync(logPath)) return []
  let text: string
  let fallbackTs: number
  try {
    text = readFileSync(logPath, 'utf8')
    // Matches the other collectors' convention (e.g. collectClaudeUsage) of
    // falling back to the source file's mtime rather than "now" — "now" would
    // misattribute an old event to today if a future gemini-cli release ever
    // omits/malforms event.timestamp.
    fallbackTs = statSync(logPath).mtimeMs
  } catch {
    return []
  }
  const entries: UsageEntry[] = []
  for (const chunk of splitConcatenatedJsonObjects(text)) {
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
