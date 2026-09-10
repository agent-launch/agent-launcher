import { describe, expect, it } from 'vitest'
import { installStepsFor } from '../../src/main/install/installer'

const NPM = '/usr/local/bin/npm'

describe('one-click install steps', () => {
  it('tries the official Claude Code installer before npm', () => {
    const steps = installStepsFor('claude-code', {
      platform: 'darwin',
      npmPath: NPM,
      nativeReachable: true
    })

    expect(steps.map((step) => step.kind)).toEqual(['native', 'npm', 'mirror'])
    expect(steps[0].file).toBe('bash')
    expect(steps[0].args[1]).toContain('https://claude.ai/install.sh')
    expect(steps[1].file).toBe(NPM)
    expect(steps[1].args).toContain('@anthropic-ai/claude-code@latest')
  })

  it('skips the native installer when claude.ai is unreachable', () => {
    const steps = installStepsFor('claude-code', {
      platform: 'darwin',
      npmPath: NPM,
      nativeReachable: false
    })

    expect(steps.map((step) => step.kind)).toEqual(['npm', 'mirror'])
  })

  it('uses PowerShell for the native installer on Windows', () => {
    const [native] = installStepsFor('claude-code', {
      platform: 'win32',
      npmPath: NPM,
      nativeReachable: true
    })

    expect(native.kind).toBe('native')
    expect(native.file.toLowerCase()).toContain('powershell')
    expect(native.args.at(-1)).toContain('https://claude.ai/install.ps1')
  })

  it('keeps the user registry first and scopes npmmirror to the fallback step', () => {
    for (const id of ['claude-code', 'codex', 'opencode', 'pi', 'gemini'] as const) {
      const steps = installStepsFor(id, { platform: 'linux', npmPath: NPM })
      const npm = steps.find((step) => step.kind === 'npm')
      const mirror = steps.find((step) => step.kind === 'mirror')
      expect(npm, `${id} should have an npm step`).toBeDefined()
      expect(mirror, `${id} should have an npm mirror step`).toBeDefined()
      expect(npm!.args.join(' ')).not.toContain('--registry')
      expect(npm!.env?.npm_config_registry).toBeUndefined()
      expect(mirror!.args.join(' ')).not.toContain('--registry')
      expect(mirror!.env?.npm_config_registry).toBe('https://registry.npmmirror.com')
    }
  })

  it('installs the other npm CLIs with the user registry before npmmirror', () => {
    for (const [id, pkg] of [
      ['codex', '@openai/codex@latest'],
      ['opencode', 'opencode-ai@latest'],
      ['pi', '@earendil-works/pi-coding-agent@latest'],
      ['gemini', '@google/gemini-cli@latest']
    ] as const) {
      const steps = installStepsFor(id, { platform: 'darwin', npmPath: NPM })
      expect(steps.map((step) => step.kind)).toEqual(['npm', 'mirror'])
      expect(steps[0].args).toContain(pkg)
      expect(steps[1].args).toContain(pkg)
    }
  })

  it('produces no npm step when npm is missing', () => {
    expect(installStepsFor('codex', { platform: 'darwin' })).toEqual([])
    expect(installStepsFor('claude-code', { platform: 'darwin', nativeReachable: false })).toEqual(
      []
    )
  })

  it('tries the official Hermes installer before a pinned GitCode mirror', () => {
    const steps = installStepsFor('hermes', { platform: 'darwin', npmPath: NPM })

    expect(steps.map((step) => step.kind)).toEqual(['official', 'mirror'])
    expect(steps[0].args[1]).toContain('hermes-agent.nousresearch.com/install.sh')
    expect(steps[0].args[1]).not.toContain('npm')
    expect(steps[1].args[1]).toContain('gitcode.com/GitHub_Trending/he/hermes-agent.git')
    expect(steps[1].args[1]).toContain('v2026.8.3')
    expect(steps[1].args[1]).toContain('7de39e700d2c329e15d32eb0b96e2f7cdd9fbdb2')
    expect(steps[1].args[1]).toContain('3c27eb6234bf91b8ceee9e9071591b31e9b148cb')
    expect(steps[1].args[1]).toContain(
      '45f589461248c7a6ec3aecd7522a69dd49c5c8dbf4798ba1296af5c0c5e7ccd3'
    )
    expect(steps[1].args[1]).not.toContain('curl')
    expect(steps[1].env).toMatchObject({
      npm_config_registry: 'https://registry.npmmirror.com',
      PIP_INDEX_URL: 'https://pypi.tuna.tsinghua.edu.cn/simple'
    })
  })

  it('uses only the verified Hermes mirror when the official host is unreachable', () => {
    const steps = installStepsFor('hermes', {
      platform: 'linux',
      nativeReachable: false
    })

    expect(steps.map((step) => step.kind)).toEqual(['mirror'])
    expect(steps[0].file).toBe('bash')
  })

  it('pins and verifies the Windows Hermes mirror installer too', () => {
    const mirror = installStepsFor('hermes', {
      platform: 'win32',
      nativeReachable: false
    })[0]
    const command = mirror.args.at(-1)!

    expect(command).toContain('gitcode.com/GitHub_Trending/he/hermes-agent.git')
    expect(command).toContain('3c27eb6234bf91b8ceee9e9071591b31e9b148cb')
    expect(command).toContain('4dcbf2b665750cb578f69a6efa40770659e21821a463746f86da68af0d2bb31c')
    expect(command).toContain('7a9c854dabcb7d3e5859902ea626f444196777cfcf74a6bb0508d0f063dbf161')
    expect(command).toContain('$expectedInstallerShas -notcontains $actualInstallerSha')
    expect(command).not.toContain('Invoke-WebRequest')
    expect(command).not.toContain('irm ')
    expect(command).not.toContain('iex')
  })

  it('gives every step a timeout so a blackholed download cannot hang the UI', () => {
    const steps = [
      ...installStepsFor('claude-code', {
        platform: 'darwin',
        npmPath: NPM,
        nativeReachable: true
      }),
      ...installStepsFor('hermes', { platform: 'darwin' })
    ]

    expect(steps).not.toHaveLength(0)
    for (const step of steps) expect(step.timeoutMs).toBeGreaterThan(0)
  })
})
