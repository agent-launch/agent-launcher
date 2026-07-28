import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJson, withIsolatedHome, writeJson, writeText } from '../helpers/isolated-main'

describe('native config materialization', () => {
  it('writes Codex provider TOML plus auth.json and masks previews', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { addProfile, setAuthMode, setInstallState } = await import('../../src/main/store')
      const { readNativeFiles, writeNativeConfig } = await import('../../src/main/native-config')

      setInstallState('codex', {
        installed: true,
        source: 'sandbox',
        binPath: join(paths.cliInstall('codex'), 'codex')
      })
      addProfile('codex', {
        name: 'Relay "One"',
        providerId: 'custom',
        baseUrl: 'https://relay.example/v1',
        apiKey: 'sk-1234567890',
        model: 'gpt-5'
      })
      writeText(
        join(paths.cliConfig('codex'), 'config.toml'),
        'approval_policy = "on-request"\n[profiles.default]\nfoo = "bar"\n'
      )

      writeNativeConfig('codex')

      const config = readFileSync(join(paths.cliConfig('codex'), 'config.toml'), 'utf8')
      expect(config).toContain('model_provider = "agentlauncher"')
      expect(config).toContain('model = "gpt-5"')
      expect(config).toContain('[profiles.default]')
      expect(config).toContain('[model_providers.agentlauncher]')
      expect(config).toContain('name = "Relay \\"One\\""')
      expect(config).toContain('base_url = "https://relay.example/v1"')
      expect(config).toContain('requires_openai_auth = true')
      expect(config).not.toContain('experimental_bearer_token')
      expect(readJson(join(paths.cliConfig('codex'), 'auth.json'))).toEqual({
        auth_mode: 'apikey',
        OPENAI_API_KEY: 'sk-1234567890'
      })

      const preview = readNativeFiles('codex')
      expect(preview.files.find((file) => file.name === 'auth.json')?.content).toContain('sk-…7890')

      setAuthMode('codex', 'official')
      writeNativeConfig('codex')
      const officialConfig = readFileSync(join(paths.cliConfig('codex'), 'config.toml'), 'utf8')
      expect(officialConfig).toContain('[profiles.default]')
      expect(officialConfig).not.toContain('agentlauncher')
      expect(existsSync(join(paths.cliConfig('codex'), 'auth.json'))).toBe(false)
    })
  })

  it('merges Claude settings without preserving stale managed env vars', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { addProfile, setAuthMode, setInstallState } = await import('../../src/main/store')
      const { writeNativeConfig } = await import('../../src/main/native-config')

      setInstallState('claude-code', {
        installed: true,
        source: 'sandbox',
        binPath: join(paths.cliInstall('claude-code'), 'claude')
      })
      addProfile('claude-code', {
        name: 'Claude Relay',
        baseUrl: 'https://claude.example',
        apiKey: 'sk-claude-1234',
        model: 'sonnet',
        opusModel: 'opus'
      })
      writeJson(join(paths.cliConfig('claude-code'), 'settings.json'), {
        env: {
          KEEP_ME: '1',
          ANTHROPIC_BASE_URL: 'https://old.example',
          ANTHROPIC_API_KEY: 'old'
        }
      })

      writeNativeConfig('claude-code')
      expect(readJson(join(paths.cliConfig('claude-code'), 'settings.json'))).toEqual({
        env: {
          KEEP_ME: '1',
          ANTHROPIC_BASE_URL: 'https://claude.example',
          ANTHROPIC_AUTH_TOKEN: 'sk-claude-1234',
          ANTHROPIC_MODEL: 'sonnet',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'sonnet',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus'
        }
      })

      setAuthMode('claude-code', 'official')
      writeNativeConfig('claude-code')
      expect(readJson(join(paths.cliConfig('claude-code'), 'settings.json'))).toEqual({
        env: { KEEP_ME: '1' }
      })
    })
  })

  it('writes opencode, Pi, and Hermes native files from active profiles', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { addProfile, setInstallState } = await import('../../src/main/store')
      const { readNativeFiles, writeNativeConfig } = await import('../../src/main/native-config')

      setInstallState('opencode', {
        installed: true,
        source: 'sandbox',
        binPath: join(paths.cliInstall('opencode'), 'opencode')
      })
      addProfile('opencode', {
        name: 'Open Relay',
        baseUrl: 'https://open.example/v1',
        apiKey: 'sk-open-1234',
        model: 'gpt-open'
      })
      writeJson(join(paths.cliConfig('opencode'), 'opencode.json'), {
        mcp: { fs: { command: 'node' } }
      })
      writeNativeConfig('opencode')
      const opencode = readJson(join(paths.cliConfig('opencode'), 'opencode.json'))
      expect(opencode.mcp.fs.command).toBe('node')
      expect(opencode.provider.agentlauncher.options).toEqual({
        baseURL: 'https://open.example/v1',
        apiKey: 'sk-open-1234'
      })
      expect(opencode.model).toBe('agentlauncher/gpt-open')

      setInstallState('pi', {
        installed: true,
        source: 'sandbox',
        binPath: join(paths.node, 'bin', 'node'),
        nodeEntry: 'pi.js'
      })
      addProfile('pi', {
        name: 'Pi Relay',
        baseUrl: 'https://pi.example/v1',
        apiKey: 'sk-pi-1234',
        model: 'gpt-pi'
      })
      writeNativeConfig('pi')
      expect(
        readJson(join(paths.cliConfig('pi'), 'models.json')).providers.agentlauncher
      ).toMatchObject({
        baseUrl: 'https://pi.example/v1',
        apiKey: 'sk-pi-1234',
        api: 'openai-completions',
        models: [{ id: 'gpt-pi' }]
      })
      expect(readJson(join(paths.cliConfig('pi'), 'settings.json'))).toEqual({
        defaultProvider: 'agentlauncher',
        defaultModel: 'gpt-pi'
      })

      setInstallState('hermes', {
        installed: true,
        source: 'sandbox',
        binPath: '/usr/local/bin/hermes'
      })
      addProfile('hermes', {
        name: 'Hermes Relay',
        baseUrl: 'https://hermes.example/v1',
        apiKey: 'sk-hermes-1234',
        model: 'gpt-hermes'
      })
      writeText(
        join(paths.cliConfig('hermes'), 'config.yaml'),
        'ui:\n  theme: dark\nmodel:\n  provider: old\n  default: old\n'
      )
      writeNativeConfig('hermes')
      const hermesConfig = readFileSync(join(paths.cliConfig('hermes'), 'config.yaml'), 'utf8')
      expect(hermesConfig).toContain('ui:\n  theme: dark')
      expect(hermesConfig).toContain('provider: custom')
      expect(hermesConfig).toContain('default: "gpt-hermes"')
      expect(hermesConfig).toContain('base_url: "https://hermes.example/v1"')
      expect(readFileSync(join(paths.cliConfig('hermes'), '.env'), 'utf8')).toContain(
        'AGENTLAUNCHER_OPENAI_API_KEY=sk-hermes-1234'
      )
      expect(
        readNativeFiles('hermes').files.find((file) => file.name === '.env')?.content
      ).toContain('sk-…1234')
    })
  })
})
