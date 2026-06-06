import { Wrench } from 'lucide-react'
import { Markdown } from '@/components/ui/Markdown'
import { useT } from '@/i18n'
import type { TranscriptMessage, TranscriptPart } from '@shared/types'

/**
 * ChatGPT-style message list, shared by the read-only transcript and the live
 * chat: user messages in a right-aligned bubble, assistant/system full-width
 * with no bubble. Thinking is collapsible; tool calls render as compact rows.
 */
export function MessageList({ messages }: { messages: TranscriptMessage[] }) {
  return (
    <>
      {messages.map((m, i) => (
        <MessageBlock key={i} msg={m} />
      ))}
    </>
  )
}

function MessageBlock({ msg }: { msg: TranscriptMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-2 rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-text-strong">
          {msg.parts.map((p, i) => (
            <PartView key={i} part={p} />
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {msg.parts.map((p, i) => (
        <PartView key={i} part={p} />
      ))}
    </div>
  )
}

function PartView({ part }: { part: TranscriptPart }) {
  const t = useT()
  if (part.kind === 'thinking') {
    return (
      <details className="rounded-md bg-surface-weak/60 px-2 py-1">
        <summary className="cursor-pointer select-none text-[12px] text-text-weak">
          {t('transcript.thinking')}
        </summary>
        <Markdown className="md-sm mt-1">{part.text ?? ''}</Markdown>
      </details>
    )
  }
  if (part.kind === 'tool') {
    return (
      <div className="flex items-center gap-2 font-mono text-[12px] text-text-weak">
        <Wrench size={12} className="shrink-0" />
        <span className="text-text-base">{part.tool}</span>
        {part.detail && <span className="truncate">{part.detail}</span>}
      </div>
    )
  }
  return <Markdown>{part.text ?? ''}</Markdown>
}
