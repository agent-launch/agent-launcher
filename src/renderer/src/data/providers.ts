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
  { id: 'routerlink', name: 'RouterLink', category: 'aggregator', baseUrl: 'https://router-link.world3.ai/api', websiteUrl: 'https://router-link-beta.world3.ai', note: 'Anthropic 端点' },
  { id: 'official', name: 'Claude 官方', category: 'official', baseUrl: '', websiteUrl: 'https://anthropic.com/claude-code', note: '官方直连（需海外卡）' },
  { id: 'shengsuanyun', name: 'Shengsuanyun 胜算云', category: 'aggregator', baseUrl: 'https://router.shengsuanyun.com/api', websiteUrl: 'https://shengsuanyun.com' },
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
  { id: 'openrouter', name: 'OpenRouter', category: 'aggregator', baseUrl: 'https://openrouter.ai/api', websiteUrl: 'https://openrouter.ai' },
  CUSTOM
]

// Codex uses an OpenAI-style base_url (usually ending in /v1).
const CODEX: Provider[] = [
  { id: 'routerlink', name: 'RouterLink', category: 'aggregator', baseUrl: 'https://router-link.world3.ai/api/v1', websiteUrl: 'https://router-link-beta.world3.ai', note: 'OpenAI 兼容端点' },
  { id: 'official', name: 'OpenAI 官方', category: 'official', baseUrl: '', websiteUrl: 'https://chatgpt.com/codex', note: '官方登录（需海外卡）' },
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
  { id: 'openrouter', name: 'OpenRouter', category: 'aggregator', baseUrl: 'https://openrouter.ai/api/v1', websiteUrl: 'https://openrouter.ai' },
  CUSTOM
]

const OPENCODE: Provider[] = [
  { id: 'opencode-go', name: 'OpenCode Go', category: 'third_party', baseUrl: 'https://opencode.ai/zen/go/v1', websiteUrl: 'https://opencode.ai/go', note: 'OpenAI 兼容端点' },
  ...CODEX.filter((provider) => provider.id !== 'official')
]

export const PROVIDERS_BY_CLI: Record<CliId, Provider[]> = {
  'claude-code': CLAUDE,
  codex: CODEX,
  // opencode has no official-login concept. It uses OpenAI-compatible relays,
  // plus OpenCode Go as a normal third-party provider.
  opencode: OPENCODE,
  // pi and Hermes consume OpenAI-compatible relays, so the Codex relay list
  // applies to them too.
  pi: CODEX,
  hermes: CODEX
}

// Category display labels now live in the i18n tables (key `category.<id>`),
// looked up via t('category.' + provider.category) at the call site.
