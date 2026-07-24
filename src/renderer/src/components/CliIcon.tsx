// Deep imports (not the barrel) so Vite doesn't scan all 200+ icons.
import ClaudeCode from '@lobehub/icons/es/ClaudeCode'
import Codex from '@lobehub/icons/es/Codex'
import GeminiCLI from '@lobehub/icons/es/GeminiCLI'
import HermesAgent from '@lobehub/icons/es/HermesAgent'
import OpenCode from '@lobehub/icons/es/OpenCode'
import { CLIS } from '@/data/clis'
import type { CliId } from '@shared/types'

/** Product brand logos from @lobehub/icons; CLIs without one fall back to a glyph. */
const ICONS: Partial<Record<CliId, (p: { size: number }) => React.ReactNode>> = {
  'claude-code': (p) => <ClaudeCode.Color {...p} />,
  codex: (p) => <Codex {...p} />,
  gemini: (p) => <GeminiCLI.Color {...p} />,
  hermes: (p) => <HermesAgent {...p} />,
  opencode: (p) => <OpenCode {...p} />
}

export function CliIcon({ cliId, size = 20 }: { cliId: CliId; size?: number }) {
  const Icon = ICONS[cliId]
  if (Icon) return <>{Icon({ size })}</>
  // Fallback: the CLI's glyph (e.g. π for Pi).
  const glyph = CLIS.find((c) => c.id === cliId)?.glyph ?? '?'
  return (
    <span style={{ fontSize: size * 0.8, lineHeight: 1, fontWeight: 600 }}>{glyph}</span>
  )
}
