import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJson, withIsolatedHome, writeJson, writeText } from '../helpers/isolated-main'

describe('installed MCP and Skill resources', () => {
  it('manages JSON MCP files for Claude Code sandbox config', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { setInstallState } = await import('../../src/main/store')
      const { addInstalledMcp, deleteInstalledMcp, updateInstalledMcp } = await import('../../src/main/installed-resources')

      setInstallState('claude-code', { installed: true, source: 'sandbox', binPath: join(paths.cliInstall('claude-code'), 'claude') })
      let entries = addInstalledMcp('claude-code', {
        name: 'fs',
        enabled: false,
        command: 'node',
        args: '"server pkg" --flag',
        env: 'TOKEN=abc\nEMPTY='
      })

      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        cliId: 'claude-code',
        name: 'fs',
        enabled: false,
        transport: 'stdio',
        command: 'node',
        args: 'server pkg --flag',
        env: 'TOKEN=abc\nEMPTY='
      })

      entries = updateInstalledMcp('claude-code', entries[0].id, {
        name: 'remote',
        transport: 'http',
        url: 'https://mcp.example/api',
        env: ''
      })
      expect(entries[0]).toMatchObject({ name: 'remote', transport: 'http', url: 'https://mcp.example/api' })
      expect(readJson(join(paths.cliConfig('claude-code'), '.claude.json')).mcpServers.remote.url).toBe('https://mcp.example/api')

      entries = deleteInstalledMcp('claude-code', entries[0].id)
      expect(entries).toEqual([])
    })
  })

  it('manages Codex TOML MCP blocks and lists plugin-bundled MCP servers as read-only', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { paths } = await import('../../src/main/sandbox')
      const { setInstallState } = await import('../../src/main/store')
      const { addInstalledMcp, deleteInstalledMcp, listInstalledMcp, updateInstalledMcp } = await import('../../src/main/installed-resources')

      setInstallState('codex', { installed: true, source: 'sandbox', binPath: join(paths.cliInstall('codex'), 'codex') })
      writeText(join(paths.cliConfig('codex'), 'config.toml'), '')
      let entries = addInstalledMcp('codex', { name: 'my.server', command: 'node', args: 'server.js --flag', env: 'A=1' })
      expect(entries[0]).toMatchObject({ name: 'my.server', command: 'node', args: 'server.js --flag', configKind: 'codex-toml' })
      expect(readFileSync(join(paths.cliConfig('codex'), 'config.toml'), 'utf8')).toContain('[mcp_servers."my.server"]')

      entries = updateInstalledMcp('codex', entries[0].id, { name: 'renamed', command: 'npx', args: '@pkg/server' })
      expect(entries[0]).toMatchObject({ name: 'renamed', command: 'npx', args: '@pkg/server' })
      entries = deleteInstalledMcp('codex', entries[0].id)
      expect(entries).toEqual([])

      const pluginRoot = join(home, 'marketplace')
      writeJson(join(pluginRoot, 'plugins', 'browser', '.codex-plugin', 'plugin.json'), { mcpServers: 'servers.json' })
      writeJson(join(pluginRoot, 'plugins', 'browser', 'servers.json'), {
        mcpServers: {
          browser: { command: 'node', args: ['server.js'] }
        }
      })
      writeText(
        join(paths.cliConfig('codex'), 'config.toml'),
        `[marketplaces.local]\nsource_type = "local"\nsource = "${pluginRoot}"\n\n[plugins."browser@local"]\nenabled = true\n`
      )

      const pluginEntries = listInstalledMcp('codex')
      expect(pluginEntries).toHaveLength(1)
      expect(pluginEntries[0]).toMatchObject({
        name: 'browser',
        readOnly: true,
        configKind: 'codex-plugin',
        command: 'node',
        args: 'server.js'
      })
      expect(() => updateInstalledMcp('codex', pluginEntries[0].id, { name: 'nope' })).toThrow('managed by a plugin')

      // Toggling a plugin server makes Codex materialize a same-name override
      // in config.toml — the list must dedupe to the toml entry only.
      writeText(
        join(paths.cliConfig('codex'), 'config.toml'),
        `[marketplaces.local]\nsource_type = "local"\nsource = "${pluginRoot}"\n\n[plugins."browser@local"]\nenabled = true\n\n[mcp_servers.browser]\ncommand = "node"\nargs = ["server.js"]\ndisabled = true\n`
      )
      const deduped = listInstalledMcp('codex')
      expect(deduped).toHaveLength(1)
      expect(deduped[0]).toMatchObject({ name: 'browser', enabled: false, configKind: 'codex-toml' })
    })
  })

  it('manages Hermes YAML MCP servers', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { setInstallState } = await import('../../src/main/store')
      const { addInstalledMcp, deleteInstalledMcp, updateInstalledMcp } = await import('../../src/main/installed-resources')

      setInstallState('hermes', { installed: true, source: 'sandbox', binPath: '/usr/local/bin/hermes' })
      let entries = addInstalledMcp('hermes', { name: 'search', transport: 'http', url: 'https://mcp.example/search', env: 'TOKEN=abc' })
      expect(entries[0]).toMatchObject({ name: 'search', supportsEnabled: false, transport: 'http', url: 'https://mcp.example/search' })
      expect(readFileSync(join(paths.cliConfig('hermes'), 'config.yaml'), 'utf8')).toContain('mcp_servers:')

      entries = updateInstalledMcp('hermes', entries[0].id, { name: 'local', transport: 'stdio', command: 'python', args: '-m server' })
      expect(entries[0]).toMatchObject({ name: 'local', transport: 'stdio', command: 'python', args: '-m server' })

      entries = deleteInstalledMcp('hermes', entries[0].id)
      expect(entries).toEqual([])
    })
  })

  it('lists, reads, updates, and deletes local Skill files safely', async () => {
    await withIsolatedHome(async () => {
      const { paths } = await import('../../src/main/sandbox')
      const { setInstallState } = await import('../../src/main/store')
      const { deleteInstalledSkill, listInstalledSkills, readInstalledSkill, updateInstalledSkill } = await import('../../src/main/installed-resources')

      setInstallState('codex', { installed: true, source: 'sandbox', binPath: join(paths.cliInstall('codex'), 'codex') })
      const skillPath = join(paths.cliConfig('codex'), 'skills', 'writer', 'SKILL.md')
      writeText(skillPath, '---\nname: Writer\ndescription: Draft text\n---\nUse concise prose.\n')

      let skills = listInstalledSkills('codex')
      expect(skills).toHaveLength(1)
      expect(skills[0]).toMatchObject({ name: 'Writer', description: 'Draft text', source: 'writer' })
      expect(readInstalledSkill('codex', skills[0].id).content).toContain('Use concise prose.')

      skills = updateInstalledSkill('codex', skills[0].id, { name: 'Better Writer', description: 'Updated' })
      expect(skills[0]).toMatchObject({ name: 'Better Writer', description: 'Updated' })
      expect(readFileSync(skillPath, 'utf8')).toContain('name: "Better Writer"')

      skills = deleteInstalledSkill('codex', skills[0].id)
      expect(skills).toEqual([])
      expect(existsSync(skillPath)).toBe(false)
    })
  })

  it('keeps sandbox and system Skill roots separate', async () => {
    await withIsolatedHome(async ({ home }) => {
      const { paths } = await import('../../src/main/sandbox')
      const { setInstallState } = await import('../../src/main/store')
      const { listInstalledSkills } = await import('../../src/main/installed-resources')

      const sandboxSkill = join(paths.cliConfig('codex'), 'skills', 'sandbox-writer', 'SKILL.md')
      const systemSkill = join(home, '.codex', 'skills', 'system-writer', 'SKILL.md')
      writeText(sandboxSkill, '---\nname: Sandbox Writer\n---\n')
      writeText(systemSkill, '---\nname: System Writer\n---\n')

      setInstallState('codex', { installed: true, source: 'sandbox', binPath: join(paths.cliInstall('codex'), 'codex') })
      expect(listInstalledSkills('codex').map((skill) => skill.name)).toEqual(['Sandbox Writer'])

      setInstallState('codex', { installed: true, source: 'system', binPath: '/usr/local/bin/codex' })
      expect(listInstalledSkills('codex').map((skill) => skill.name)).toEqual(['System Writer'])
    })
  })
})
