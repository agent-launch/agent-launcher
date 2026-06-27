import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CliIcon } from '@/components/CliIcon'
import { MessageList } from '@/components/chat/MessageList'
import { CLIS } from '@/data/clis'
import { useT } from '@/i18n'
import type { CliId, Transcript } from '@shared/types'

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
  const active = useMemo(() => CLIS.find((c) => c.id === cliId), [cliId])
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
    <div className="flex h-full flex-col bg-stronger">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border-weak px-5">
        <button
          onClick={onBack}
          className="no-drag grid size-7 place-items-center rounded-lg text-text-weak hover:bg-surface-hover hover:text-text-strong"
          title={t('transcript.back')}
        >
          <ArrowLeft size={16} />
        </button>
        <span className="grid size-6 shrink-0 place-items-center rounded-lg text-text-base">
          <CliIcon cliId={cliId} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text-strong">{name}</span>
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
          <div className="mx-auto w-full max-w-[980px] px-8 py-7">
            {data.truncated && (
              <div className="mb-6 rounded-xl border border-dashed border-border-weak bg-surface px-3 py-2 text-center text-[12px] text-text-weak">
                {t('transcript.truncated')}
              </div>
            )}
            <MessageList messages={data.messages} assistantName={active?.name ?? cliId} assistantCliId={cliId} />
          </div>
        )}
      </div>
    </div>
  )
}
