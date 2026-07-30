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

    expect(steps.map((step) => step.kind)).toEqual(['native', 'npm'])
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

    expect(steps.map((step) => step.kind)).toEqual(['npm'])
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

  it('never overrides the registry, so a user mirror keeps working', () => {
    for (const id of ['claude-code', 'codex', 'opencode', 'pi', 'gemini'] as const) {
      const steps = installStepsFor(id, { platform: 'linux', npmPath: NPM })
      const npm = steps.find((step) => step.kind === 'npm')
      expect(npm, `${id} should have an npm step`).toBeDefined()
      expect(npm!.args.join(' ')).not.toContain('--registry')
    }
  })

  it('installs the other npm CLIs with npm alone — no native fallback chain', () => {
    for (const [id, pkg] of [
      ['codex', '@openai/codex@latest'],
      ['opencode', 'opencode-ai@latest'],
      ['pi', '@earendil-works/pi-coding-agent@latest'],
      ['gemini', '@google/gemini-cli@latest']
    ] as const) {
      const steps = installStepsFor(id, { platform: 'darwin', npmPath: NPM })
      expect(steps.map((step) => step.kind)).toEqual(['npm'])
      expect(steps[0].args).toContain(pkg)
    }
  })

  it('produces no npm step when npm is missing', () => {
    expect(installStepsFor('codex', { platform: 'darwin' })).toEqual([])
    expect(installStepsFor('claude-code', { platform: 'darwin', nativeReachable: false })).toEqual(
      []
    )
  })

  it('installs Hermes with its own installer because it has no npm package', () => {
    const steps = installStepsFor('hermes', { platform: 'darwin', npmPath: NPM })

    expect(steps.map((step) => step.kind)).toEqual(['official'])
    expect(steps[0].args[1]).toContain('hermes-agent.nousresearch.com/install.sh')
    expect(steps[0].args[1]).not.toContain('npm')
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
