<div align="center">
  <img src="src/renderer/src/assets/app-icon.png" width="112" alt="Agent Launcher 图标">
  <h1>Agent Launcher</h1>
  <p>在一个桌面应用中配置和运行现有的编程 Agent CLI。</p>
  <p><a href="./README.md">English</a> | <strong>中文</strong></p>
  <p>
    <a href="https://github.com/WhiteMatrixTech/agent-launcher/actions/workflows/ci.yml"><img src="https://github.com/WhiteMatrixTech/agent-launcher/actions/workflows/ci.yml/badge.svg" alt="CI 状态"></a>
    <a href="https://github.com/WhiteMatrixTech/agent-launcher/releases"><img src="https://img.shields.io/github/v/release/WhiteMatrixTech/agent-launcher?display_name=tag" alt="最新版本"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/github/license/WhiteMatrixTech/agent-launcher" alt="MIT 许可证"></a>
  </p>
</div>

Agent Launcher 是一个本地桌面编程 Agent 工作区。它会检测并关联系统中已有的 CLI，写入账号或服务商配置，再通过内置终端或聊天界面启动 Agent。Agent Launcher 不会安装、重装或更新 Agent CLI。

![Agent Launcher 工作区](docs/images/agent-launcher-workspace.jpg)

## 支持的 Agent

| Agent                                                        | CLI 来源         | 配置和运行方式                      |
| ------------------------------------------------------------ | ---------------- | ----------------------------------- |
| [Claude Code](https://www.anthropic.com/claude-code)         | 系统中已有的安装 | 官方账号或 Anthropic 兼容 API 配置  |
| [Codex CLI](https://github.com/openai/codex)                 | 系统中已有的安装 | ChatGPT 账号或 OpenAI 兼容 API 配置 |
| [OpenCode](https://opencode.ai/)                             | 系统中已有的安装 | OpenAI 兼容服务商                   |
| [Pi](https://github.com/badlogic/pi-mono)                    | 系统中已有的安装 | OpenAI 兼容服务商                   |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli)    | 系统中已有的安装 | Google API Key 或兼容服务商         |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | 系统中已有的安装 | 现有账号或 OpenAI 兼容服务商        |

## 安装

从 [GitHub Releases](https://github.com/WhiteMatrixTech/agent-launcher/releases) 下载对应安装包：

- macOS：Intel 和 Apple 芯片版本的 DMG、ZIP
- Windows：NSIS 安装包
- Linux：AppImage

首次启动时，Agent Launcher 会检测现有 CLI 命令；如果发现多个副本，可以选择要关联的路径。缺少的 CLI 需要按照对应项目的官方文档单独安装。

## 功能

### 引导配置和 CLI 关联

首次运行向导会检查本地环境、关联已有 Agent 命令，并引导完成官方账号或 API 配置。缺少 CLI 时会提供官方安装文档链接。旧版应用托管的安装仍然可读，已有用户迁移时不会丢失配置。

### 面向项目的会话

启动会话前可以选择或拖入项目文件夹。Agent Launcher 会记住最近目录，并把它作为 CLI 的工作目录。恢复历史会话时则使用该 CLI 记录的工作目录。

### 多配置和连通性测试

![服务商配置和原生配置预览](docs/images/agent-launcher-profiles.jpg)

每个 Agent 可以保存多套服务商配置。配置变更后，Agent Launcher 会同步该 CLI 所需的环境变量和原生配置文件。连通性测试会发送一次最小真实模型请求，确认接口、密钥、模型、网络和账号状态。

原生配置预览会在界面中遮盖密钥。支持的目标包括 Claude Code 设置、Codex `config.toml` 和 `auth.json`、OpenCode `opencode.json`、Pi 模型和设置、Gemini 配置以及 Hermes Agent 配置文件。

### 会话、MCP、Skills 和用量

Agent Launcher 直接读取各 CLI 保存在本机的会话历史，支持相关 JSONL 和 SQLite 格式，也可以恢复或删除底层会话记录。

![MCP 服务管理](docs/images/agent-launcher-mcp.jpg)

应用可以查看已安装的 MCP 服务和 Skills，但不会从远程目录安装 Skills。用量页面汇总本地记录中的 Token、请求、会话、模型以及可选的本地价格信息。

## 隐私和安全

Agent Launcher 以本地处理为主，但并非完全离线。运行 Agent 时，请求会发送到当前配置选择的官方服务或中转接口；版本检查可能访问 npm、PyPI 或 GitHub。

API Key 会按产品设计以明文保存在 `~/.agent-launcher/config.json`，必要时也会写入 CLI 的原生配置文件。界面会遮盖密钥，但本机用户仍能读取这些文件。会话历史和用量数据只在本机读取，不会上传到独立统计服务。

安全问题请按 [安全策略](./SECURITY.md) 提交。

## 常见问题

<details>
<summary>数据保存在什么位置？</summary>

Agent Launcher 自身状态保存在 `~/.agent-launcher/`，其中 `config.json` 包含明文服务商密钥。关联的系统 CLI 继续使用它们原本的配置和历史目录。旧版由应用托管的 CLI 目录会继续保留读取兼容。

</details>

<details>
<summary>为什么只关联 CLI，而不直接安装？</summary>

CLI 始终由用户以及它的官方安装器或包管理器负责。这样可以避免应用静默替换命令、修改全局 npm 状态，或把系统 CLI 重定向到应用专用配置目录。

</details>

<details>
<summary>为什么系统会警告安装包来源不明？</summary>

仓库配置了签名密钥时，发布流程会签名并验证产物。没有 Windows 证书时，流程会明确产出未签名版本，Windows SmartScreen 可能显示“未知发布者”。没有 Apple 签名和公证凭据时，macOS 产物同样会明确保持未签名。部分 Linux 发行版运行 AppImage 时需要 FUSE 2，也可以选择解包运行。

</details>

<details>
<summary>支持哪些环境变量覆盖？</summary>

下游构建可以通过 `AGENT_LAUNCHER_UPDATE_OWNER`、`AGENT_LAUNCHER_UPDATE_REPO` 和 `AGENT_LAUNCHER_UPDATE_POLICY_URL` 重定向更新检查。对应 CLI 使用时，`CODEX_HOME`、`GEMINI_CLI_HOME`、`HERMES_HOME` 以及 XDG 配置和数据目录变量也会被尊重。启动进程时，当前启用的 API 配置会有意覆盖对应服务商的认证变量。

</details>

## 开发

需要 Node.js 22 或更高版本，以及 `package.json` 中声明的 pnpm 版本。

```bash
pnpm install
pnpm dev
pnpm verify
pnpm lint
pnpm format:check
pnpm build
```

架构、代码规范、测试、提交和 PR 要求见 [CONTRIBUTING.md](./CONTRIBUTING.md)。使用问题和 Bug 提交方式见 [SUPPORT.md](./SUPPORT.md)。

## 项目链接

- [变更日志](./CHANGELOG.md)
- [行为准则](./CODE_OF_CONDUCT.md)
- [安全策略](./SECURITY.md)
- [Discussions](https://github.com/WhiteMatrixTech/agent-launcher/discussions)
- [Issue](https://github.com/WhiteMatrixTech/agent-launcher/issues)

## 许可证

Agent Launcher 使用 [MIT License](./LICENSE)。
