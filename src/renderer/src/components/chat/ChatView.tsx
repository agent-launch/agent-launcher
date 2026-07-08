import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Send, Square } from 'lucide-react'
import { CliIcon } from '@/components/CliIcon'
import { MessageList } from '@/components/chat/MessageList'
import { CLIS } from '@/data/clis'
import { useT } from '@/i18n'
import type { ChatEvent, CliId, TranscriptMessage, TranscriptPart } from '@shared/types'

interface Props {
  cliId: CliId
  cwd?: string
  resumeId?: string
  onBack: () => void
}

/**
 * Live in-UI chat with a CLI running in programmatic mode (MVP: Claude Code).
 * Reuses the shared MessageList renderer; appends streamed parts as they arrive.
 */
export function ChatView({ cliId, cwd, resumeId, onBack }: Props) {
  const t = useT()
  const active = useMemo(() => CLIS.find((c) => c.id === cliId), [cliId])
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(!!resumeId)
  const [error, setError] = useState<string | null>(null)

  const handleRef = useRef<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Start the chat process once; subscribe before starting so no early event is missed.
  useEffect(() => {
    let live = true

    // Resuming a session: seed the prior conversation so history doesn't vanish.
    // Live turns only emit NEW content, so there's no duplication.
    if (resumeId) {
      window.api.sessions
        .transcript(cliId, resumeId)
        .then((tr) => {
          if (live) setMessages(tr.messages)
        })
        .finally(() => live && setLoadingHistory(false))
    }

    const off = window.api.chat.onEvent((id, ev: ChatEvent) => {
      if (id !== handleRef.current) return
      if (ev.type === 'part') {
        const ts = ev.ts ?? Date.now()
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (ev.role !== 'user' && last && last.role === ev.role) {
            // Streamed updates carry a stable id (opencode / tool result pairs).
            // Merge updates into the existing part so a later result keeps the
            // original tool name and input summary.
            let parts = last.parts
            const idx = ev.part.id ? parts.findIndex((p) => p.id === ev.part.id) : -1
            parts = idx >= 0 ? parts.map((p, i) => (i === idx ? mergePart(p, ev.part) : p)) : [...parts, ev.part]
            return [...prev.slice(0, -1), { ...last, parts, ts: last.ts ?? ts }]
          }
          return [...prev, { role: ev.role, parts: [ev.part], ts }]
        })
      } else if (ev.type === 'turn-end') setStreaming(false)
      else if (ev.type === 'error') setError(ev.message)
      else if (ev.type === 'exit') setStreaming(false)
    })

    window.api.chat
      .start({ cliId, cwd, resumeId })
      .then((id) => {
        if (!live) {
          window.api.chat.stop(id)
          return
        }
        handleRef.current = id
        if (pendingRef.current) {
          window.api.chat.send(id, pendingRef.current)
          pendingRef.current = null
        }
      })
      .catch((e: Error) => setError(e.message))

    return () => {
      live = false
      off()
      if (handleRef.current) window.api.chat.stop(handleRef.current)
    }
  }, [cliId, cwd, resumeId])

  // Auto-scroll to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  const submit = useCallback((text: string) => {
    text = text.trim()
    if (!text || streaming) return
    setMessages((prev) => [...prev, { role: 'user', parts: [{ kind: 'text', text }], ts: Date.now() }])
    setStreaming(true)
    setError(null)
    if (handleRef.current) window.api.chat.send(handleRef.current, text)
    else pendingRef.current = text // process not ready yet — flush on start
  }, [streaming])

  const stop = useCallback(() => {
    if (handleRef.current) window.api.chat.stop(handleRef.current)
    setStreaming(false)
  }, [])

  return (
    <div className="flex h-full flex-col bg-stronger">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border-weak bg-stronger px-4">
        <button
          onClick={onBack}
          className="no-drag grid size-7 place-items-center rounded-md text-text-weak hover:bg-surface-hover hover:text-text-strong"
          title={t('transcript.back')}
        >
          <ArrowLeft size={16} />
        </button>
        <span className="grid size-6 shrink-0 place-items-center rounded-md text-text-base">
          <CliIcon cliId={cliId} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-text-strong">
              {resumeId ? t('chat.continued') : t('chat.newChat')}
            </span>
            <span className="shrink-0 rounded-md border border-border-weak bg-surface px-1.5 py-0.5 text-[10px] text-text-weak">
              {active?.name ?? cliId}
            </span>
          </div>
        </div>
        {streaming && (
          <span className="rounded-md border border-border-weak bg-surface px-2 py-0.5 text-[11px] text-text-weak">
            {t('chat.streaming')}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[980px] px-7 py-6">
          {loadingHistory && (
            <div className="py-6 text-center text-[13px] text-text-weak">{t('transcript.loading')}</div>
          )}
          {!loadingHistory && messages.length === 0 && !error && (
            <div className="flex min-h-[45vh] items-center justify-center">
              <div className="max-w-[420px] rounded-lg border border-dashed border-border-weak bg-surface/60 px-5 py-8 text-center">
                <div className="mx-auto mb-3 grid size-9 place-items-center rounded-md bg-surface-weak text-text-strong">
                  <CliIcon cliId={cliId} size={18} />
                </div>
                <div className="text-[13px] text-text-weak">{t('chat.empty')}</div>
              </div>
            </div>
          )}
          <MessageList messages={messages} assistantName={active?.name ?? cliId} assistantCliId={cliId} />
          {streaming && (
            <div className="mt-7 flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border-weak bg-surface text-text-weak">
                <CliIcon cliId={cliId} size={15} />
              </span>
              <div className="flex items-center gap-1 py-1 text-[13px] text-text-weak">
                <span className="size-1.5 animate-pulse rounded-full bg-text-weak" />
                <span className="size-1.5 animate-pulse rounded-full bg-text-weak [animation-delay:150ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-text-weak [animation-delay:300ms]" />
              </div>
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-lg border border-dashed px-3 py-2 text-[12px]" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <ChatComposer
        cliName={active?.name ?? cliId}
        streaming={streaming}
        onSubmit={submit}
        onStop={stop}
      />
    </div>
  )
}

function mergePart(prev: TranscriptPart, next: TranscriptPart): TranscriptPart {
  if (prev.kind !== next.kind) return next
  return {
    ...prev,
    ...next,
    text: next.text ?? prev.text,
    tool: next.tool && next.tool !== 'tool' ? next.tool : prev.tool ?? next.tool,
    detail: next.detail ?? prev.detail,
    input: next.input ?? prev.input,
    result: next.result ?? prev.result,
    isError: next.isError ?? prev.isError,
    status: next.status ?? prev.status
  }
}

const ChatComposer = memo(function ChatComposer({
  cliName,
  streaming,
  onSubmit,
  onStop
}: {
  cliName: string
  streaming: boolean
  onSubmit: (text: string) => void
  onStop: () => void
}) {
  const t = useT()
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const syncTextareaLayout = (ta: HTMLTextAreaElement) => {
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(220, ta.scrollHeight)}px`
  }

  const submit = () => {
    const text = input.trim()
    if (!text || streaming) return
    onSubmit(text)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const native = e.nativeEvent as KeyboardEvent
    if (native.isComposing || native.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="shrink-0 bg-stronger px-6 pb-5 pt-3">
      <div className="mx-auto w-full max-w-[980px]">
        <div className="rounded-xl border border-border-base bg-[var(--composer-background)] p-2.5 shadow-[var(--shadow-composer)] transition-colors focus-within:border-border-selected">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              syncTextareaLayout(e.target)
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={t('chat.placeholder')}
            className="selectable max-h-[220px] min-h-10 w-full resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-text-strong outline-none placeholder:text-text-muted"
          />
          <div className="mt-1 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-surface-weak px-2 py-1 text-[11px] text-text-base">
                {cliName}
              </span>
            </div>
            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-text-strong text-[var(--background-base)] transition-colors hover:brightness-110"
                title={t('chat.stop')}
                aria-label={t('chat.stop')}
              >
                <Square size={14} className="fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim()}
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--button-primary-base)] text-[var(--button-primary-text)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                title={t('chat.send')}
                aria-label={t('chat.send')}
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
