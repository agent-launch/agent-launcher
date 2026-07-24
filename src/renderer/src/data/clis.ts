export interface CliMeta {
  id: string
  name: string
  vendor: string
  /** Single-glyph mark used in the sidebar / cards until we wire real icons. */
  glyph: string
  accent: string
  /** Env-var prefix the resolved-config preview will surface later. */
  envPrefix: string
  /** Official instructions for installing and updating this CLI. */
  installDocsUrl: string
}

export const CLIS: CliMeta[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    glyph: 'C',
    accent: '#d97757',
    envPrefix: 'ANTHROPIC_*',
    installDocsUrl: 'https://code.claude.com/docs/en/setup'
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    glyph: 'O',
    accent: '#10a37f',
    envPrefix: 'OPENAI_*',
    installDocsUrl: 'https://developers.openai.com/codex/cli/'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    vendor: 'SST',
    glyph: 'O',
    accent: '#f2a60d',
    envPrefix: 'XDG_* / OPENCODE_CONFIG',
    installDocsUrl: 'https://opencode.ai/docs/'
  },
  {
    id: 'pi',
    name: 'Pi',
    vendor: 'earendil',
    glyph: 'π',
    accent: '#7c3aed',
    envPrefix: 'PI_CODING_AGENT_DIR',
    installDocsUrl: 'https://github.com/earendil-works/pi/tree/main/packages/coding-agent'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    glyph: 'G',
    accent: '#4285f4',
    envPrefix: 'GEMINI_* / GOOGLE_GEMINI_*',
    installDocsUrl: 'https://github.com/google-gemini/gemini-cli'
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    vendor: 'Nous Research',
    glyph: 'H',
    accent: '#d7a900',
    envPrefix: '~/.hermes / OPENAI_*',
    installDocsUrl: 'https://hermes-agent.nousresearch.com/docs/getting-started/installation/'
  }
]

// Provider/relay catalog now lives in ./providers.ts (ported from cc-switch).

/** Whether each CLI supports a "YOLO" (auto-approve all) toggle, and the flag. */
export const YOLO_SUPPORT: Record<string, { supported: boolean; note: string }> = {
  'claude-code': { supported: true, note: '--dangerously-skip-permissions' },
  codex: { supported: true, note: '--dangerously-bypass-approvals-and-sandbox' },
  opencode: { supported: true, note: '--auto' },
  pi: { supported: false, note: 'Pi never prompts for approval; tools always run automatically' },
  gemini: { supported: true, note: '--yolo' },
  hermes: { supported: true, note: '--yolo' }
}
