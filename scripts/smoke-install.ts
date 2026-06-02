import { detectEnvironment } from '../src/main/install/detect'
import { installCli } from '../src/main/install/installer'
import type { CliId } from '../src/shared/types'

async function main() {
  const det = await detectEnvironment()
  console.log('platform:', det.platform.platformKey)
  for (const it of det.items) {
    console.log(`  [${it.present ? 'x' : ' '}] ${it.label} — ${it.detail ?? ''}`)
  }
  const id = process.argv[2] as CliId | undefined
  if (id) {
    console.log(`\n=== installing ${id} ===`)
    const r = await installCli(id, (ph, m, f) =>
      console.log(`  [${ph}] ${m}${f != null ? ` ${Math.round(f * 100)}%` : ''}`)
    )
    console.log('RESULT:', JSON.stringify(r))
  }
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
