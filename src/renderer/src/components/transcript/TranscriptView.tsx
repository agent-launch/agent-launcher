import { useEffect, useState } from 'react'
import { ArrowLeft, SquareTerminal, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CliIcon } from '@/components/CliIcon'
import { useT } from '@/i18n'
import type { CliId, Transcript, TranscriptMessage, TranscriptPart } from '@shared/types'

interface Props {
  cliId: CliId
  sessionId: string
  name: string
  onResume: () => void
  onBack: () => void
}

/**
 * Read-only render of a saved CLI conversation. Fetched from the main process
 * (which normalizes each CLI's on-disk format) and shown as labeled bubbles;
 * thinking is collapsed, tool calls are compact. "Continue in terminal" hands
 * off to the existing PTY resume flow.
 */
export function TranscriptView({ cliId, sessionId, name, onResume, onBack }: Props) {
  const t = useT()
  const [data, setData] = useState<Transcript | null>(null)

  useEffect(() => {
    let live = true
    setData(null)
    window.api.sessions.transcript(cliId, sessionId).then((d) => {
      if (live) setData(d)
    })
    return () => {
      live = false
    }
  }, [cliId, sessionId])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border-weak px-3">
        <button
          onClick={onBack}
          className="no-drag grid size-7 place-items-center rounded-md text-text-weak hover:bg-surface-weak hover:text-text-strong"
          title={t('transcript.back')}
        >
          <ArrowLeft size={16} />
        </button>
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-weak text-text-strong">
          <CliIcon cliId={cliId} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-text-strong">{name}</span>
        <Button size="sm" onClick={onResume}>
          <SquareTerminal size={14} />
          {t('transcript.resume')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!data ? (
          <div className="px-6 py-8 text-center text-[13px] text-text-weak">{t('transcript.loading')}</div>
        ) : data.messages.length === 0 ? (
          <div className="px-6 py-8 text-center text-[13px] text-text-weak">{t('transcript.empty')}</div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-6">
            {data.truncated && (
              <div className="rounded-md border border-dashed border-border-weak px-3 py-1.5 text-center text-[12px] text-text-weak">
                {t('transcript.truncated')}
              </div>
            )}
            {data.messages.map((m, i) => (
              <MessageBlock key={i} msg={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MessageBlock({ msg }: { msg: TranscriptMessage }) {
  const t = useT()
  const isUser = msg.role === 'user'
  const label =
    msg.role === 'user'
      ? t('transcript.role.user')
      : msg.role === 'assistant'
        ? t('transcript.role.assistant')
        : t('transcript.role.system')
  return (
    <div>
      <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-text-weak">{label}</div>
      <div
        className={`rounded-lg border px-3.5 py-2.5 ${
          isUser ? 'border-border-selected/40 bg-surface-weak' : 'border-border-weak bg-surface'
        }`}
      >
        <div className="space-y-2">
          {msg.parts.map((p, i) => (
            <PartView key={i} part={p} />
          ))}
        </div>
      </div>
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
        <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-text-base">
          {part.text}
        </div>
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
  return (
    <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-strong">
      {part.text}
    </div>
  )
}
