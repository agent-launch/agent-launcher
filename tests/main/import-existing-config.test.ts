import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withIsolatedHome, writeJson, writeText } from '../helpers/isolated-main'

describe('system config import', () => {
  it('imports one existing API profile per CLI and marks each CLI checked', async () => {
    await withIsolatedHome(async ({ home }) => {
      writeJson(join(home, '.claude', 'settings.json'), {
        env: {
          ANTHROPIC_BASE_URL: 'https://claude.example',
          ANTHROPIC_AUTH_TOKEN: 'sk-claude',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet'
        }
      })
      writeText(
        join(home, '.codex', 'config.toml'),
        'model_provider = "relay"\nmodel = "gpt-5"\n\n[model_providers.relay]\nbase_url = "https://codex.example/v1"\n'
      )
      writeJson(join(home, '.codex', 'auth.json'), { OPENAI_API_KEY: 'sk-codex' })
      writeJson(join(home, '.config', 'opencode', 'opencode.json'), {
        model: 'relay/gpt-open',
        provider: {
          relay: {
            name: 'Open Relay',
            options: { baseURL: 'https://open.example/v1', apiKey: 'sk-open' },
            models: { 'gpt-open': {} }
          }
        }
      })
      writeJson(join(home, '.pi', 'agent', 'models.json'), {
        providers: {
          relay: {
            baseUrl: 'https://pi.example/v1',
            apiKey: 'sk-pi',
            models: [{ id: 'gpt-pi' }]
          }
        }
      })
      writeJson(join(home, '.pi', 'agent', 'settings.json'), {
        defaultProvider: 'relay',
        defaultModel: 'gpt-pi-default'
      })
      writeText(
        join(home, '.hermes', 'config.yaml'),
        'model:\n  provider: custom\n  default: "gpt-hermes"\n  base_url: "https://hermes.example/v1"\n  api_key: "${HERMES_KEY}"\n'
      )
      writeText(join(home, '.hermes', '.env'), 'HERMES_KEY=sk-hermes\n')

      const { ensureSystemConfigImported } = await import('../../src/main/import-existing-config')
      const { loadConfig } = await import('../../src/main/store')

      ensureSystemConfigImported()
      ensureSystemConfigImported()

      const cfg = loadConfig()
      expect(cfg.clis['claude-code'].profiles).toHaveLength(1)
      expect(cfg.clis['claude-code'].profiles[0]).toMatchObject({
        name: '本机默认配置',
        baseUrl: 'https://claude.example',
        apiKey: 'sk-claude',
        sonnetModel: 'claude-sonnet'
      })
      expect(cfg.clis.codex.profiles).toHaveLength(1)
      expect(cfg.clis.codex.profiles[0]).toMatchObject({
        baseUrl: 'https://codex.example/v1',
        apiKey: 'sk-codex',
        model: 'gpt-5'
      })
      expect(cfg.clis.opencode.profiles[0]).toMatchObject({
        name: 'Open Relay',
        baseUrl: 'https://open.example/v1',
        apiKey: 'sk-open',
        model: 'gpt-open'
      })
      expect(cfg.clis.pi.profiles[0]).toMatchObject({
        baseUrl: 'https://pi.example/v1',
        apiKey: 'sk-pi',
        model: 'gpt-pi-default'
      })
      expect(cfg.clis.hermes.profiles[0]).toMatchObject({
        name: '本机 Hermes 配置',
        baseUrl: 'https://hermes.example/v1',
        apiKey: 'sk-hermes',
        model: 'gpt-hermes'
      })
      expect(Object.values(cfg.prefs).every((prefs) => prefs.systemConfigImportChecked)).toBe(true)
    })
  })
})
