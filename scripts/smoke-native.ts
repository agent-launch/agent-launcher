import { addProfile, setActiveProfile } from '../src/main/store'
import { writeNativeConfig, readNativeFiles } from '../src/main/native-config'
import { resolvedEnvPreview } from '../src/main/cli-env'

for (const cli of ['opencode','pi'] as const) {
  const c = addProfile(cli, { name: 'AiHubMix', providerId: 'aihubmix', baseUrl: 'https://aihubmix.com/v1', apiKey: 'sk-test-abcd1234efgh', model: 'gpt-5.1' })
  setActiveProfile(cli, c.clis[cli].profiles[0].id)
  writeNativeConfig(cli)
  const f = readNativeFiles(cli)
  console.log(`\n===== ${cli} (dir=${f.dir}) =====`)
  for (const file of f.files) console.log(`--- ${file.name} ---\n${file.content}`)
  console.log('--- injected isolation env ---')
  for (const e of resolvedEnvPreview(cli)) console.log('  ', e.key, '=', e.value)
}
