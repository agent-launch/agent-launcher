import { detectEnvironment } from '../src/main/install/detect'
import { linkSystemCli } from '../src/main/install/installer'
import type { CliId } from '../src/shared/types'

async function main() {
  const detection = await detectEnvironment()
  console.log('platform:', detection.platform.platformKey)
  for (const item of detection.items) {
    console.log(`  [${item.present ? 'x' : ' '}] ${item.label} — ${item.detail ?? ''}`)
  }

  const id = process.argv[2] as CliId | undefined
  if (id) {
    console.log(`\n=== linking ${id} ===`)
    const result = await linkSystemCli(id, (phase, message) =>
      console.log(`  [${phase}] ${message}`)
    )
    console.log('RESULT:', JSON.stringify(result))
  }
}

main().catch((error) => {
  console.error('FATAL', error)
  process.exit(1)
})
