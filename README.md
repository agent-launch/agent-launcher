<div align="center">
  <img src="src/renderer/src/assets/app-icon.png" width="112" alt="Agent Launcher icon">
  <h1>Agent Launcher</h1>
  <p>Install, configure, and run coding-agent CLIs from one desktop app.</p>
  <p>
    <a href="https://github.com/matrixlabs/agent-launcher/actions/workflows/ci.yml"><img src="https://github.com/matrixlabs/agent-launcher/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
    <a href="https://github.com/matrixlabs/agent-launcher/releases"><img src="https://img.shields.io/github/v/release/matrixlabs/agent-launcher?display_name=tag" alt="Latest release"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/github/license/matrixlabs/agent-launcher" alt="MIT license"></a>
  </p>
</div>

Agent Launcher is a local desktop workspace for coding-agent CLIs. It handles installation, account and provider configuration, native config files, sessions, usage, MCP servers, Skills, terminals, and updates through a graphical interface, so using an agent does not require managing Node.js, environment variables, or CLI config files by hand.

![Agent Launcher workspace](docs/images/agent-launcher-workspace.jpg)

## Contents

- [Supported Agents](#supported-agents)
- [Install](#install)
- [Features](#features)
- [How Agent Launcher Works](#how-agent-launcher-works)
- [Platforms](#platforms)
- [Privacy and Security](#privacy-and-security)
- [Development](#development)
- [Project](#project)

## Supported Agents

| Agent | Installation | Configuration and runtime |
| --- | --- | --- |
| [Claude Code](https://www.anthropic.com/claude-code) | Sandboxed native binary or an existing system install | Official account or Anthropic-compatible API profiles |
| [Codex CLI](https://github.com/openai/codex) | Sandboxed native binary or an existing system install | ChatGPT account or OpenAI-compatible API profiles |
| [OpenCode](https://opencode.ai/) | Sandboxed native binary or an existing system install | OpenAI-compatible providers |
| [Pi](https://github.com/badlogic/pi-mono) | Sandboxed portable Node.js runtime or an existing system install | OpenAI-compatible providers |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Official system-managed install | Existing account or OpenAI-compatible providers |

## Install

Download the appropriate package from [GitHub Releases](https://github.com/matrixlabs/agent-launcher/releases).

- macOS: DMG and ZIP
- Windows: NSIS installer
- Linux: AppImage

On first launch, Agent Launcher can detect existing CLIs on your `PATH`, link to a system install, or install supported agents into its own sandbox.

## Features

### Guided setup and installation

The first-run wizard checks the local environment, detects existing agent binaries, installs missing sandbox-managed agents, and walks through account or API configuration. Claude Code and Codex CLI can use official login flows; supported agents can also use provider presets or custom compatible endpoints.

For sandbox installs, Agent Launcher downloads the correct native binary package for your OS and CPU. Pi is installed as a Node app using a portable Node.js runtime that lives inside the sandbox. Hermes Agent stays system-managed.

### Isolated agent environments

Sandbox-managed binaries, portable Node.js, npm cache, credentials, and redirected CLI config directories stay under `~/.agent-launcher/`. Agent Launcher does not modify global npm settings, does not read or rewrite `~/.npmrc`, and does not replace existing CLI installations.

System-installed agents are used only when you select or link them. In that mode, the CLI keeps using its normal system-managed config home and history.

### Workspace, terminal, chat, and sessions

The main workspace shows every configured agent in one sidebar, with local session history for the selected CLI. You can start a fresh session, resume a saved conversation, delete local session records, open the agent in an external terminal, or use an in-app chat workflow where supported.

Agent Launcher reads the CLIs' own local history formats instead of uploading conversation data. It understands Claude Code, Codex CLI, and Pi JSONL histories, plus OpenCode's SQLite-backed storage. Workspace tabs let multiple terminals, chats, and transcripts stay open at once, with keyboard tab navigation.

### Profiles and native config sync

![Provider profiles and native config preview](docs/images/agent-launcher-profiles.jpg)

Each agent can keep multiple profiles. A profile can represent an official account, a preset relay, or a custom OpenAI/Anthropic-compatible endpoint with its own base URL, API key, and model.

When the active profile changes, Agent Launcher synchronizes both runtime environment variables and native config files expected by the underlying CLI. Native config previews are shown in the UI with secrets masked, so you can verify what will be written without exposing full keys on screen.

Supported native config targets include Claude Code settings, Codex `config.toml` and `auth.json`, OpenCode `opencode.json`, Pi `models.json` and settings, and Hermes Agent config/env files.

### MCP servers

![MCP server management](docs/images/agent-launcher-mcp.jpg)

Agent Launcher reads MCP server entries from each agent's native configuration and shows transport type, command or URL, enabled state, and source file. Codex plugin-bundled MCP servers are shown as read-only entries so you can inspect them without accidentally editing plugin-managed resources.

Supported MCP config styles include Codex TOML, Claude-style JSON `mcpServers`, OpenCode JSON MCP entries, and Hermes YAML configuration.

### Skills

![Installed Skills](docs/images/agent-launcher-skills.jpg)

Installed Skills are displayed from the selected agent's managed skill roots. You can filter by name, source, or path, and open a Skill to inspect its `SKILL.md` content from inside the app. Agent Launcher can also search and install Skills from [skills.sh](https://skills.sh/) for supported agents.

### Usage dashboard

![Usage dashboard](docs/images/agent-launcher-usage.jpg)

The Usage tab summarizes local agent activity across token totals, request counts, active days, session counts, model distribution, daily usage, and per-agent breakdowns. Optional local model-pricing records can be used to organize cost information without sending usage data to another service.

### Permission and update controls

CLI-specific permission bypass settings are exposed only when the underlying agent supports them. For example, Codex and Claude Code have different auto-approve flags, and Pi does not expose one.

The Settings area can check installed CLI versions, update individual agents without changing their selected install source, and check GitHub Releases for supported app updates.

### Themes and localization

Agent Launcher supports light, dark, and system themes. The app UI is localized in Chinese and English, while open-source docs and package metadata are English-first.

## How Agent Launcher Works

Agent Launcher is an Electron app with a React renderer and a TypeScript main process. The renderer talks to the main process only through the typed preload bridge. The main process owns filesystem access, installation, config writing, PTY sessions, usage scans, and update checks.

Agent configuration is applied in two layers:

- Environment variables point each sandbox-managed CLI at its isolated config directory and selected provider endpoint.
- Native config files are written for CLIs that require file-based configuration in addition to, or instead of, environment variables.

This keeps the visible UI simple while still matching each CLI's real runtime expectations.

## Platforms

Release builds are available for macOS, Windows, and Linux. The installer formats are DMG/ZIP for macOS, NSIS for Windows, and AppImage for Linux.

## Privacy and Security

Agent Launcher is local-first, but not offline-only. Installations and updates may contact npm, official Node.js downloads, GitHub Releases, and skills.sh. Running an agent sends requests to the official provider or relay endpoint selected in that agent's active profile.

API keys are deliberately stored as plaintext in `~/.agent-launcher/config.json` and, when required, in sandboxed CLI-native config files. Secrets are masked in the interface, but the files remain readable by your local user account. Never attach real config directories, unredacted logs, or screenshots containing credentials to a public issue.

Session history and usage data are read from local CLI files. Agent Launcher does not upload those histories to a separate analytics service.

Please report vulnerabilities according to the [security policy](./SECURITY.md).

## Development

Requirements:

- Node.js 22 or newer
- pnpm, matching the `packageManager` field in `package.json`

Common commands:

```bash
pnpm dev
pnpm typecheck
pnpm test:run
pnpm verify
pnpm build
pnpm package
```

Use `pnpm verify` as the normal correctness gate after code edits, or `pnpm typecheck` for a quicker pass. CI also runs `pnpm audit:ci`, which fails on high-severity dependency advisories. See the [contributing guide](./CONTRIBUTING.md) for architecture, testing, packaging, and release details.

## Project

- [Contributing guide](./CONTRIBUTING.md) - local setup, development commands, architecture, testing, and release details
- [Security policy](./SECURITY.md) - supported versions and private vulnerability reporting
- [Issue tracker](https://github.com/matrixlabs/agent-launcher/issues) - bug reports and feature requests

## License

Agent Launcher is released under the [MIT License](./LICENSE).
