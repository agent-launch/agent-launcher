import { addProfile, setActiveProfile } from '../src/main/store'
import { writeCodexConfig, readCodexFiles } from '../src/main/codex-config'
import { buildCliEnv } from '../src/main/cli-env'

const cfg = addProfile('codex', { name: 'DMXAPI', providerId: 'dmxapi', baseUrl: 'https://www.dmxapi.cn/v1', apiKey: 'sk-codex-secret-7890', model: 'gpt-5.1' })
const pid = cfg.clis.codex.profiles[0].id
setActiveProfile('codex', pid)
writeCodexConfig()
const f = readCodexFiles()
console.log('=== dir ===\n' + f.dir)
console.log('\n=== config.toml ===\n' + f.configToml)
console.log('=== auth.json (masked) ===\n' + f.authJson)
console.log('\n=== injected env (codex) ===')
const e = buildCliEnv('codex')
for (const k of ['CODEX_HOME','OPENAI_BASE_URL','OPENAI_API_KEY']) console.log(' ', k, '=', e[k])
