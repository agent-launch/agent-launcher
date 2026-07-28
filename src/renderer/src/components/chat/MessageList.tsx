import { memo, useMemo, useState } from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Copy,
  Loader2,
  TerminalSquare,
  Wrench
} from 'lucide-react'
import { CliIcon } from '@/components/CliIcon'
import { Markdown } from '@/components/ui/Markdown'
import { resolveLocale, useT } from '@/i18n'
import { useAppStore } from '@/store/app'
import type { CliId, TranscriptMessage, TranscriptPart } from '@shared/types'

function formatClockTime(ts: number | undefined, locale: string): string | null {
  if (!ts) return null
  try {
    return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(ts))
  } catch {
    return null
  }
}

function partText(part: TranscriptPart): string {
  if (part.kind === 'tool') {
    return [`[${part.tool ?? 'tool'}] ${part.detail ?? ''}`.trim(), part.input, part.result]
      .filter(Boolean)
      .join('\n\n')
  }
  return part.text ?? ''
}

function messageText(msg: TranscriptMessage): string {
  return msg.parts.map(partText).filter(Boolean).join('\n\n')
}

/**
 * Playground-style message list, shared by read-only transcript and live chat:
 * user turns sit in right-aligned bubbles, assistant turns use a full-width
 * body with compact reasoning/tool blocks.
 */
export const MessageList = memo(function MessageList({
  messages,
  assistantName = 'Assistant',
  assistantCliId
}: {
  messages: TranscriptMessage[]
  assistantName?: string
  assistantCliId?: CliId
}) {
  const localeMode = useAppStore((s) => s.localeMode)
  const locale = resolveLocale(localeMode)

  return (
    <div className="space-y-8">
      {messages.map((m, i) => (
        <MessageBlock
          key={i}
          msg={m}
          assistantName={assistantName}
          assistantCliId={assistantCliId}
          locale={locale}
        />
      ))}
    </div>
  )
})

