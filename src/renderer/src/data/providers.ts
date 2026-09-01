import type { CliId } from '@shared/types'

export type ProviderCategory =
  'official' | 'cn_official' | 'aggregator' | 'third_party' | 'cloud_provider' | 'custom'

export interface Provider {
  id: string
  name: string
  category: ProviderCategory
  /** Endpoint pre-filled into the per-CLI base-url env var. */
  baseUrl: string
  /** Provider-specific model-list endpoint when it cannot be derived from baseUrl. */
  modelsUrl?: string
  websiteUrl?: string
  note?: string
}

const CUSTOM: Provider = {
  id: 'custom',
  name: 'Custom',
  category: 'custom',
  baseUrl: '',
  note: 'Enter a base URL manually'
}

// Claude uses ANTHROPIC_BASE_URL (often /anthropic paths).
const CLAUDE: Provider[] = [
  {
    id: 'official',
    name: 'Claude Official',
    category: 'official',
    baseUrl: '',
    websiteUrl: 'https://anthropic.com/claude-code',
    note: 'Direct official connection'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'cn_official',
    baseUrl: 'https://api.deepseek.com/anthropic',
    modelsUrl: 'https://api.deepseek.com/models',
    websiteUrl: 'https://platform.deepseek.com'
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    category: 'cn_official',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    websiteUrl: 'https://open.bigmodel.cn'
  },
  {
    id: 'zhipu-en',
    name: 'Zhipu GLM (z.ai)',
    category: 'cn_official',
    baseUrl: 'https://api.z.ai/api/anthropic',
    websiteUrl: 'https://z.ai'
  },
  {
    id: 'qianfan',
    name: 'Baidu Qianfan Coding',
    category: 'cn_official',
    baseUrl: 'https://qianfan.baidubce.com/anthropic/coding',
    websiteUrl: 'https://cloud.baidu.com'
  },
  {
    id: 'bailian',
    name: 'Alibaba Bailian',
    category: 'cn_official',
    baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    websiteUrl: 'https://bailian.console.aliyun.com'
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    category: 'cn_official',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    modelsUrl: 'https://api.moonshot.cn/v1/models',
    websiteUrl: 'https://platform.moonshot.cn'
  },
  {
    id: 'kimi-coding',
    name: 'Kimi For Coding',
    category: 'cn_official',
    baseUrl: 'https://api.kimi.com/coding/',
    websiteUrl: 'https://kimi.com'
  },
  {
    id: 'stepfun',
    name: 'StepFun',
    category: 'cn_official',
    baseUrl: 'https://api.stepfun.com/step_plan',
    websiteUrl: 'https://platform.stepfun.com'
  },
  {
    id: 'modelscope',
    name: 'ModelScope',
    category: 'aggregator',
    baseUrl: 'https://api-inference.modelscope.cn',
    websiteUrl: 'https://modelscope.cn'
  },
  {
    id: 'longcat',
    name: 'Longcat (Meituan)',
    category: 'cn_official',
    baseUrl: 'https://api.longcat.chat/anthropic',
    modelsUrl: 'https://api.longcat.chat/openai/v1/models',
    websiteUrl: 'https://longcat.chat'
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    category: 'cn_official',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    websiteUrl: 'https://platform.minimaxi.com'
  },
  {
    id: 'bailing',
    name: 'BaiLing',
    category: 'cn_official',
    baseUrl: 'https://api.tbox.cn/api/anthropic',
    websiteUrl: 'https://alipaytbox.yuque.com'
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    category: 'cn_official',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    websiteUrl: 'https://platform.xiaomimimo.com'
  },
  {
    id: 'aihubmix',
    name: 'AiHubMix',
    category: 'aggregator',
    baseUrl: 'https://aihubmix.com',
    websiteUrl: 'https://aihubmix.com'
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    category: 'aggregator',
    baseUrl: 'https://api.siliconflow.cn',
    websiteUrl: 'https://siliconflow.cn'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'aggregator',
    baseUrl: 'https://openrouter.ai/api',
    websiteUrl: 'https://openrouter.ai'
  },
  CUSTOM
]

