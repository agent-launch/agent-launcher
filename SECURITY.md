# Security Policy / 安全策略

## Supported Versions / 支持版本

The `main` branch and the latest GitHub Release are the supported targets.

`main` 分支和最新 GitHub Release 是当前支持范围。

Upgrade first and confirm that the issue still reproduces before reporting a problem from an older build.

如果问题来自旧版本，请先升级并确认问题仍能复现。

## Reporting a Vulnerability / 报告漏洞

Use [GitHub private vulnerability reporting](https://github.com/WhiteMatrixTech/agent-launcher/security/advisories/new).

请使用 [GitHub 私密漏洞报告](https://github.com/WhiteMatrixTech/agent-launcher/security/advisories/new)。

If private reporting is unavailable, email [contact@whitematrix.io](mailto:contact@whitematrix.io) with a minimal description and ask for a secure follow-up channel.

如果私密报告不可用，请向 [contact@whitematrix.io](mailto:contact@whitematrix.io) 发送最小说明，并请求后续安全沟通渠道。

Do not include exploit details, real API keys, tokens, private conversations, user-path screenshots, or full logs in a public issue.

不要在公开 Issue 中包含利用细节、真实 API Key、Token、私人对话、带用户路径的截图或完整日志。

A useful private report includes the affected version, operating system and CPU architecture, reproduction steps, expected impact, and minimal redacted logs.

有效的私密报告应包含受影响版本、操作系统和 CPU 架构、复现步骤、预期影响以及最小化的脱敏日志。

Tell us whether the issue involves plaintext secrets, arbitrary file access, command execution, update feeds, release signing, or native CLI configuration.

请说明问题是否涉及明文密钥、任意文件访问、命令执行、更新源、发布签名或 CLI 原生配置。

## Response / 响应流程

Maintainers will acknowledge the report, confirm impact, decide on a fix and release plan, and coordinate disclosure.

维护者会确认收到报告、核实影响、制定修复和发布计划，并协调披露时间。

Secret exposure, arbitrary code execution, update-chain compromise, signature bypass, and unintended native-config modification are treated as high priority.

密钥泄露、任意代码执行、更新链路被控制、签名绕过以及非预期修改原生配置会按高优先级处理。

Please allow maintainers a reasonable remediation window before public disclosure.

公开披露前，请为维护者保留合理的修复时间。

## Design Note / 设计说明

Agent Launcher intentionally stores provider API keys in plaintext local config files and masks them in the UI.

Agent Launcher 按产品设计将服务商 API Key 明文保存在本地配置文件中，并在界面中遮盖显示。

That documented choice is not itself a vulnerability, but unexpected upload, public display, remote transmission, or access outside the intended local-user boundary should be reported.

该已公开说明的选择本身不属于漏洞，但任何非预期上传、公开展示、远程发送或越过预期本地用户边界的访问都应报告。
