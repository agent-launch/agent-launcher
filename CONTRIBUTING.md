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

On macOS, `pnpm package` and `pnpm package:mac` require a Developer ID identity in the keychain; see [Release credentials](#release-credentials).

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

The release workflow uses `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for macOS signing and notarization. Windows Authenticode uses `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. Signed builds fail if post-build signature or notarization validation fails.

On CI the certificate is imported by the _Import macOS signing certificate_ step rather than by electron-builder, and handed over through `CSC_KEYCHAIN`. electron-builder's own `createKeychain` creates its temporary keychain with a random password but then runs `security set-key-partition-list -k <CSC_KEY_PASSWORD>` — the `.p12` export password rather than the keychain's — which is a no-op while the keychain is unlocked and fails with `SecKeychainUnlock: The user name or passphrase you entered is not correct` when it is not. `CSC_LINK` is therefore left unset for macOS, because `CSC_KEYCHAIN` is only honoured in its absence.

macOS and Windows behave differently when the certificate secret is absent:

- **macOS is a hard failure.** `mac.forceCodeSigning: true` in `electron-builder.yml` turns a missing certificate into a build error rather than a silently unsigned app, which is the failure mode that produced the _"damaged and can't be opened"_ Gatekeeper dialog. Because the `release` job needs every build job, a missing `MAC_CSC_LINK` blocks the Windows and Linux releases for that tag as well; the _Require macOS signing credentials_ step fails fast and says so. This also means a local `pnpm package` / `pnpm package:mac` needs a Developer ID identity in the keychain — `identity: null` and `CSC_IDENTITY_AUTO_DISCOVERY=false` both still throw, so the only local workaround is to drop the flag.
- **Windows is deliberately still soft.** Without `WIN_CSC_LINK` the workflow disables automatic certificate discovery and produces an unsigned `.exe`. This is a known gap, not an oversight: hardening it the same way would block releases on a second unset secret. Revisit it once `WIN_CSC_LINK` is configured.

Pull-request builds are exempt from all of this — electron-builder skips signing on them before `forceCodeSigning` is ever consulted.

### Release gates

Every tag publishes as a **prerelease**. `releases/latest` skips prereleases and that is the endpoint `src/main/app-update.ts` polls, so promoting a prerelease to a full release is the deliberate, manual step that hands the build to updater clients. Three consequences follow:

- A prerelease is still publicly visible and downloadable at `/releases`. The gate protects updater clients, not someone browsing the releases page.
- Nothing mechanically prevents promoting a `v*-beta` tag. Promote only tags without a prerelease suffix; promoting a beta pushes it to every installed client.
- `update-policy.json` is a **second, independent update channel**, read from `main` over `raw.githubusercontent.com` rather than from a release. Its `latestVersion` drives the in-app update banner (and `force` can make it mandatory) regardless of whether a release has been promoted. Bump it only _after_ promoting, or the prerelease gate is bypassed. CI enforces this: the `update-policy-gate` job (`scripts/check-update-policy.mjs`) fails any push or PR whose `latestVersion`/`minVersion` is ahead of the last promoted release.

#### Cutting a release

Run the **tag** workflow from the Actions tab with the version only, no leading `v` (for example `0.2.0-rc.1`). It validates the version against the same pattern `release.yml` enforces, refuses a version that already has a tag, refuses a commit whose checks are not all green, creates the tag, and starts the release build.

The tag is the sole source of truth for the version — `release.yml` overwrites `package.json`'s value from it — so there is no version bump to commit first.

The workflow dispatches `release.yml` explicitly rather than relying on the tag push. A tag created with `GITHUB_TOKEN` raises no event that can start a workflow (GitHub suppresses those to prevent recursion), and `workflow_dispatch` is one of the two exemptions, so this is the path that works without a personal access token.

Promotion stays manual and deliberately outside the workflow.

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

在 macOS 上，`pnpm package` 和 `pnpm package:mac` 需要钥匙串中存在 Developer ID 身份，详见下方“发布凭据”。

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

发布流程使用 `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID` 完成 macOS 签名与公证。Windows Authenticode 使用 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD`。已经配置签名时，签名或公证验证失败会中止发布。

CI 上的证书由 _Import macOS signing certificate_ 步骤导入，而不是交给 electron-builder，再通过 `CSC_KEYCHAIN` 传递。electron-builder 自带的 `createKeychain` 用随机密码创建临时钥匙串，却用 `security set-key-partition-list -k <CSC_KEY_PASSWORD>`（`.p12` 的导出密码，而非钥匙串密码）去解锁：钥匙串处于解锁状态时这是空操作，一旦上锁就会报 `SecKeychainUnlock: The user name or passphrase you entered is not correct`。因此 macOS 不设 `CSC_LINK`——`CSC_KEYCHAIN` 只在它缺席时才生效。

缺少证书 Secret 时，macOS 和 Windows 行为不同：

- **macOS 会直接失败。** `electron-builder.yml` 中的 `mac.forceCodeSigning: true` 把缺证书从“静默产出未签名应用”变成构建报错——正是这种未签名产物导致过 Gatekeeper 的 _"已损坏，无法打开"_ 弹窗。由于 `release` job 依赖全部 build job，缺少 `MAC_CSC_LINK` 会连带阻塞该 tag 的 Windows 和 Linux 发布；_Require macOS signing credentials_ 步骤会提前失败并说明原因。这也意味着本地执行 `pnpm package` / `pnpm package:mac` 需要钥匙串中有 Developer ID 身份——`identity: null` 和 `CSC_IDENTITY_AUTO_DISCOVERY=false` 都仍会抛错，本地唯一的绕过方式是临时去掉该标志。
- **Windows 目前刻意保持宽松。** 缺少 `WIN_CSC_LINK` 时流程会关闭自动证书发现并产出未签名 `.exe`。这是已知状态而非疏漏：同样加固会让发布再多依赖一个尚未配置的 Secret。等 `WIN_CSC_LINK` 配好后再收紧。

PR 构建不受以上限制——electron-builder 在读取 `forceCodeSigning` 之前就跳过了 PR 的签名流程。

### 发布门禁

每个 tag 都以 **prerelease** 发布。`releases/latest` 会跳过 prerelease，而它正是 `src/main/app-update.ts` 轮询的端点，所以“提升为正式 release”是把构建交给更新客户端的那一步人工动作。由此有三点需要注意：

- prerelease 对外仍然可见、可下载。该门禁保护的是更新客户端，不是访问 releases 页面的人。
- 没有任何机制阻止把 `v*-beta` 这样的 tag 提升为正式 release。只提升不带 prerelease 后缀的 tag；提升 beta 会把它推给所有已安装客户端。
- `update-policy.json` 是**第二条独立更新通道**，通过 `raw.githubusercontent.com` 从 `main` 读取，而不是从 release 读取。无论 release 是否被提升，它的 `latestVersion` 都会驱动应用内更新提示（`force` 还能让更新变成强制）。因此只在提升之后再修改它，否则 prerelease 门禁形同虚设。

#### 发布一个版本

在 Actions 页运行 **tag** 工作流，只填版本号、不带前导 `v`（例如 `0.2.0-rc.1`）。它会用 `release.yml` 使用的同一条正则校验版本号，拒绝已存在的 tag，拒绝检查未全绿的提交，然后创建 tag 并启动发布构建。

tag 是版本号的唯一真相来源——`release.yml` 会用它覆盖 `package.json` 中的值——因此不需要先提交一次版本号变更。

该工作流显式 dispatch `release.yml`，而不是依赖 tag 推送触发。用 `GITHUB_TOKEN` 创建的 tag 不会产生能启动工作流的事件（GitHub 为防递归屏蔽了它们），而 `workflow_dispatch` 是两个例外之一，所以这条路径无需个人访问令牌即可工作。

提升为正式发布仍然是人工操作，刻意不纳入工作流。

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
