import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, SquareTerminal, Send } from 'lucide-react'
import { CliIcon } from '@/components/CliIcon'
import { MessageList } from '@/components/chat/MessageList'
import { useT } from '@/i18n'
import type { ChatEvent, CliId, TranscriptMessage } from '@shared/types'

interface Props {
  cliId: CliId
  cwd?: string
  resumeId?: string
  onBack: () => void
  /** Escape hatch: open the same session in the embedded terminal. */
  onOpenTerminal: (resumeId?: string) => void
}

/**
 * Live in-UI chat with a CLI running in programmatic mode (MVP: Claude Code).
 * Reuses the shared MessageList renderer; appends streamed parts as they arrive.
 */
export function ChatView({ cliId, cwd, resumeId, onBack, onOpenTerminal }: Props) {
  const t = useT()
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(!!resumeId)
  const [error, setError] = useState<string | null>(null)

  const handleRef = useRef<string | null>(null)
  const sessionRef = useRef<string | undefined>(resumeId)
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
      if (ev.type === 'session') sessionRef.current = ev.sessionId
      else if (ev.type === 'part') {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (ev.role !== 'user' && last && last.role === ev.role) {
            // Streamed updates carry a stable id (opencode) → replace same-id part
            // in place; otherwise append (Claude/Codex/Pi emit final parts).
            let parts = last.parts
            const idx = ev.part.id ? parts.findIndex((p) => p.id === ev.part.id) : -1
            parts = idx >= 0 ? parts.map((p, i) => (i === idx ? ev.part : p)) : [...parts, ev.part]
            return [...prev.slice(0, -1), { ...last, parts }]
          }
          return [...prev, { role: ev.role, parts: [ev.part] }]
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

  const submit = () => {
    const text = input.trim()
    if (!text || streaming) return
    setMessages((prev) => [...prev, { role: 'user', parts: [{ kind: 'text', text }] }])
    setInput('')
    setStreaming(true)
    setError(null)
    if (handleRef.current) window.api.chat.send(handleRef.current, text)
    else pendingRef.current = text // process not ready yet — flush on start
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border-weak px-3">
        <button
          onClick={onBack}
          className="no-drag grid size-7 place-items-center rounded-lg text-text-weak hover:bg-surface-weak hover:text-text-strong"
          title={t('transcript.back')}
        >
          <ArrowLeft size={16} />
        </button>
        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-surface-weak text-text-strong">
          <CliIcon cliId={cliId} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-text-strong">
          {resumeId ? t('chat.continued') : t('chat.newChat')}
        </span>
        <button
          onClick={() => onOpenTerminal(sessionRef.current)}
          className="no-drag grid size-7 place-items-center rounded-lg text-text-weak hover:bg-surface-weak hover:text-text-strong"
          title={t('chat.openInTerminal')}
        >
          <SquareTerminal size={15} />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full space-y-5 px-8 py-6 lg:px-16">
          {loadingHistory && (
            <div className="py-6 text-center text-[13px] text-text-weak">{t('transcript.loading')}</div>
          )}
          {!loadingHistory && messages.length === 0 && !error && (
            <div className="py-10 text-center text-[13px] text-text-weak">{t('chat.empty')}</div>
          )}
          <MessageList messages={messages} />
          {streaming && (
            <div className="flex items-center gap-1.5 text-[12px] text-text-weak">
              <span className="size-1.5 animate-pulse rounded-full bg-text-weak" />
              {t('chat.streaming')}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-dashed px-3 py-2 text-[12px]" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-3 pb-4 pt-2">
        <div className="mx-auto w-full lg:max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-border-base bg-surface p-2 shadow-[var(--shadow-composer)] transition-colors focus-within:border-border-selected">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={t('chat.placeholder')}
              className="selectable max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] text-text-strong outline-none placeholder:text-text-weak"
            />
            <button
              onClick={submit}
              disabled={!input.trim() || streaming}
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--button-primary-base)] text-[var(--button-primary-text)] shadow-sm transition-all hover:brightness-110 disabled:opacity-40"
              title={t('chat.send')}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
