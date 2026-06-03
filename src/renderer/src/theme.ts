import { useEffect } from 'react'
import { useAppStore, type ThemeMode } from '@/store/app'

const STORAGE_KEY = 'agent-launcher:app'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Resolve a mode to the concrete theme to apply. */
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
  }
  return mode
}

/** Set the data-theme attribute that tokens.css keys off. */
function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode)
}

/**
 * Apply the persisted theme before React mounts so there's no light-flash.
 * Reads the same localStorage key Zustand's persist middleware writes.
 */
export function bootstrapTheme(): void {
  let mode: ThemeMode = 'system'
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const saved = raw ? JSON.parse(raw)?.state?.themeMode : null
    if (saved === 'light' || saved === 'dark' || saved === 'system') mode = saved
  } catch {
    /* corrupt storage — fall back to system */
  }
  applyTheme(mode)
}

/**
 * Keep <html data-theme> in sync with the store: re-applies on themeMode change,
 * and (when following the system) on OS appearance changes.
 */
export function useTheme(): void {
  const mode = useAppStore((s) => s.themeMode)
  useEffect(() => {
    applyTheme(mode)
    if (mode !== 'system') return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])
}
