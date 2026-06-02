import { listSessions, resumeArgs } from '../src/main/sessions-history'
for (const cli of ['claude-code','codex','gemini'] as const) {
  const list = listSessions(cli)
  console.log(`\n=== ${cli}: ${list.length} sessions ===`)
  for (const s of list.slice(0,4)) console.log(`  • ${s.name}  [${s.id.slice(0,8)}…]  cwd=${s.cwd ?? '-'}`)
  if (list[0]) console.log('  resumeArgs:', JSON.stringify(resumeArgs(cli, list[0].id)))
}
