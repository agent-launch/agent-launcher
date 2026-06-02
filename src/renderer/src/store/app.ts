import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AppState {
  /** True once the user has finished OR skipped the first-run wizard. */
  onboarded: boolean
  /** Which CLI is currently selected in the main shell. */
  activeCli: string
  completeOnboarding: () => void
  skipOnboarding: () => void
  /** Dev helper — re-trigger the wizard. */
  resetOnboarding: () => void
  setActiveCli: (id: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      onboarded: false,
      activeCli: 'claude-code',
      completeOnboarding: () => set({ onboarded: true }),
      skipOnboarding: () => set({ onboarded: true }),
      resetOnboarding: () => set({ onboarded: false }),
      setActiveCli: (id) => set({ activeCli: id })
    }),
    {
      name: 'agent-launcher:app',
      // Only persist the first-run flag + last-selected CLI.
      partialize: (s) => ({ onboarded: s.onboarded, activeCli: s.activeCli })
    }
  )
)
