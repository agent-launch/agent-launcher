import { loadConfig, addProfile, setActiveProfile, getActiveProfile } from '../src/main/store'
import { resolvedEnvPreview } from '../src/main/cli-env'

console.log('schema:', loadConfig().schema)
const c1 = addProfile('claude-code', {
  name: 'AiHubMix · Opus',
  providerId: 'aihubmix',
  baseUrl: 'https://aihubmix.com',
  apiKey: 'sk-test-1234567890',
  model: 'opus'
})
const c2 = addProfile('claude-code', {
  name: 'DMXAPI',
  providerId: 'dmxapi',
  baseUrl: 'https://www.dmxapi.cn',
  apiKey: 'sk-dmx-abcdefgh'
})
const profs = c2.clis['claude-code'].profiles
console.log('profiles:', profs.map((p) => `${p.id}:${p.name}`).join(', '))
console.log('active (auto-first):', getActiveProfile('claude-code')?.name)
setActiveProfile('claude-code', profs[1].id)
console.log('active after switch:', getActiveProfile('claude-code')?.name)
console.log('resolved env (masked):')
for (const e of resolvedEnvPreview('claude-code')) console.log('  ', e.key, '=', e.value)
void c1
