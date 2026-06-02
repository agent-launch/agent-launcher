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
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    glyph: 'G',
    accent: '#4285f4',
    envPrefix: 'GEMINI_* / GOOGLE_*',
    install: 'node-npm'
  },
  {
    id: 'opencode',
    name: 'opencode',
    vendor: 'SST',
    glyph: 'o',
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
