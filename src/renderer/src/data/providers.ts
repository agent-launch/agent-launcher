import type { CliId } from '@shared/types'

export type ProviderCategory =
  | 'official'
  | 'cn_official'
  | 'aggregator'
  | 'third_party'
  | 'cloud_provider'
  | 'custom'

export interface Provider {
  id: string
  name: string
  category: ProviderCategory
  /** Endpoint pre-filled into the per-CLI base-url env var. */
  baseUrl: string
  websiteUrl?: string
  note?: string
}

const CUSTOM: Provider = {
  id: 'custom',
  name: '自定义',
  category: 'custom',
  baseUrl: '',
  note: '手动填写 base URL'
}

// Ported from cc-switch (github.com/farion1231/cc-switch) provider presets.
// Claude uses ANTHROPIC_BASE_URL (often /anthropic paths).
const CLAUDE: Provider[] = [
  { id: 'routerlink', name: 'RouterLink', category: 'aggregator', baseUrl: 'https://router-link-beta.world3.ai/api', websiteUrl: 'https://router-link-beta.world3.ai', note: 'Anthropic 端点' },
  { id: 'official', name: 'Claude 官方', category: 'official', baseUrl: '', websiteUrl: 'https://anthropic.com/claude-code', note: '官方直连（需海外卡）' },
  { id: 'shengsuanyun', name: 'Shengsuanyun 胜算云', category: 'aggregator', baseUrl: 'https://router.shengsuanyun.com/api', websiteUrl: 'https://shengsuanyun.com' },
  { id: 'patewayai', name: 'PatewayAI', category: 'third_party', baseUrl: 'https://api.pateway.ai', websiteUrl: 'https://pateway.ai' },
  { id: 'volcengine', name: '火山 AgentPlan', category: 'cn_official', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', websiteUrl: 'https://volcengine.com' },
  { id: 'deepseek', name: 'DeepSeek', category: 'cn_official', baseUrl: 'https://api.deepseek.com/anthropic', websiteUrl: 'https://platform.deepseek.com' },
  { id: 'zhipu', name: '智谱 GLM', category: 'cn_official', baseUrl: 'https://open.bigmodel.cn/api/anthropic', websiteUrl: 'https://open.bigmodel.cn' },
  { id: 'zhipu-en', name: '智谱 GLM (z.ai)', category: 'cn_official', baseUrl: 'https://api.z.ai/api/anthropic', websiteUrl: 'https://z.ai' },
  { id: 'qianfan', name: '百度千帆 Coding', category: 'cn_official', baseUrl: 'https://qianfan.baidubce.com/anthropic/coding', websiteUrl: 'https://cloud.baidu.com' },
  { id: 'bailian', name: '阿里百炼', category: 'cn_official', baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic', websiteUrl: 'https://bailian.console.aliyun.com' },
  { id: 'kimi', name: 'Kimi (Moonshot)', category: 'cn_official', baseUrl: 'https://api.moonshot.cn/anthropic', websiteUrl: 'https://platform.moonshot.cn' },
  { id: 'kimi-coding', name: 'Kimi For Coding', category: 'cn_official', baseUrl: 'https://api.kimi.com/coding/', websiteUrl: 'https://kimi.com' },
  { id: 'stepfun', name: '阶跃 StepFun', category: 'cn_official', baseUrl: 'https://api.stepfun.com/step_plan', websiteUrl: 'https://platform.stepfun.com' },
  { id: 'modelscope', name: 'ModelScope 魔搭', category: 'aggregator', baseUrl: 'https://api-inference.modelscope.cn', websiteUrl: 'https://modelscope.cn' },
  { id: 'longcat', name: 'Longcat 美团', category: 'cn_official', baseUrl: 'https://api.longcat.chat/anthropic', websiteUrl: 'https://longcat.chat' },
  { id: 'minimax', name: 'MiniMax', category: 'cn_official', baseUrl: 'https://api.minimaxi.com/anthropic', websiteUrl: 'https://platform.minimaxi.com' },
  { id: 'bailing', name: 'BaiLing 蚂蚁百灵', category: 'cn_official', baseUrl: 'https://api.tbox.cn/api/anthropic', websiteUrl: 'https://alipaytbox.yuque.com' },
  { id: 'xiaomi', name: '小米 MiMo', category: 'cn_official', baseUrl: 'https://api.xiaomimimo.com/anthropic', websiteUrl: 'https://platform.xiaomimimo.com' },
  { id: 'aihubmix', name: 'AiHubMix', category: 'aggregator', baseUrl: 'https://aihubmix.com', websiteUrl: 'https://aihubmix.com' },
  { id: 'siliconflow', name: 'SiliconFlow 硅基流动', category: 'aggregator', baseUrl: 'https://api.siliconflow.cn', websiteUrl: 'https://siliconflow.cn' },
  { id: 'dmxapi', name: 'DMXAPI', category: 'aggregator', baseUrl: 'https://www.dmxapi.cn', websiteUrl: 'https://dmxapi.cn' },
  { id: 'packycode', name: 'PackyCode', category: 'third_party', baseUrl: 'https://www.packyapi.com', websiteUrl: 'https://packyapi.com' },
  { id: 'apikeyfun', name: 'APIKEY.FUN', category: 'third_party', baseUrl: 'https://api.apikey.fun', websiteUrl: 'https://apikey.fun' },
  { id: 'apinebula', name: 'APINebula', category: 'third_party', baseUrl: 'https://apinebula.com', websiteUrl: 'https://apinebula.com' },
  { id: 'atlascloud', name: 'AtlasCloud', category: 'aggregator', baseUrl: 'https://api.atlascloud.ai', websiteUrl: 'https://atlascloud.ai' },
  { id: 'sudocode', name: 'SudoCode', category: 'third_party', baseUrl: 'https://sudocode.us', websiteUrl: 'https://sudocode.us' },
  { id: 'claudeapi', name: 'ClaudeAPI', category: 'aggregator', baseUrl: 'https://gw.claudeapi.com', websiteUrl: 'https://claudeapi.com' },
  { id: 'claudecn', name: 'ClaudeCN', category: 'third_party', baseUrl: 'https://claudecn.top', websiteUrl: 'https://claudecn.top' },
  { id: 'runapi', name: 'RunAPI', category: 'aggregator', baseUrl: 'https://runapi.co', websiteUrl: 'https://runapi.co' },
  { id: 'relaxycode', name: 'RelaxyCode', category: 'third_party', baseUrl: 'https://www.relaxycode.com', websiteUrl: 'https://relaxycode.com' },
  { id: 'cubence', name: 'Cubence', category: 'third_party', baseUrl: 'https://api.cubence.com', websiteUrl: 'https://cubence.com' },
  { id: 'aigocode', name: 'AIGoCode', category: 'third_party', baseUrl: 'https://api.aigocode.com', websiteUrl: 'https://aigocode.com' },
  { id: 'rightcode', name: 'RightCode', category: 'third_party', baseUrl: 'https://www.right.codes/claude', websiteUrl: 'https://right.codes' },
  { id: 'aicodemirror', name: 'AICodeMirror', category: 'third_party', baseUrl: 'https://api.aicodemirror.com/api/claudecode', websiteUrl: 'https://aicodemirror.com' },
  { id: 'crazyrouter', name: 'CrazyRouter', category: 'third_party', baseUrl: 'https://cn.crazyrouter.com', websiteUrl: 'https://crazyrouter.com' },
  { id: 'sssaicode', name: 'SSSAiCode', category: 'third_party', baseUrl: 'https://node-hk.sssaicode.com/api', websiteUrl: 'https://sssaicode.com' },
  { id: 'compshare', name: 'Compshare 优刻得', category: 'aggregator', baseUrl: 'https://api.modelverse.cn', websiteUrl: 'https://compshare.cn' },
  { id: 'micu', name: 'Micu', category: 'third_party', baseUrl: 'https://www.micuapi.ai', websiteUrl: 'https://micuapi.ai' },
  { id: 'ctok', name: 'CTok.ai', category: 'third_party', baseUrl: 'https://api.ctok.ai', websiteUrl: 'https://ctok.ai' },
  { id: 'eflowcode', name: 'E-FlowCode', category: 'third_party', baseUrl: 'https://e-flowcode.cc', websiteUrl: 'https://e-flowcode.cc' },
  { id: 'openrouter', name: 'OpenRouter', category: 'aggregator', baseUrl: 'https://openrouter.ai/api', websiteUrl: 'https://openrouter.ai' },
  { id: 'therouter', name: 'TheRouter', category: 'aggregator', baseUrl: 'https://api.therouter.ai', websiteUrl: 'https://therouter.ai' },
  { id: 'novita', name: 'Novita AI', category: 'aggregator', baseUrl: 'https://api.novita.ai/anthropic', websiteUrl: 'https://novita.ai' },
  { id: 'pipellm', name: 'PIPELLM', category: 'aggregator', baseUrl: 'https://cc-api.pipellm.ai', websiteUrl: 'https://code.pipellm.ai' },
  { id: 'lemondata', name: 'LemonData', category: 'third_party', baseUrl: 'https://api.lemondata.cc', websiteUrl: 'https://lemondata.cc' },
  CUSTOM
]

// Codex uses an OpenAI-style base_url (usually ending in /v1).
const CODEX: Provider[] = [
  { id: 'routerlink', name: 'RouterLink', category: 'aggregator', baseUrl: 'https://router-link-beta.world3.ai/api/v1', websiteUrl: 'https://router-link-beta.world3.ai', note: 'OpenAI 兼容端点' },
  { id: 'official', name: 'OpenAI 官方', category: 'official', baseUrl: '', websiteUrl: 'https://chatgpt.com/codex', note: '官方登录（需海外卡）' },
  { id: 'shengsuanyun', name: 'Shengsuanyun 胜算云', category: 'aggregator', baseUrl: 'https://router.shengsuanyun.com/api/v1', websiteUrl: 'https://shengsuanyun.com' },
  { id: 'patewayai', name: 'PatewayAI', category: 'third_party', baseUrl: 'https://api.pateway.ai/v1', websiteUrl: 'https://pateway.ai' },
  { id: 'deepseek', name: 'DeepSeek', category: 'cn_official', baseUrl: 'https://api.deepseek.com', websiteUrl: 'https://platform.deepseek.com' },
  { id: 'zhipu', name: '智谱 GLM', category: 'cn_official', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', websiteUrl: 'https://open.bigmodel.cn' },
  { id: 'qianfan', name: '百度千帆 Coding', category: 'cn_official', baseUrl: 'https://qianfan.baidubce.com/v2/coding', websiteUrl: 'https://cloud.baidu.com' },
  { id: 'bailian', name: '阿里百炼 (Qwen)', category: 'cn_official', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', websiteUrl: 'https://bailian.console.aliyun.com' },
  { id: 'kimi', name: 'Kimi (Moonshot)', category: 'cn_official', baseUrl: 'https://api.moonshot.cn/v1', websiteUrl: 'https://platform.moonshot.cn' },
  { id: 'stepfun', name: '阶跃 StepFun', category: 'cn_official', baseUrl: 'https://api.stepfun.com/step_plan/v1', websiteUrl: 'https://platform.stepfun.com' },
  { id: 'modelscope', name: 'ModelScope 魔搭', category: 'aggregator', baseUrl: 'https://api-inference.modelscope.cn/v1', websiteUrl: 'https://modelscope.cn' },
  { id: 'longcat', name: 'Longcat 美团', category: 'cn_official', baseUrl: 'https://api.longcat.chat/openai/v1', websiteUrl: 'https://longcat.chat' },
  { id: 'minimax', name: 'MiniMax', category: 'cn_official', baseUrl: 'https://api.minimaxi.com/v1', websiteUrl: 'https://platform.minimaxi.com' },
  { id: 'xiaomi', name: '小米 MiMo', category: 'cn_official', baseUrl: 'https://api.xiaomimimo.com/v1', websiteUrl: 'https://platform.xiaomimimo.com' },
  { id: 'siliconflow', name: 'SiliconFlow 硅基流动', category: 'aggregator', baseUrl: 'https://api.siliconflow.cn/v1', websiteUrl: 'https://siliconflow.cn' },
  { id: 'novita', name: 'Novita AI', category: 'aggregator', baseUrl: 'https://api.novita.ai/openai/v1', websiteUrl: 'https://novita.ai' },
  { id: 'aihubmix', name: 'AiHubMix', category: 'aggregator', baseUrl: 'https://aihubmix.com/v1', websiteUrl: 'https://aihubmix.com' },
  { id: 'dmxapi', name: 'DMXAPI', category: 'aggregator', baseUrl: 'https://www.dmxapi.cn/v1', websiteUrl: 'https://dmxapi.cn' },
  { id: 'packycode', name: 'PackyCode', category: 'third_party', baseUrl: 'https://www.packyapi.com/v1', websiteUrl: 'https://packyapi.com' },
  { id: 'apikeyfun', name: 'APIKEY.FUN', category: 'third_party', baseUrl: 'https://api.apikey.fun/v1', websiteUrl: 'https://apikey.fun' },
  { id: 'apinebula', name: 'APINebula', category: 'third_party', baseUrl: 'https://apinebula.com/v1', websiteUrl: 'https://apinebula.com' },
  { id: 'atlascloud', name: 'AtlasCloud', category: 'aggregator', baseUrl: 'https://api.atlascloud.ai/v1', websiteUrl: 'https://atlascloud.ai' },
  { id: 'sudocode', name: 'SudoCode', category: 'third_party', baseUrl: 'https://sudocode.us/v1', websiteUrl: 'https://sudocode.us' },
  { id: 'claudecn', name: 'ClaudeCN', category: 'third_party', baseUrl: 'https://claudecn.top/v1', websiteUrl: 'https://claudecn.top' },
  { id: 'runapi', name: 'RunAPI', category: 'aggregator', baseUrl: 'https://runapi.co/v1', websiteUrl: 'https://runapi.co' },
  { id: 'cubence', name: 'Cubence', category: 'third_party', baseUrl: 'https://api.cubence.com/v1', websiteUrl: 'https://cubence.com' },
  { id: 'crazyrouter', name: 'CrazyRouter', category: 'third_party', baseUrl: 'https://cn.crazyrouter.com/v1', websiteUrl: 'https://crazyrouter.com' },
  { id: 'compshare', name: 'Compshare 优刻得', category: 'aggregator', baseUrl: 'https://api.modelverse.cn/v1', websiteUrl: 'https://compshare.cn' },
  { id: 'ctok', name: 'CTok.ai', category: 'third_party', baseUrl: 'https://api.ctok.ai/v1', websiteUrl: 'https://ctok.ai' },
  { id: 'lemondata', name: 'LemonData', category: 'third_party', baseUrl: 'https://api.lemondata.cc/v1', websiteUrl: 'https://lemondata.cc' },
  { id: 'pipellm', name: 'PIPELLM', category: 'aggregator', baseUrl: 'https://cc-api.pipellm.ai/v1', websiteUrl: 'https://code.pipellm.ai' },
  { id: 'openrouter', name: 'OpenRouter', category: 'aggregator', baseUrl: 'https://openrouter.ai/api/v1', websiteUrl: 'https://openrouter.ai' },
  { id: 'therouter', name: 'TheRouter', category: 'aggregator', baseUrl: 'https://api.therouter.ai/v1', websiteUrl: 'https://therouter.ai' },
  CUSTOM
]

// Gemini uses GOOGLE_GEMINI_BASE_URL.
const GEMINI: Provider[] = [
  { id: 'official', name: 'Google 官方', category: 'official', baseUrl: '', websiteUrl: 'https://ai.google.dev/gemini-api', note: '官方 API Key 或 OAuth' },
  { id: 'shengsuanyun', name: 'Shengsuanyun 胜算云', category: 'aggregator', baseUrl: 'https://router.shengsuanyun.com/api', websiteUrl: 'https://shengsuanyun.com' },
  { id: 'packycode', name: 'PackyCode', category: 'third_party', baseUrl: 'https://www.packyapi.com', websiteUrl: 'https://packyapi.com' },
  { id: 'apikeyfun', name: 'APIKEY.FUN', category: 'third_party', baseUrl: 'https://api.apikey.fun', websiteUrl: 'https://apikey.fun' },
  { id: 'apinebula', name: 'APINebula', category: 'third_party', baseUrl: 'https://apinebula.com', websiteUrl: 'https://apinebula.com' },
  { id: 'sudocode', name: 'SudoCode', category: 'third_party', baseUrl: 'https://sudocode.us', websiteUrl: 'https://sudocode.us' },
  { id: 'cubence', name: 'Cubence', category: 'third_party', baseUrl: 'https://api.cubence.com', websiteUrl: 'https://cubence.com' },
  { id: 'aigocode', name: 'AIGoCode', category: 'third_party', baseUrl: 'https://api.aigocode.com', websiteUrl: 'https://aigocode.com' },
  { id: 'aicodemirror', name: 'AICodeMirror', category: 'third_party', baseUrl: 'https://api.aicodemirror.com/api/gemini', websiteUrl: 'https://aicodemirror.com' },
  { id: 'crazyrouter', name: 'CrazyRouter', category: 'third_party', baseUrl: 'https://cn.crazyrouter.com', websiteUrl: 'https://crazyrouter.com' },
  { id: 'ctok', name: 'CTok.ai', category: 'third_party', baseUrl: 'https://api.ctok.ai/v1beta', websiteUrl: 'https://ctok.ai' },
  { id: 'lemondata', name: 'LemonData', category: 'third_party', baseUrl: 'https://api.lemondata.cc', websiteUrl: 'https://lemondata.cc' },
  { id: 'openrouter', name: 'OpenRouter', category: 'aggregator', baseUrl: 'https://openrouter.ai/api', websiteUrl: 'https://openrouter.ai' },
  { id: 'therouter', name: 'TheRouter', category: 'aggregator', baseUrl: 'https://api.therouter.ai', websiteUrl: 'https://therouter.ai' },
  CUSTOM
]

export const PROVIDERS_BY_CLI: Record<CliId, Provider[]> = {
  'claude-code': CLAUDE,
  codex: CODEX,
  gemini: GEMINI,
  // opencode & pi consume OpenAI-compatible relays (the /v1 endpoints), so the
  // Codex relay list applies to them too.
  opencode: CODEX,
  pi: CODEX
}

// Category display labels now live in the i18n tables (key `category.<id>`),
// looked up via t('category.' + provider.category) at the call site.
