import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 240
export const SIDEBAR_COLLAPSED = 56

/** Appearance preference; 'system' follows the OS prefers-color-scheme. */
export type ThemeMode = 'system' | 'light' | 'dark'
/** Language preference; 'system' follows the OS locale. */
export type LocaleMode = 'system' | 'zh' | 'en'
export type ShellView = 'run' | 'config' | 'settings'

interface AppState {
  /** True once the user has finished OR skipped the first-run wizard. */
  onboarded: boolean
  /** Which CLI is currently selected in the main shell. */
  activeCli: string
  /** Expanded sidebar width in px. */
  sidebarWidth: number
  /** Collapsed = icon-only rail. */
  sidebarCollapsed: boolean
  /** Light/dark/system appearance preference. */
  themeMode: ThemeMode
  /** zh/en/system language preference. */
  localeMode: LocaleMode
  /** Render a session's chat history in-UI on click (vs. straight to terminal). */
  renderTranscript: boolean
  /** Current shell view; transient UI state used by window chrome. */
  shellView: ShellView
  completeOnboarding: () => void
  skipOnboarding: () => void
  /** Dev helper — re-trigger the wizard. */
  resetOnboarding: () => void
  setActiveCli: (id: string) => void
  setSidebarWidth: (w: number) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (c: boolean) => void
  setThemeMode: (m: ThemeMode) => void
  setLocaleMode: (m: LocaleMode) => void
  setRenderTranscript: (on: boolean) => void
  setShellView: (view: ShellView) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      onboarded: false,
      activeCli: 'claude-code',
      sidebarWidth: 220,
      sidebarCollapsed: false,
      themeMode: 'system',
      localeMode: 'system',
      renderTranscript: false,
      shellView: 'run',
      completeOnboarding: () => set({ onboarded: true }),
      skipOnboarding: () => set({ onboarded: true }),
      resetOnboarding: () => set({ onboarded: false }),
      setActiveCli: (id) => set({ activeCli: id }),
      setSidebarWidth: (w) => set({ sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w))) }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (c) => set({ sidebarCollapsed: c }),
      setThemeMode: (m) => set({ themeMode: m }),
      setLocaleMode: (m) => set({ localeMode: m }),
      setRenderTranscript: (on) => set({ renderTranscript: on }),
      setShellView: (view) => set({ shellView: view })
    }),
    {
      name: 'agent-launcher:app',
      partialize: (s) => ({
        onboarded: s.onboarded,
        activeCli: s.activeCli,
        sidebarWidth: s.sidebarWidth,
        sidebarCollapsed: s.sidebarCollapsed,
        themeMode: s.themeMode,
        localeMode: s.localeMode,
        renderTranscript: s.renderTranscript
      })
    }
  )
)
