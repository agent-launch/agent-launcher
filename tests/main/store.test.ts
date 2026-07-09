import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readJson, withIsolatedHome } from '../helpers/isolated-main'

describe('main store', () => {
  it('creates a complete default config for every supported CLI', async () => {
    await withIsolatedHome(async () => {
      const { loadConfig } = await import('../../src/main/store')
      const cfg = loadConfig()

      expect(cfg.schema).toBe(4)
      expect(Object.keys(cfg.install)).toEqual(['claude-code', 'codex', 'opencode', 'pi', 'hermes'])
      expect(cfg.clis['claude-code'].authMode).toBe('official')
      expect(cfg.clis.codex.authMode).toBe('official')
      expect(cfg.clis.opencode.authMode).toBe('api')
      expect(cfg.clis.pi.authMode).toBe('api')
      expect(cfg.clis.hermes.authMode).toBe('api')
      expect(cfg.resources.codex).toEqual({ prices: [], mcpServers: [], skills: [] })
    })
  })

  it('normalizes legacy RouterLink OpenAI URLs and infers install source', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      mkdirSync(dirname(paths.config), { recursive: true })
      writeFileSync(
        paths.config,
        JSON.stringify({
          install: {
            codex: { installed: true, binPath: join(paths.cliInstall('codex'), 'bin', 'codex') },
            pi: { installed: true, binPath: '/usr/local/bin/pi' }
          },
          clis: {
            codex: {
              providerId: 'routerlink',
              baseUrl: 'https://router-link.world3.ai/api',
              apiKey: 'sk-old',
              model: 'gpt-5'
            },
            'claude-code': {
              providerId: 'routerlink',
              baseUrl: 'https://router-link.world3.ai/api',
              apiKey: 'sk-claude'
            }
          }
        })
      )

      const { getActiveProfile, loadConfig } = await import('../../src/main/store')
      const cfg = loadConfig()

      expect(cfg.install.codex.source).toBe('sandbox')
      expect(cfg.install.pi.source).toBe('system')
      expect(getActiveProfile('codex')?.baseUrl).toBe('https://router-link.world3.ai/api/v1')
      expect(getActiveProfile('claude-code')?.baseUrl).toBe('https://router-link.world3.ai/api')
    })
  })

  it('keeps official-login profiles pinned only when the user requests them', async () => {
    await withIsolatedHome(async () => {
      const { addProfile, getActiveProfile, getAuthMode, loadConfig, setAuthMode } = await import('../../src/main/store')

      setAuthMode('codex', 'official')
      expect(getAuthMode('codex')).toBe('official')
      expect(getActiveProfile('codex')).toMatchObject({ id: 'official', name: 'OpenAI 官方' })
      expect(loadConfig().prefs.codex.officialProfilePinned).toBe(true)

      addProfile('codex', {
        name: 'Relay',
        providerId: 'routerlink',
        baseUrl: 'https://router-link.world3.ai/api/',
        apiKey: 'sk-relay'
      })
      expect(getAuthMode('codex')).toBe('api')
      expect(getActiveProfile('codex')).toMatchObject({
        name: 'Relay',
        baseUrl: 'https://router-link.world3.ai/api/v1'
      })

      setAuthMode('codex', 'official')
      expect(getAuthMode('codex')).toBe('official')
      expect(getActiveProfile('codex')?.id).toBe('official')
    })
  })

  it('persists profile, preference, and resource CRUD operations', async () => {
    await withIsolatedHome(async () => {
      const store = await import('../../src/main/store')

      store.addProfile('opencode', { name: 'OpenRouter', providerId: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' })
      const profile = store.getActiveProfile('opencode')
      expect(profile?.name).toBe('OpenRouter')

      store.updateProfile('opencode', profile!.id, { model: 'openai/gpt-4.1' })
      expect(store.getActiveProfile('opencode')?.model).toBe('openai/gpt-4.1')

      store.setYolo('opencode', true)
      expect(store.getPrefs('opencode').yolo).toBe(true)

      let cfg = store.addPriceEntry('opencode', { provider: 'OpenRouter', model: 'gpt', inputPerMillion: 1 })
      const priceId = cfg.resources.opencode.prices[0].id
      cfg = store.updatePriceEntry('opencode', priceId, { outputPerMillion: 2 })
      expect(cfg.resources.opencode.prices[0]).toMatchObject({ name: '未命名价格', currency: 'USD', outputPerMillion: 2 })
      cfg = store.deletePriceEntry('opencode', priceId)
      expect(cfg.resources.opencode.prices).toEqual([])

      cfg = store.addMcpEntry('opencode', { name: 'fs', command: 'node', args: 'server.js' })
      const mcpId = cfg.resources.opencode.mcpServers[0].id
      cfg = store.updateMcpEntry('opencode', mcpId, { enabled: false })
      expect(cfg.resources.opencode.mcpServers[0].enabled).toBe(false)
      cfg = store.deleteMcpEntry('opencode', mcpId)
      expect(cfg.resources.opencode.mcpServers).toEqual([])

      cfg = store.addSkillEntry('opencode', { source: 'local' })
      const skillId = cfg.resources.opencode.skills[0].id
      cfg = store.updateSkillEntry('opencode', skillId, { description: 'Useful' })
      expect(cfg.resources.opencode.skills[0]).toMatchObject({ name: '未命名 Skill', enabled: true, description: 'Useful' })
      cfg = store.deleteSkillEntry('opencode', skillId)
      expect(cfg.resources.opencode.skills).toEqual([])

      const { paths } = await import('../../src/main/sandbox')
      const saved = readJson(paths.config)
      expect(saved.prefs.opencode.yolo).toBe(true)
    })
  })
})
