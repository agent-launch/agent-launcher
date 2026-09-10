import { useAppStore, type LocaleMode } from '@/store/app'
import { messages } from './messages'

export type Locale = 'zh' | 'en'

type Params = Record<string, string | number>
export type TFunc = (key: string, params?: Params) => string

/** Resolve the OS locale. Read once — it doesn't change at runtime. */
export function systemLocale(): Locale {
  const lang = (navigator.language || 'en').toLowerCase()
  return lang.startsWith('zh') ? 'zh' : 'en'
}

export function resolveLocale(mode: LocaleMode): Locale {
  return mode === 'system' ? systemLocale() : mode
}

/** Look up a key, falling back to zh then the raw key; substitute {placeholders}. */
export function translate(locale: Locale, key: string, params?: Params): string {
  let str = messages[locale]?.[key] ?? messages.zh[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return str
}

/**
 * Translation hook. Re-renders the component when the user changes language
 * (Zustand subscription on localeMode).
 */
export function useT(): TFunc {
  const mode = useAppStore((s) => s.localeMode)
  const locale = resolveLocale(mode)
  return (key, params) => translate(locale, key, params)
}