const MessageBlock = memo(function MessageBlock({
  msg,
  assistantName,
  assistantCliId,
  locale
}: {
  msg: TranscriptMessage
  assistantName: string
  assistantCliId?: CliId
  locale: string
}) {
  const t = useT()
  const time = useMemo(() => formatClockTime(msg.ts, locale), [msg.ts, locale])
  const text = useMemo(() => messageText(msg), [msg])
  if (msg.role === 'user') {
    return (
      <div className="group/message flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-text-weak">
          <span>{t('transcript.role.user')}</span>
        </div>
        <div className="max-w-[82%] space-y-2 rounded-xl rounded-tr-md border border-border-weak bg-message-user px-4 py-2.5 text-[14px] leading-relaxed text-text-strong">
          {msg.parts.map((p, i) => (
            <PartView key={i} part={p} />
          ))}
        </div>
        <div className="flex h-6 items-center gap-1.5 text-[11px] text-text-weak">
          {time && <span>{time}</span>}
          <InlineCopy text={text} />
        </div>
      </div>
    )
  }

  const label =
    msg.role === 'system'
      ? t('transcript.role.system')
      : assistantName || t('transcript.role.assistant')

  return (
    <div className="group/message flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md text-[11px] font-medium text-text-weak">
        {assistantCliId && msg.role !== 'system' ? (
          <CliIcon cliId={assistantCliId} size={15} />
        ) : (
          label.slice(0, 1)
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[13px] font-medium text-text-strong">{label}</span>
        </div>
        <div className="max-w-[760px] space-y-3.5">
          {msg.parts.map((p, i) => (
            <PartView key={i} part={p} />
          ))}
        </div>
        <div className="mt-2 flex h-6 max-w-[760px] items-center gap-1.5 text-[11px] text-text-weak">
          {time && <span>{time}</span>}
          <InlineCopy text={text} />
        </div>
      </div>
    </div>
  )
})

function InlineCopy({ text }: { text: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const trimmed = text.trim()
  if (!trimmed) return null

  return (
    <button
      type="button"
      title={copied ? t('chat.copied') : t('chat.copy')}
      aria-label={copied ? t('chat.copied') : t('chat.copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(trimmed)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-weak transition-colors hover:bg-surface-hover hover:text-text-strong"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

const PartView = memo(function PartView({ part }: { part: TranscriptPart }) {
  const t = useT()
  if (part.kind === 'thinking') {
    return (
      <details className="group rounded-lg border border-border-weak bg-surface-weak/70">
        <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-text-weak transition-colors hover:text-text-strong">
          <Brain size={14} />
          {t('transcript.thinking')}
          <ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180" />
        </summary>
        <div className="max-h-[320px] overflow-auto border-t border-border-weak px-3 py-2">
          <Markdown className="md-sm text-text-base">{part.text ?? ''}</Markdown>
        </div>
      </details>
    )
  }
  if (part.kind === 'tool') {
    return <ToolPart part={part} />
  }
  return <Markdown className="text-[14px] leading-relaxed">{part.text ?? ''}</Markdown>
})

function compactResult(result: string | undefined): string | null {
  if (!result?.trim()) return null
  const first = result
    .trim()
    .split('\n')
    .find((line) => line.trim())
    ?.trim()
  if (!first) return null
  return first.length > 90 ? `${first.slice(0, 90)}...` : first
}

function toolVerbKey(tool: string | undefined): string {
  const name = (tool ?? 'tool').toLowerCase()
  if (['read', 'read_file'].includes(name)) return 'transcript.toolVerb.read'
  if (['write', 'edit', 'multi_edit', 'apply_patch'].includes(name))
    return 'transcript.toolVerb.edit'
  if (['bash', 'shell', 'exec', 'exec_command', 'command_execution'].includes(name))
    return 'transcript.toolVerb.run'
  if (name.includes('search') || name === 'grep') return 'transcript.toolVerb.search'
  if (name.includes('list') || name === 'ls' || name === 'glob') return 'transcript.toolVerb.list'
  return 'transcript.toolVerb.call'
}

function ToolPart({ part }: { part: TranscriptPart }) {
  const t = useT()
  const hasDetails = Boolean(part.input?.trim() || part.result?.trim())
  const resultPreview = compactResult(part.result)
  const status = part.isError ? 'error' : (part.status ?? (part.result ? 'completed' : 'running'))
  const statusIcon =
    status === 'error' ? (
      <CircleX size={14} className="text-danger" />
    ) : status === 'completed' ? (
      <CircleCheck size={14} className="text-success" />
    ) : (
      <Loader2 size={14} className="animate-spin text-text-weak" />
    )

  const summary = [t(toolVerbKey(part.tool)), part.detail].filter(Boolean).join(' ')

  if (!hasDetails) {
    return (
      <div className="flex min-w-0 items-center gap-2 py-1 text-[13px] text-text-weak">
        <TerminalSquare size={15} className="shrink-0" />
        <span className="shrink-0">{t('transcript.toolCall')}</span>
        <span className="truncate font-mono text-text-base">{part.tool ?? 'tool'}</span>
        {part.detail && <span className="truncate">{part.detail}</span>}
        <span className="ml-auto shrink-0">{statusIcon}</span>
      </div>
    )
  }

  return (
    <details className="group/tool rounded-lg border border-border-weak bg-surface-weak/55">
      <summary className="flex min-w-0 cursor-pointer select-none items-center gap-2 px-3 py-2 text-[13px] text-text-weak transition-colors hover:text-text-strong">
        <Wrench size={15} className="shrink-0" />
        <span className="shrink-0">{t('transcript.toolCall')}</span>
        <span className="shrink-0 font-mono text-text-strong">{part.tool ?? 'tool'}</span>
        <span className="min-w-0 truncate">{summary}</span>
        {resultPreview && (
          <span className="hidden min-w-0 truncate text-text-base md:inline">{resultPreview}</span>
        )}
        <span className="ml-auto shrink-0">{statusIcon}</span>
        <ChevronDown
          size={14}
          className="shrink-0 transition-transform group-open/tool:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t border-border-weak px-3 py-3">
        {part.input && <ToolDetailBlock label={t('transcript.toolInput')} text={part.input} />}
        {part.result && (
          <ToolDetailBlock
            label={part.isError ? t('transcript.toolError') : t('transcript.toolResult')}
            text={part.result}
            danger={part.isError}
          />
        )}
      </div>
    </details>
  )
}

function ToolDetailBlock({
  label,
  text,
  danger
}: {
  label: string
  text: string
  danger?: boolean
}) {
  return (
    <div>
      <div
        className={`mb-1.5 text-[11px] font-medium ${danger ? 'text-danger' : 'text-text-weak'}`}
      >
        {label}
      </div>
      <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-weak bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-text-base">
        {text}
      </pre>
    </div>
  )
}
