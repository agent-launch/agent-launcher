import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withIsolatedHome } from '../helpers/isolated-main'

describe('CLI environment builder', () => {
  it('clears inherited managed auth vars and injects relay/model env vars', async () => {
    await withIsolatedHome(async ({ home }) => {
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
        expect(claudeEnv.CLAUDE_CONFIG_DIR).toBeUndefined()
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
          binPath: '/usr/local/bin/codex'
        })
        const codexEnv = buildCliEnv('codex')
        expect(codexEnv.OPENAI_API_KEY).toBeUndefined()
        expect(codexEnv.OPENAI_BASE_URL).toBeUndefined()
        expect(codexEnv.CODEX_HOME).toBeUndefined()

        setInstallState('opencode', {
          installed: true,
          binPath: '/usr/local/bin/opencode'
        })
        const opencodeEnv = buildCliEnv('opencode')
        expect(opencodeEnv.XDG_CONFIG_HOME).toBe(join(home, '.config'))
        expect(opencodeEnv.XDG_CONFIG_HOME).not.toContain(paths.cliConfig('opencode'))
        expect(opencodeEnv.OPENCODE_CONFIG).toBeUndefined()

        setInstallState('pi', {
          installed: true,
          binPath: '/usr/local/bin/pi'
        })
        expect(buildCliEnv('pi').PI_CODING_AGENT_DIR).toBeUndefined()
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
      expect(geminiEnv.GEMINI_CLI_HOME).toBeUndefined()
      expect(geminiEnv.GOOGLE_GEMINI_BASE_URL).toBe('https://gemini.example/v1')
      expect(geminiEnv.GEMINI_API_KEY).toBe('sk-gemini')
    })
  })

  it('only injects gemini telemetry env vars when usage tracking is opted in', async () => {
    await withIsolatedHome(async () => {
      const { setUsageTrackingEnabled } = await import('../../src/main/store')
      const { buildCliEnv } = await import('../../src/main/cli-env')
      const { geminiUsageLogPath } = await import('../../src/main/config-paths')

      const offEnv = buildCliEnv('gemini')
      expect(offEnv.GEMINI_TELEMETRY_ENABLED).toBeUndefined()
      expect(offEnv.GEMINI_TELEMETRY_OUTFILE).toBeUndefined()

      setUsageTrackingEnabled('gemini', true)
      const onEnv = buildCliEnv('gemini')
      expect(onEnv.GEMINI_TELEMETRY_ENABLED).toBe('true')
      expect(onEnv.GEMINI_TELEMETRY_TARGET).toBe('local')
      expect(onEnv.GEMINI_TELEMETRY_OUTFILE).toBe(geminiUsageLogPath())
    })
  })

  it('sets HERMES_HOME for hermes installs', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { setInstallState } = await import('../../src/main/store')
      const { buildCliEnv } = await import('../../src/main/cli-env')

      setInstallState('hermes', {
        installed: true,
        binPath: '/usr/local/bin/hermes'
      })
      expect(buildCliEnv('hermes').HERMES_HOME).toBe(join(home, '.hermes'))
    })
  })
})
