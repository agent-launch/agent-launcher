import { create } from 'zustand'
import type { CliId } from '@shared/types'

export interface TermSession {
  id: string
  cliId: CliId
  mode: 'cli' | 'shell'
  cwd?: string
  label: string
  createdAt: number
  status: 'running' | 'exited'
  exitCode?: number
}

interface SessionState {
  sessions: TermSession[]
  add: (s: Omit<TermSession, 'id' | 'createdAt' | 'status'>) => TermSession
  setStatus: (id: string, status: 'running' | 'exited', exitCode?: number) => void
  remove: (id: string) => void
  forCli: (cliId: CliId) => TermSession[]
}

let seq = 0
const newId = () => `s${Date.now().toString(36)}${(seq += 1)}`

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  add: (partial) => {
    const s: TermSession = { ...partial, id: newId(), createdAt: Date.now(), status: 'running' }
    set((st) => ({ sessions: [s, ...st.sessions] }))
    return s
  },
  setStatus: (id, status, exitCode) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, status, exitCode } : s))
    })),
  remove: (id) => set((st) => ({ sessions: st.sessions.filter((s) => s.id !== id) })),
  forCli: (cliId) => get().sessions.filter((s) => s.cliId === cliId)
}))
