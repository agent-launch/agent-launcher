import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 360
export const SIDEBAR_COLLAPSED = 56

interface AppState {
  /** True once the user has finished OR skipped the first-run wizard. */
  onboarded: boolean
  /** Which CLI is currently selected in the main shell. */
  activeCli: string
  /** Expanded sidebar width in px. */
  sidebarWidth: number
  /** Collapsed = icon-only rail. */
  sidebarCollapsed: boolean
  completeOnboarding: () => void
  skipOnboarding: () => void
  /** Dev helper — re-trigger the wizard. */
  resetOnboarding: () => void
  setActiveCli: (id: string) => void
  setSidebarWidth: (w: number) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (c: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      onboarded: false,
      activeCli: 'claude-code',
      sidebarWidth: 240,
      sidebarCollapsed: false,
      completeOnboarding: () => set({ onboarded: true }),
      skipOnboarding: () => set({ onboarded: true }),
      resetOnboarding: () => set({ onboarded: false }),
      setActiveCli: (id) => set({ activeCli: id }),
      setSidebarWidth: (w) => set({ sidebarWidth: Math.round(w) }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (c) => set({ sidebarCollapsed: c })
    }),
    {
      name: 'agent-launcher:app',
      partialize: (s) => ({
        onboarded: s.onboarded,
        activeCli: s.activeCli,
        sidebarWidth: s.sidebarWidth,
        sidebarCollapsed: s.sidebarCollapsed
      })
    }
  )
)
