import { describe, expect, it, vi } from 'vitest'
import { createMemoryStorage } from '../helpers/isolated-main'
import type { CliId } from '../../src/shared/types'

describe('renderer static data and persisted app store', () => {
  it('keeps CLI and provider catalogs aligned with the shared CLI union', async () => {
    const { CLIS, YOLO_SUPPORT } = await import('../../src/renderer/src/data/clis')
    const { PROVIDERS_BY_CLI } = await import('../../src/renderer/src/data/providers')
    const ids = CLIS.map((cli) => cli.id as CliId)

    expect(ids).toEqual(['claude-code', 'codex', 'opencode', 'pi', 'hermes'])
    expect(Object.keys(PROVIDERS_BY_CLI)).toEqual(ids)
    expect(Object.keys(YOLO_SUPPORT)).toEqual(ids)
    expect(PROVIDERS_BY_CLI.codex[0]).toMatchObject({
      id: 'routerlink',
      baseUrl: 'https://router-link.world3.ai/api/v1'
    })
    expect(PROVIDERS_BY_CLI['claude-code'].slice(-3).map((provider) => provider.id)).toEqual(['siliconflow', 'openrouter', 'custom'])
    expect(PROVIDERS_BY_CLI.codex.slice(-3).map((provider) => provider.id)).toEqual(['siliconflow', 'openrouter', 'custom'])
    expect(PROVIDERS_BY_CLI.pi).toBe(PROVIDERS_BY_CLI.codex)
    expect(PROVIDERS_BY_CLI.hermes).toBe(PROVIDERS_BY_CLI.codex)
    expect(YOLO_SUPPORT.opencode.supported).toBe(false)
    expect(YOLO_SUPPORT.pi.supported).toBe(false)
    expect(YOLO_SUPPORT.hermes.note).toBe('--yolo')
  })

  it('clamps sidebar state and persists only durable app preferences', async () => {
    vi.resetModules()
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { localStorage: storage })
    try {
      const { SIDEBAR_MAX, SIDEBAR_MIN, useAppStore } = await import('../../src/renderer/src/store/app')
      const { createJSONStorage } = await import('zustand/middleware')
      const store = useAppStore
      ;(store as any).persist.setOptions({ storage: createJSONStorage(() => storage) })

      expect(store.getState()).toMatchObject({
        onboarded: false,
        activeCli: 'claude-code',
        sidebarWidth: 220,
        sidebarCollapsed: false,
        shellView: 'run'
      })

      store.getState().setSidebarWidth(999)
      expect(store.getState().sidebarWidth).toBe(SIDEBAR_MAX)
      store.getState().setSidebarWidth(1)
      expect(store.getState().sidebarWidth).toBe(SIDEBAR_MIN)
      store.getState().toggleSidebar()
      store.getState().setActiveCli('hermes')
      store.getState().setThemeMode('dark')
      store.getState().setLocaleMode('en')
      store.getState().setRenderTranscript(true)
      store.getState().setShellView('settings')

      const persisted = JSON.parse(localStorage.getItem('agent-launcher:app') ?? '{}')
      expect(persisted.state).toMatchObject({
        activeCli: 'hermes',
        sidebarCollapsed: true,
        themeMode: 'dark',
        localeMode: 'en',
        renderTranscript: true
      })
      expect(persisted.state.shellView).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  it('translates with placeholders and falls back predictably', async () => {
    vi.resetModules()
    vi.stubGlobal('localStorage', createMemoryStorage())
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    try {
      const { resolveLocale, systemLocale, translate } = await import('../../src/renderer/src/i18n')

      expect(systemLocale()).toBe('zh')
      expect(resolveLocale('system')).toBe('zh')
      expect(resolveLocale('en')).toBe('en')
      expect(translate('zh', 'shell.openAgentSettings', { name: 'Codex' })).toBe('打开 Codex 设置')
      expect(translate('en', 'missing.key')).toBe('missing.key')
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})
