// Ad-hoc plumbing smoke for the in-UI chat driver. Spawns the sandbox Claude in
// stream-json mode and sends one turn. With no configured key it errors at auth
// (no tokens spent) — which still verifies spawn + stdin write + event parsing.
// With a configured profile it does a real one-turn call.
// Run: npx tsx scripts/smoke-chat.ts
import { startChat, sendChat, stopChat } from '../src/main/chat'

const wc: any = {
  isDestroyed: () => false,
  send: (_ch: string, id: string, ev: any) => console.log('EVENT', id, JSON.stringify(ev))
}

const id = startChat(wc, { cliId: 'claude-code', cwd: process.cwd() })
console.log('started handle:', id)
setTimeout(() => {
  console.log('--> sending turn')
  sendChat(id, 'Reply with just the word: ok')
}, 400)
setTimeout(() => {
  stopChat(id)
  console.log('done')
  process.exit(0)
}, 10000)