// Codex uses an OpenAI-style base_url (usually ending in /v1).
const CODEX: Provider[] = [
  {
    id: 'official',
    name: 'OpenAI Official',
    category: 'official',
    baseUrl: '',
    websiteUrl: 'https://chatgpt.com/codex',
    note: 'Official account login'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'cn_official',
    baseUrl: 'https://api.deepseek.com',
    modelsUrl: 'https://api.deepseek.com/models',
    websiteUrl: 'https://platform.deepseek.com'
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    category: 'cn_official',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    websiteUrl: 'https://open.bigmodel.cn'
  },
  {
    id: 'qianfan',
    name: 'Baidu Qianfan Coding',
    category: 'cn_official',
    baseUrl: 'https://qianfan.baidubce.com/v2/coding',
    websiteUrl: 'https://cloud.baidu.com'
  },
  {
    id: 'bailian',
    name: 'Alibaba Bailian (Qwen)',
    category: 'cn_official',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    websiteUrl: 'https://bailian.console.aliyun.com'
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    category: 'cn_official',
    baseUrl: 'https://api.moonshot.cn/v1',
    websiteUrl: 'https://platform.moonshot.cn'
  },
  {
    id: 'stepfun',
    name: 'StepFun',
    category: 'cn_official',
    baseUrl: 'https://api.stepfun.com/step_plan/v1',
    websiteUrl: 'https://platform.stepfun.com'
  },
  {
    id: 'modelscope',
    name: 'ModelScope',
    category: 'aggregator',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    websiteUrl: 'https://modelscope.cn'
  },
  {
    id: 'longcat',
    name: 'Longcat (Meituan)',
    category: 'cn_official',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    websiteUrl: 'https://longcat.chat'
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    category: 'cn_official',
    baseUrl: 'https://api.minimaxi.com/v1',
    websiteUrl: 'https://platform.minimaxi.com'
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    category: 'cn_official',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    websiteUrl: 'https://platform.xiaomimimo.com'
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    category: 'aggregator',
    baseUrl: 'https://api.siliconflow.cn/v1',
    websiteUrl: 'https://siliconflow.cn'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'aggregator',
    baseUrl: 'https://openrouter.ai/api/v1',
    websiteUrl: 'https://openrouter.ai'
  },
  CUSTOM
]

const OPENCODE: Provider[] = [
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    category: 'third_party',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    modelsUrl: 'https://opencode.ai/zen/go/v1/models',
    websiteUrl: 'https://opencode.ai/go',
    note: 'OpenAI-compatible endpoint'
  },
  ...CODEX.filter((provider) => provider.id !== 'official')
]

// Gemini uses GOOGLE_GEMINI_BASE_URL, which expects the native Gemini API
// shape — not the OpenAI-compatible shape the CODEX list above assumes — so
// it can't reuse that list. No official-login option: gemini-cli dropped
// free-tier Google-account sign-in on 2026-06-18 (see store.ts
// OFFICIAL_AUTH_CLIS), so API key/relay is the only path that works.
const GEMINI: Provider[] = [CUSTOM]

export const PROVIDERS_BY_CLI: Record<CliId, Provider[]> = {
  'claude-code': CLAUDE,
  codex: CODEX,
  // opencode has no official-login concept. It uses OpenAI-compatible relays,
  // plus OpenCode Go as a normal third-party provider.
  opencode: OPENCODE,
  // pi and Hermes consume OpenAI-compatible relays, so the Codex relay list
  // applies to them too.
  pi: CODEX,
  gemini: GEMINI,
  hermes: CODEX
}

// Category display labels now live in the i18n tables (key `category.<id>`),
// looked up via t('category.' + provider.category) at the call site.
