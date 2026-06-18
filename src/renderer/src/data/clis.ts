export interface CliMeta {
  id: string
  name: string
  vendor: string
  /** Single-glyph mark used in the sidebar / cards until we wire real icons. */
  glyph: string
  accent: string
  /** Env-var prefix the resolved-config preview will surface later. */
  envPrefix: string
  /** Install source under route B (hybrid): native binary vs bundled-node npm. */
  install: 'native-binary' | 'node-npm'
}

export const CLIS: CliMeta[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    glyph: 'C',
    accent: '#d97757',
    envPrefix: 'ANTHROPIC_*',
    install: 'native-binary'
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    glyph: 'O',
    accent: '#10a37f',
    envPrefix: 'OPENAI_*',
    install: 'native-binary'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    vendor: 'SST',
    glyph: 'O',
    accent: '#f2a60d',
    envPrefix: 'XDG_* / OPENCODE_CONFIG',
    install: 'native-binary'
  },
  {
    id: 'pi',
    name: 'Pi',
    vendor: 'earendil',
    glyph: 'π',
    accent: '#7c3aed',
    envPrefix: 'PI_CODING_AGENT_DIR',
    install: 'node-npm'
  }
]

// Provider/relay catalog now lives in ./providers.ts (ported from cc-switch).

/** Whether each CLI supports a "YOLO" (auto-approve all) toggle, and the flag. */
export const YOLO_SUPPORT: Record<string, { supported: boolean; note: string }> = {
  'claude-code': { supported: true, note: '--dangerously-skip-permissions' },
  codex: { supported: true, note: '--dangerously-bypass-approvals-and-sandbox' },
  opencode: { supported: true, note: '--dangerously-skip-permissions' },
  pi: { supported: false, note: '该 CLI 无自动批准开关（仅工具白/黑名单）' }
}
