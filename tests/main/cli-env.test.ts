import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withIsolatedHome } from '../helpers/isolated-main'

describe('CLI environment builder', () => {
  it('isolates sandbox installs and clears inherited managed auth vars', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { addProfile, setInstallState } = await import('../../src/main/store')
      const { buildCliEnv, resolvedEnvPreview } = await import('../../src/main/cli-env')
      const previous = { ...process.env }

      try {
        process.env.PATH = ['/custom/bin', '/usr/bin'].join(delimiter)
        process.env.ANTHROPIC_API_KEY = 'leaked-anthropic'
        process.env.OPENAI_API_KEY = 'leaked-openai'
        process.env.OPENAI_BASE_URL = 'https://leaked.example'

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
          haikuModel: 'haiku'
        })

        const claudeEnv = buildCliEnv('claude-code')
        expect(claudeEnv.CLAUDE_CONFIG_DIR).toBe(paths.cliConfig('claude-code'))
        expect(claudeEnv.ANTHROPIC_API_KEY).toBeUndefined()
        expect(claudeEnv.ANTHROPIC_BASE_URL).toBe('https://claude.example')
        expect(claudeEnv.ANTHROPIC_AUTH_TOKEN).toBe('sk-claude-1234')
        expect(claudeEnv.ANTHROPIC_MODEL).toBe('sonnet')
        expect(claudeEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('haiku')
        const nodeBinDir = process.platform === 'win32' ? paths.node : join(paths.node, 'bin')
        expect(claudeEnv.PATH?.split(delimiter)[0]).toBe(nodeBinDir)
        expect(resolvedEnvPreview('claude-code')).toContainEqual({
          key: 'ANTHROPIC_AUTH_TOKEN',
          value: 'sk-…1234',
          secret: true
        })

        setInstallState('codex', {
          installed: true,
          source: 'sandbox',
          binPath: join(paths.cliInstall('codex'), 'codex')
        })
        addProfile('codex', {
          name: 'Codex Relay',
          baseUrl: 'https://codex.example/v1',
          apiKey: 'sk-codex',
          model: 'gpt-5'
        })
        const codexEnv = buildCliEnv('codex')
        expect(codexEnv.OPENAI_API_KEY).toBeUndefined()
        expect(codexEnv.OPENAI_BASE_URL).toBeUndefined()
        expect(codexEnv.CODEX_HOME).toBe(paths.cliConfig('codex'))

        setInstallState('opencode', {
          installed: true,
          source: 'sandbox',
          binPath: join(paths.cliInstall('opencode'), 'opencode')
        })
        const opencodeEnv = buildCliEnv('opencode')
        expect(opencodeEnv.XDG_CONFIG_HOME).toBe(join(paths.cliConfig('opencode'), 'xdg-config'))
        expect(opencodeEnv.OPENCODE_CONFIG).toBe(join(paths.cliConfig('opencode'), 'opencode.json'))

        setInstallState('pi', {
          installed: true,
          source: 'sandbox',
          binPath: join(paths.node, 'bin', 'node'),
          nodeEntry: 'pi.js'
        })
        expect(buildCliEnv('pi').PI_CODING_AGENT_DIR).toBe(paths.cliConfig('pi'))
      } finally {
        process.env = previous
      }
    })
  })

  it('injects gemini relay env vars even from a legacy on-disk authMode of official', async () => {
    await withIsolatedHome(async () => {
      const { dirname } = await import('node:path')
      const { mkdirSync, writeFileSync } = await import('node:fs')
      const { paths } = await import('../../src/main/sandbox')
      mkdirSync(dirname(paths.config), { recursive: true })
      writeFileSync(
        paths.config,
        JSON.stringify({
          clis: {
            gemini: {
              profiles: [
                {
                  id: 'p1',
                  name: 'Gemini Relay',
                  providerId: 'custom',
                  baseUrl: 'https://gemini.example/v1',
                  apiKey: 'sk-gemini'
                }
              ],
              activeProfileId: 'p1',
              authMode: 'official'
            }
          }
        })
      )

      const { buildCliEnv } = await import('../../src/main/cli-env')
      const geminiEnv = buildCliEnv('gemini')
      expect(geminiEnv.GOOGLE_GEMINI_BASE_URL).toBe('https://gemini.example/v1')
      expect(geminiEnv.GEMINI_API_KEY).toBe('sk-gemini')
    })
  })

  it('keeps system installs on system config locations', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { setInstallState } = await import('../../src/main/store')
      const { buildCliEnv } = await import('../../src/main/cli-env')

      setInstallState('opencode', {
        installed: true,
        source: 'system',
        binPath: '/usr/local/bin/opencode'
      })
      expect(buildCliEnv('opencode').OPENCODE_CONFIG).toBeUndefined()

      setInstallState('hermes', {
        installed: true,
        source: 'system',
        binPath: '/usr/local/bin/hermes'
      })
      expect(buildCliEnv('hermes').HERMES_HOME).toBe(join(home, '.hermes'))
    })
  })
})
