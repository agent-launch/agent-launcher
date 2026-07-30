import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readJson, withIsolatedHome } from '../helpers/isolated-main'

describe('main store', () => {
  it('creates a complete default config for every supported CLI', async () => {
    await withIsolatedHome(async () => {
      const { loadConfig } = await import('../../src/main/store')
      const cfg = loadConfig()

      expect(cfg.schema).toBe(5)
      expect(Object.keys(cfg.install)).toEqual([
        'claude-code',
        'codex',
        'opencode',
        'pi',
        'hermes',
        'gemini'
      ])
      expect(cfg.clis['claude-code'].authMode).toBe('official')
      expect(cfg.clis.codex.authMode).toBe('official')
      expect(cfg.clis.opencode.authMode).toBe('api')
      expect(cfg.clis.pi.authMode).toBe('api')
      expect(cfg.clis.hermes.authMode).toBe('api')
      expect(cfg.clis.gemini.authMode).toBe('api')
      expect(cfg.resources.codex).toEqual({ prices: [], mcpServers: [], skills: [] })
    })
  })

  it('drops a legacy pinned gemini official profile now that gemini has no OAuth support', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      mkdirSync(dirname(paths.config), { recursive: true })
      writeFileSync(
        paths.config,
        JSON.stringify({
          clis: {
            gemini: {
              profiles: [
                { id: 'official', name: 'Google Official', providerId: 'official', baseUrl: '' }
              ],
              activeProfileId: 'official',
              authMode: 'official'
            }
          },
          prefs: {
            gemini: { officialProfilePinned: true }
          }
        })
      )

      const { loadConfig } = await import('../../src/main/store')
      const cfg = loadConfig()

      expect(cfg.clis.gemini.profiles).toEqual([])
      expect(cfg.clis.gemini.activeProfileId).toBeUndefined()
      expect(cfg.clis.gemini.authMode).toBe('api')
      expect(cfg.prefs.gemini.officialProfilePinned).toBeUndefined()
    })
  })

  it('ignores requests to switch a non-official-auth CLI into official mode', async () => {
    await withIsolatedHome(async () => {
      const { getAuthMode, setAuthMode } = await import('../../src/main/store')

      setAuthMode('gemini', 'official')

      expect(getAuthMode('gemini')).toBe('api')
    })
  })

  it('normalizes legacy RouterLink OpenAI URLs and infers legacy managed installs', async () => {
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

      expect(cfg.install.codex.source).toBe('system')
      expect(cfg.install.codex.legacyManaged).toBe(true)
      expect(cfg.install.pi.source).toBe('system')
      expect(cfg.install.pi.legacyManaged).toBe(false)
      expect(getActiveProfile('codex')?.baseUrl).toBe('https://router-link.world3.ai/api/v1')
      expect(getActiveProfile('claude-code')?.baseUrl).toBe('https://router-link.world3.ai/api')
    })
  })

  it('does not classify sibling path prefixes as legacy managed installs', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { isLegacyManagedInstall } = await import('../../src/main/store')

      expect(
        isLegacyManagedInstall({
          installed: true,
          binPath: join(`${paths.root}-backup`, 'cli', 'codex')
        })
      ).toBe(false)
      expect(
        isLegacyManagedInstall({ installed: true, binPath: join(paths.root, 'cli', 'codex') })
      ).toBe(true)
    })
  })

  it('clears a persisted macOS launch block until detection confirms it again', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      mkdirSync(dirname(paths.config), { recursive: true })
      writeFileSync(
        paths.config,
        JSON.stringify({
          install: {
            codex: {
              installed: true,
              source: 'system',
              version: '0.144.5',
              binPath: '/usr/local/bin/codex',
              launchBlockedReason: 'macos-security'
            }
          }
        })
      )

      const { loadConfig } = await import('../../src/main/store')

      expect(loadConfig().install.codex.launchBlockedReason).toBeUndefined()
    })
  })

  it('keeps official-login profiles pinned only when the user requests them', async () => {
    await withIsolatedHome(async () => {
      const { addProfile, getActiveProfile, getAuthMode, loadConfig, setAuthMode } =
        await import('../../src/main/store')

      setAuthMode('codex', 'official')
      expect(getAuthMode('codex')).toBe('official')
      expect(getActiveProfile('codex')).toMatchObject({ id: 'official', name: 'OpenAI Official' })
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

      store.addProfile('opencode', {
        name: 'OpenRouter',
        providerId: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1'
      })
      const profile = store.getActiveProfile('opencode')
      expect(profile?.name).toBe('OpenRouter')

      store.updateProfile('opencode', profile!.id, { model: 'openai/gpt-4.1' })
      expect(store.getActiveProfile('opencode')?.model).toBe('openai/gpt-4.1')

      store.setYolo('opencode', true)
      expect(store.getPrefs('opencode').yolo).toBe(true)

      store.setUsageTrackingEnabled('gemini', true)
      expect(store.getPrefs('gemini').usageTrackingEnabled).toBe(true)

      let cfg = store.addPriceEntry('opencode', {
        provider: 'OpenRouter',
        model: 'gpt',
        inputPerMillion: 1
      })
      const priceId = cfg.resources.opencode.prices[0].id
      cfg = store.updatePriceEntry('opencode', priceId, { outputPerMillion: 2 })
      expect(cfg.resources.opencode.prices[0]).toMatchObject({
        name: 'Untitled price',
        currency: 'USD',
        outputPerMillion: 2
      })
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
      expect(cfg.resources.opencode.skills[0]).toMatchObject({
        name: 'Untitled Skill',
        enabled: true,
        description: 'Useful'
      })
      cfg = store.deleteSkillEntry('opencode', skillId)
      expect(cfg.resources.opencode.skills).toEqual([])

      const { paths } = await import('../../src/main/sandbox')
      const saved = readJson(paths.config)
      expect(saved.prefs.opencode.yolo).toBe(true)
    })
  })
})
