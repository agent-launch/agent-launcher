import { addProfile, setActiveProfile } from '../src/main/store'
import { writeNativeConfig, readNativeFiles } from '../src/main/native-config'
import { buildCliEnv } from '../src/main/cli-env'

const cfg = addProfile('codex', { name: 'DMXAPI', providerId: 'dmxapi', baseUrl: 'https://www.dmxapi.cn/v1', apiKey: 'sk-example-not-a-real-key', model: 'gpt-5.1' })
const pid = cfg.clis.codex.profiles[0].id
setActiveProfile('codex', pid)
writeNativeConfig('codex')
const f = readNativeFiles('codex')
console.log('=== dir ===\n' + f.dir)
for (const file of f.files) {
  console.log(`\n=== ${file.name} (masked) ===\n` + file.content)
}
console.log('\n=== injected env (codex) ===')
const e = buildCliEnv('codex')
for (const k of ['CODEX_HOME', 'OPENAI_BASE_URL', 'OPENAI_API_KEY']) console.log(' ', k, '=', e[k])
