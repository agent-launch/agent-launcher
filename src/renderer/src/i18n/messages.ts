/*
 * UI string tables. Keys are flat + dot-namespaced; `{name}`-style placeholders
 * are substituted by translate() in ./index.ts. Brand/proper names (CLI names,
 * vendors, provider names, CLI flags) are intentionally NOT here — they stay
 * literal in the data modules.
 */

export const messages: Record<'zh' | 'en', Record<string, string>> = {
  zh: {
    // ---- common ----
    'common.close': '关闭',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.add': '添加',
    'common.edit': '编辑',
    'common.delete': '删除',
    'common.loading': '加载中…',

    // ---- sidebar ----
    'sidebar.agents': '智能体',
    'sidebar.expand': '展开侧栏',
    'sidebar.collapse': '收起侧栏',
    'sidebar.installed': '已安装',
    'sidebar.notInstalled': '未安装',
    'sidebar.settings': '设置',
    'sidebar.rerunOnboarding': '重新运行引导',

    // ---- shell ----
    'shell.tabRun': '运行',
    'shell.tabConfig': '配置',
    'shell.pickDir': '选择项目目录',
    'shell.pickDirEmpty': '~/选择项目目录',
    'shell.history': '历史会话',
    'shell.refresh': '刷新',
    'shell.openTerminal': '打开终端',
    'shell.launch': '启动 {name}',
    'shell.installFirst': '请先在引导中安装',
    'shell.noResume': '该 CLI 暂不支持恢复历史会话',
    'shell.noHistory': '还没有 {name} 历史会话，点右上角启动一个新会话开始吧',
    'shell.loadingSessions': '读取中…',
    'shell.resume': '恢复 →',
    'shell.resumeTitle': '恢复这个会话',

    // ---- terminal ----
    'terminal.exited': '[进程已退出 code={code}]',
    'terminal.launchFailed': '启动失败: {error}',

    // ---- settings ----
    'settings.title': '设置',
    'settings.appearance': '外观',
    'settings.language': '语言',
    'settings.theme.system': '跟随系统',
    'settings.theme.light': '浅色',
    'settings.theme.dark': '深色',
    'settings.locale.system': '跟随系统',
    'settings.locale.zh': '中文',
    'settings.locale.en': 'English',
    'settings.yolo.title': 'YOLO 模式',
    'settings.yolo.danger': '危险',
    'settings.yolo.desc':
      '开启后，对应 CLI 会自动批准所有操作（执行命令、改文件等），不再逐次确认。省事但有风险，只在你信任当前项目时开启。每个 CLI 独立设置。',
    'settings.yolo.unsupported': '该 CLI 无自动批准开关（仅工具白/黑名单）',
    'settings.yolo.notSupported': '不支持',
    'settings.renderTranscript': '在 UI 中渲染聊天记录',
    'settings.renderTranscriptDesc': '点击历史会话时，先在界面里展示对话内容；关闭则直接在终端恢复会话。',

    // ---- transcript view ----
    'transcript.back': '返回',
    'transcript.resume': '在终端继续',
    'transcript.loading': '读取对话中…',
    'transcript.empty': '无法解析这个会话的对话内容',
    'transcript.truncated': '对话较长，仅显示最近的部分',
    'transcript.thinking': '思考过程',
    'transcript.role.user': '你',
    'transcript.role.assistant': '助手',
    'transcript.role.system': '系统',

    // ---- in-UI chat ----
    'chat.start': '在 UI 中聊天',
    'chat.onlyClaude': 'Gemini CLI 暂不支持 UI 聊天，请使用终端',
    'chat.newChat': '新对话',
    'chat.placeholder': '输入消息，Enter 发送，Shift+Enter 换行',
    'chat.send': '发送',
    'chat.openInTerminal': '在终端打开',
    'chat.streaming': '正在思考…',
    'chat.empty': '发条消息开始对话吧',

    // ---- onboarding: steps ----
    'onboarding.step.welcome': '欢迎',
    'onboarding.step.detect': '检测环境',
    'onboarding.step.install': '自动安装',
    'onboarding.step.config': '配置中转',
    'onboarding.step.run': '开跑',
    'onboarding.setupHeading': '首次设置',
    'onboarding.skip': '跳过引导',
    'onboarding.back': '上一步',
    'onboarding.next': '下一步',
    'onboarding.finish': '完成，进入主界面',

    // ---- onboarding: welcome ----
    'onboarding.welcomeTitle': '欢迎使用 AgentLauncher',
    'onboarding.welcomeDesc':
      '不用装 Node、不用配环境变量、不用碰命令行。接下来几分钟，我们帮你装好并配好 Claude Code / Codex / Gemini CLI，直接开跑。',

    // ---- onboarding: detect ----
    'onboarding.detectTitle': '检测你的环境',
    'onboarding.detectDesc': '看看系统里已经有什么、还缺什么。缺的我们会自动补上。',
    'onboarding.detecting': '检测中…',

    // ---- onboarding: install ----
    'onboarding.installTitle': '一键安装 CLI',
    'onboarding.installDesc': '全部装进独立沙盒 ~/.agent-launcher，不污染你已有的环境。',
    'onboarding.installed': '已安装{version}',
    'onboarding.installing': '安装中',
    'onboarding.nativeBinary': '原生二进制（无需 Node）',
    'onboarding.portableNode': '便携 Node + npm',
    'onboarding.installDone': '完成',
    'onboarding.installBusy': '安装中…',
    'onboarding.installBtn': '安装',
    'onboarding.reinstallBtn': '重装',
    'onboarding.installAll': '一键全部安装',

    // ---- onboarding: config ----
    'onboarding.configTitle': '选个中转，粘上 Key',
    'onboarding.configDesc':
      '国内直连不了官方？选一家中转，粘上 API Key。配置存在本地（明文 JSON），env 由 app 注入。',
    'onboarding.saveConfig': '保存配置',
    'onboarding.saved': '已保存 ✓',

    // ---- onboarding: done ----
    'onboarding.doneTitle': '一切就绪',
    'onboarding.doneDesc':
      '点「完成」进入主界面，选个项目目录就能开始和 Claude Code 对话了。环境变量我们已经替你注入，你永远不用 export。',

    // ---- config view ----
    'config.title': '配置管理',
    'config.openAgentDir': '打开本 agent 目录',
    'config.openConfig': '应用配置 config.json',
    'config.intro':
      '每个 CLI 可存多套配置，一键切换当前生效的那套。配置统一存在全局 ~/.agent-launcher/config.json（所有 agent 共用，明文 JSON）；该 agent 实际读取的文件在 ~/.agent-launcher/cli-config/{cliId}/。',
    'config.noProfiles': '还没有配置，点下方「新增配置」。',
    'config.setActive': '设为当前生效',
    'config.active': '生效中',
    'config.officialDefault': '官方默认',
    'config.addProfile': '+ 新增配置',
    'config.resolvedEnv': '环境变量预览',
    'config.resolvedEnvDesc': '启动 {cliId} 时实际注入的环境变量（密钥已脱敏）。你永远不需要手动 export。',
    'config.noEnv': '（当前配置无注入项）',
    'config.nativeFiles': '原生配置文件',
    'config.openDir': '打开目录',
    'config.nativeFilesDesc': '该 CLI 从这个目录读自己的配置文件（非纯环境变量）。切换配置时会自动写入：',
    'config.selectPlaceholder': '— 选择 —',
    'config.provider': '中转商',
    'config.profileName': '配置名称',
    'config.profileNamePlaceholder': '如 AiHubMix · Opus',
    'config.modelOptional': 'Model（可选）',
    'config.modelPlaceholder': '如 opus',

    // ---- provider categories ----
    'category.official': '官方',
    'category.cn_official': '国内官方',
    'category.aggregator': '聚合',
    'category.third_party': '中转',
    'category.cloud_provider': '云厂商',
    'category.custom': '自定义'
  },

  en: {
    // ---- common ----
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.add': 'Add',
    'common.edit': 'Edit',
    'common.delete': 'Delete',
    'common.loading': 'Loading…',

    // ---- sidebar ----
    'sidebar.agents': 'Agents',
    'sidebar.expand': 'Expand sidebar',
    'sidebar.collapse': 'Collapse sidebar',
    'sidebar.installed': 'Installed',
    'sidebar.notInstalled': 'Not installed',
    'sidebar.settings': 'Settings',
    'sidebar.rerunOnboarding': 'Rerun setup',

    // ---- shell ----
    'shell.tabRun': 'Run',
    'shell.tabConfig': 'Config',
    'shell.pickDir': 'Choose a project folder',
    'shell.pickDirEmpty': '~/Choose a project folder',
    'shell.history': 'History',
    'shell.refresh': 'Refresh',
    'shell.openTerminal': 'Open terminal',
    'shell.launch': 'Launch {name}',
    'shell.installFirst': 'Install it in setup first',
    'shell.noResume': "This CLI can't resume past sessions yet",
    'shell.noHistory': 'No {name} sessions yet — start one from the top-right.',
    'shell.loadingSessions': 'Loading…',
    'shell.resume': 'Resume →',
    'shell.resumeTitle': 'Resume this session',

    // ---- terminal ----
    'terminal.exited': '[process exited code={code}]',
    'terminal.launchFailed': 'Launch failed: {error}',

    // ---- settings ----
    'settings.title': 'Settings',
    'settings.appearance': 'Appearance',
    'settings.language': 'Language',
    'settings.theme.system': 'System',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',
    'settings.locale.system': 'System',
    'settings.locale.zh': '中文',
    'settings.locale.en': 'English',
    'settings.yolo.title': 'YOLO mode',
    'settings.yolo.danger': 'Risky',
    'settings.yolo.desc':
      'When on, the CLI auto-approves every action (running commands, editing files, etc.) without asking each time. Convenient but risky — only enable it for projects you trust. Set per CLI.',
    'settings.yolo.unsupported': 'This CLI has no auto-approve switch (allow/deny lists only)',
    'settings.yolo.notSupported': 'Unsupported',
    'settings.renderTranscript': 'Render chat history in UI',
    'settings.renderTranscriptDesc':
      'When you click a past session, show the conversation in the app first; off resumes straight in the terminal.',

    // ---- transcript view ----
    'transcript.back': 'Back',
    'transcript.resume': 'Continue in terminal',
    'transcript.loading': 'Loading conversation…',
    'transcript.empty': "Couldn't parse this session's conversation",
    'transcript.truncated': 'Long conversation — showing the most recent part',
    'transcript.thinking': 'Thinking',
    'transcript.role.user': 'You',
    'transcript.role.assistant': 'Assistant',
    'transcript.role.system': 'System',

    // ---- in-UI chat ----
    'chat.start': 'Chat here',
    'chat.onlyClaude': "Gemini CLI doesn't support in-UI chat yet; use the terminal",
    'chat.newChat': 'New chat',
    'chat.placeholder': 'Type a message — Enter to send, Shift+Enter for newline',
    'chat.send': 'Send',
    'chat.openInTerminal': 'Open in terminal',
    'chat.streaming': 'Thinking…',
    'chat.empty': 'Send a message to start the conversation',

    // ---- onboarding: steps ----
    'onboarding.step.welcome': 'Welcome',
    'onboarding.step.detect': 'Detect',
    'onboarding.step.install': 'Install',
    'onboarding.step.config': 'Configure',
    'onboarding.step.run': 'Run',
    'onboarding.setupHeading': 'First-time setup',
    'onboarding.skip': 'Skip setup',
    'onboarding.back': 'Back',
    'onboarding.next': 'Next',
    'onboarding.finish': 'Finish & open app',

    // ---- onboarding: welcome ----
    'onboarding.welcomeTitle': 'Welcome to AgentLauncher',
    'onboarding.welcomeDesc':
      "No installing Node, no environment variables, no command line. In the next few minutes we'll install and configure Claude Code / Codex / Gemini CLI for you, ready to go.",

    // ---- onboarding: detect ----
    'onboarding.detectTitle': 'Detect your environment',
    'onboarding.detectDesc': "Let's see what you already have and what's missing — we'll fill the gaps automatically.",
    'onboarding.detecting': 'Detecting…',

    // ---- onboarding: install ----
    'onboarding.installTitle': 'One-click install',
    'onboarding.installDesc': 'Everything goes into an isolated sandbox ~/.agent-launcher — your existing setup is untouched.',
    'onboarding.installed': 'Installed{version}',
    'onboarding.installing': 'Installing',
    'onboarding.nativeBinary': 'Native binary (no Node)',
    'onboarding.portableNode': 'Portable Node + npm',
    'onboarding.installDone': 'Done',
    'onboarding.installBusy': 'Installing…',
    'onboarding.installBtn': 'Install',
    'onboarding.reinstallBtn': 'Reinstall',
    'onboarding.installAll': 'Install all',

    // ---- onboarding: config ----
    'onboarding.configTitle': 'Pick a relay, paste your key',
    'onboarding.configDesc':
      "Can't reach the official API directly? Pick a relay and paste an API key. Config is stored locally (plaintext JSON); env is injected by the app.",
    'onboarding.saveConfig': 'Save config',
    'onboarding.saved': 'Saved ✓',

    // ---- onboarding: done ----
    'onboarding.doneTitle': 'All set',
    'onboarding.doneDesc':
      'Click "Finish" to open the app, pick a project folder, and start talking to Claude Code. We\'ve already injected the environment variables — you never need to export anything.',

    // ---- config view ----
    'config.title': 'Configuration',
    'config.openAgentDir': "Open this agent's folder",
    'config.openConfig': 'App config (config.json)',
    'config.intro':
      'Each CLI can hold multiple configs; switch the active one with a click. All configs are stored together in the global ~/.agent-launcher/config.json (shared by every agent, plaintext JSON); the files this agent actually reads live in ~/.agent-launcher/cli-config/{cliId}/.',
    'config.noProfiles': 'No configs yet — click "Add config" below.',
    'config.setActive': 'Set as active',
    'config.active': 'Active',
    'config.officialDefault': 'Official default',
    'config.addProfile': '+ Add config',
    'config.resolvedEnv': 'Resolved Environment',
    'config.resolvedEnvDesc':
      'The environment variables actually injected when launching {cliId} (secrets masked). You never need to export anything.',
    'config.noEnv': '(nothing injected for this config)',
    'config.nativeFiles': 'Native config files',
    'config.openDir': 'Open folder',
    'config.nativeFilesDesc':
      'This CLI reads its own config files from this folder (not just env vars). They are rewritten when you switch configs:',
    'config.selectPlaceholder': '— Select —',
    'config.provider': 'Relay',
    'config.profileName': 'Config name',
    'config.profileNamePlaceholder': 'e.g. AiHubMix · Opus',
    'config.modelOptional': 'Model (optional)',
    'config.modelPlaceholder': 'e.g. opus',

    // ---- provider categories ----
    'category.official': 'Official',
    'category.cn_official': 'CN official',
    'category.aggregator': 'Aggregator',
    'category.third_party': 'Relay',
    'category.cloud_provider': 'Cloud',
    'category.custom': 'Custom'
  }
}
