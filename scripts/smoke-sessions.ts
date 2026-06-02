import { listSessions, resumeArgs } from '../src/main/sessions-history'
async function main() {
  for (const cli of ['claude-code','codex','gemini','opencode','pi'] as const) {
    const list = await listSessions(cli)
    console.log(`\n=== ${cli}: ${list.length} sessions ===`)
    for (const s of list.slice(0,4)) console.log(`  • ${s.name}  cwd=${s.cwd ?? '-'}  | resume: ${JSON.stringify(resumeArgs(cli, s.id))}`)
  }
}
main()
