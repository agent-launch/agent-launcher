// Deep imports (not the barrel) so Vite doesn't scan all 200+ icons.
import ClaudeCode from '@lobehub/icons/es/ClaudeCode'
import Codex from '@lobehub/icons/es/Codex'
import GeminiCLI from '@lobehub/icons/es/GeminiCLI'
import type { CliId } from '@shared/types'

/** Product-specific brand logos from @lobehub/icons, colored variants. */
const ICONS: Record<CliId, (p: { size: number }) => React.ReactNode> = {
  'claude-code': (p) => <ClaudeCode.Color {...p} />,
  codex: (p) => <Codex {...p} />,
  gemini: (p) => <GeminiCLI.Color {...p} />
}

export function CliIcon({ cliId, size = 20 }: { cliId: CliId; size?: number }) {
  return <>{ICONS[cliId]({ size })}</>
}
