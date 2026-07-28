# Contributing to Agent Launcher

[English](#english) | [中文](#中文)

## English

Agent Launcher is designed for people who may not be comfortable with command-line tools. Changes must protect their local environment, credentials, existing CLI commands, and native configuration.

### Prerequisites and setup

- Node.js 22 or newer
- The pnpm version declared in `package.json`
- macOS, Windows, or Linux

```bash
git clone https://github.com/<your-account>/agent-launcher.git
cd agent-launcher
pnpm install
pnpm dev
```

Development builds use `~/.agent-launcher/`. Do not point manual tests at credentials or configuration you are not prepared to change.

TypeScript 7 provides the `tsc` executable through the `@typescript/native` alias. The `typescript` package name intentionally points to the TypeScript 6 compatibility API required by typescript-eslint until TypeScript 7 exposes its stable tooling API.

### Development commands

| Command             | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `pnpm dev`          | Run Electron with renderer hot reload        |
| `pnpm verify`       | Typecheck the app and tests, then run Vitest |
| `pnpm lint`         | Run ESLint with warnings treated as failures |
| `pnpm format:check` | Verify Prettier formatting                   |
| `pnpm format`       | Format supported repository files            |
| `pnpm build`        | Typecheck and build into `out/`              |
| `pnpm package`      | Package for the current operating system     |

### Architecture and code rules

- `src/main/` owns files, CLI detection/linking, configuration, PTYs, history, usage, and update checks.
- `src/preload/index.ts` is the typed renderer bridge. Every exposed IPC call must have a matching handler in `src/main/ipc.ts`.
- `src/shared/types.ts` is the shared IPC contract. Update the preload bridge, handlers, consumers, and tests together.
- System CLIs keep their normal config homes. App-managed CLI installs are legacy compatibility only; do not add installation, reinstallation, or update flows.
- Keep native config synchronization in the `synced()` path after profile, auth-mode, or active-profile changes.
- Never log or display real API keys. Mask config and environment data before sending it to the renderer.
- Any UI copy change must update every locale in the same pull request. The locale key-alignment test must continue to pass.
- Use `paths.*` from `src/main/sandbox.ts` for Agent Launcher state. Do not invent parallel data roots.

See [AGENTS.md](./AGENTS.md) for the detailed CLI configuration, discovery, PTY, and history map.

### Testing

Run the complete local gate before opening a pull request:

```bash
pnpm verify
pnpm lint
pnpm format:check
pnpm audit:ci
```

Add focused Vitest coverage for changed logic and file parsing. Changes involving real networks, system CLIs, PTYs, app updates, signing, or native history should also run the relevant `scripts/smoke-*.ts` check or be verified with an installed artifact on the affected operating system.

### Release credentials

The release workflow uses `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for macOS signing and notarization. Windows Authenticode uses `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. When the relevant certificate secret is absent, the workflow explicitly disables automatic certificate discovery and produces unsigned artifacts; signed builds fail if post-build signature or notarization validation fails.

The optional `@claude` workflow requires an `ANTHROPIC_API_KEY` repository secret. Without that secret, do not invoke `@claude` in issues or pull requests.

### Commit messages

Use Conventional Commits. Keep the subject imperative and scoped to one outcome.

```text
feat(workspace): remember the selected project directory
fix(codex): preserve the resume working directory
docs: add bilingual support guidance
chore(deps): update Electron
```

Use `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, or `chore` as appropriate. Mark breaking changes with `!` and explain migration in the body.

### AI-assisted contributions

AI assistance is allowed, but the contributor remains responsible for the result.

- Review every changed line and be able to explain why it is correct.
- Run the required checks locally; generated claims are not test evidence.
- Keep the change small and focused. Do not submit broad generated rewrites with unrelated cleanup.
- Verify third-party API names, versions, licenses, and security-sensitive behavior against primary sources.
- Disclose material AI assistance in the pull request when it shaped the implementation or review.

Maintainers may close an AI-generated pull request without extended review when the author cannot explain it, did not test it, includes fabricated behavior, or creates excessive review burden.

### Pull requests

Describe the user-visible behavior and include exact verification commands and results. Call out changes to user data paths, plaintext secrets, system CLI config, downloaded artifacts, signing, or update feeds. Do not commit `release/`, `out/`, `node_modules/`, local config files, logs, credentials, or unredacted personal paths.

---

## 中文

Agent Launcher 面向不熟悉命令行的用户。任何改动都必须保护用户的本地环境、凭据、现有 CLI 命令和原生配置。

### 环境和启动

- Node.js 22 或更高版本
- `package.json` 中声明的 pnpm 版本
- macOS、Windows 或 Linux

```bash
git clone https://github.com/<your-account>/agent-launcher.git
cd agent-launcher
pnpm install
pnpm dev
```

开发版本同样使用 `~/.agent-launcher/`。不要用你不愿被修改的真实凭据或配置做手动测试。

TypeScript 7 通过 `@typescript/native` 别名提供 `tsc` 命令。在 TypeScript 7 提供稳定工具 API 之前，`typescript` 包名会有意指向 typescript-eslint 所需的 TypeScript 6 兼容 API。

### 开发命令

| 命令                | 用途                            |
| ------------------- | ------------------------------- |
| `pnpm dev`          | 启动 Electron 和渲染进程热更新  |
| `pnpm verify`       | 检查应用和测试类型并运行 Vitest |
| `pnpm lint`         | 运行 ESLint，警告也会导致失败   |
| `pnpm format:check` | 检查 Prettier 格式              |
| `pnpm format`       | 格式化仓库中支持的文件          |
| `pnpm build`        | 类型检查并构建到 `out/`         |
| `pnpm package`      | 为当前操作系统打包              |

### 架构和代码规则

- `src/main/` 负责文件、CLI 检测和关联、配置、PTY、历史、用量及更新检查。
- `src/preload/index.ts` 是带类型的渲染进程桥接。每个暴露的 IPC 调用都必须在 `src/main/ipc.ts` 中有对应处理器。
- `src/shared/types.ts` 是共享 IPC 契约。修改时必须同步 preload、处理器、调用方和测试。
- 系统 CLI 继续使用原本的配置目录。应用托管安装只用于旧版兼容，不要增加安装、重装或更新流程。
- Profile、认证模式或当前 Profile 变化后，原生配置同步必须继续走 `synced()` 路径。
- 不得记录或显示真实 API Key。配置和环境信息发送到渲染进程前必须遮盖密钥。
- 修改任何 UI 文案时，必须在同一个 PR 中同步全部 locale，并保持 locale key 对齐测试通过。
- Agent Launcher 自身状态统一通过 `src/main/sandbox.ts` 的 `paths.*` 解析，不要另建平行数据目录。

CLI 配置、发现、PTY 和历史读取的详细说明见 [AGENTS.md](./AGENTS.md)。

### 测试

提交 PR 前运行完整本地关卡：

```bash
pnpm verify
pnpm lint
pnpm format:check
pnpm audit:ci
```

变更逻辑和文件解析时，应补充聚焦的 Vitest 测试。涉及真实网络、系统 CLI、PTY、应用更新、签名或原生历史时，还应执行相关 `scripts/smoke-*.ts` 检查，或在受影响的系统上安装产物验证。

### 发布凭据

发布流程使用 `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID` 完成 macOS 签名与公证。Windows Authenticode 使用 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD`。缺少对应证书 Secret 时，流程会明确关闭自动证书发现并生成未签名产物；已经配置签名时，签名或公证验证失败会中止发布。

可选的 `@claude` 工作流需要仓库 Secret `ANTHROPIC_API_KEY`。未配置该 Secret 时，不要在 Issue 或 PR 中调用 `@claude`。

### Commit 信息

使用 Conventional Commits，主题使用祈使语气，并聚焦一个结果。

```text
feat(workspace): remember the selected project directory
fix(codex): preserve the resume working directory
docs: add bilingual support guidance
chore(deps): update Electron
```

按情况使用 `feat`、`fix`、`docs`、`test`、`refactor`、`perf`、`build`、`ci` 或 `chore`。破坏性变更使用 `!` 标记，并在正文说明迁移方式。

### AI 辅助贡献

可以使用 AI 辅助，但贡献者始终对结果负责。

- 审阅每一处改动，并能解释为什么它是正确的。
- 在本地运行要求的检查；AI 生成的“已通过”描述不能代替测试证据。
- 保持改动小而聚焦，不要提交夹带无关清理的大范围生成式重写。
- 第三方 API、版本、许可证和安全敏感行为必须用一手资料核实。
- 当 AI 对实现或审阅产生实质影响时，在 PR 中说明。

如果作者无法解释改动、没有测试、包含虚构行为或造成过高审阅负担，维护者可以直接关闭 AI 生成的 PR，无需进行长时间审阅。

### Pull Request

说明用户可见行为，并提供准确的验证命令和结果。涉及用户数据路径、明文密钥、系统 CLI 配置、下载产物、签名或更新源时必须明确指出。不要提交 `release/`、`out/`、`node_modules/`、本地配置、日志、凭据或未遮盖的个人路径。
