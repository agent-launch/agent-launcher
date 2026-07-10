<div align="center">
  <img src="src/renderer/src/assets/app-icon.png" width="112" alt="Agent Launcher icon">
  <h1>Agent Launcher</h1>
  <p>Install, configure, and run coding agents from one desktop app.</p>
  <p>
    <a href="https://github.com/matrixlabs/agent-launcher/actions/workflows/ci.yml"><img src="https://github.com/matrixlabs/agent-launcher/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
    <a href="https://github.com/matrixlabs/agent-launcher/releases"><img src="https://img.shields.io/github/v/release/matrixlabs/agent-launcher?display_name=tag" alt="Latest release"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/github/license/matrixlabs/agent-launcher" alt="MIT license"></a>
  </p>
</div>

Agent Launcher is a local desktop workspace for coding-agent CLIs. It handles installation, account and provider configuration, sessions, and updates through a graphical interface, so using an agent does not require managing Node.js, environment variables, or CLI config files by hand.

## Supported Agents

| Agent | Installation | Configuration and runtime |
| --- | --- | --- |
| [Claude Code](https://www.anthropic.com/claude-code) | Sandboxed native binary or an existing system install | Official account or Anthropic-compatible API |
| [Codex CLI](https://github.com/openai/codex) | Sandboxed native binary or an existing system install | ChatGPT account or OpenAI-compatible API |
| [OpenCode](https://opencode.ai/) | Sandboxed native binary or an existing system install | OpenAI-compatible providers |
| [Pi](https://github.com/badlogic/pi-mono) | Sandboxed portable Node.js runtime or an existing system install | OpenAI-compatible providers |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Official system-managed install | Existing account or OpenAI-compatible providers |

## Features

### Guided setup

Agent Launcher detects existing installations, installs missing agents, and walks through account or API configuration. Each agent can use an official account, a provider preset, or a custom compatible endpoint where supported.

### Isolated agent environments

Sandbox-managed binaries, portable Node.js, npm cache, credentials, and native CLI configuration stay under `~/.agent-launcher/`. Agent Launcher does not modify global npm settings or replace existing CLI installations. A system-installed agent is used only when you select it.

### Profiles and relay configuration

Keep multiple profiles per agent and switch between official services, relay presets, and custom endpoints. Agent Launcher writes the environment variables and native config files expected by each CLI, while preserving unrelated native settings.

### Terminal and chat workflows

Run agents in the embedded terminal, open them in an external terminal, or use the in-app chat view for supported conversations. Permission bypass modes are exposed per agent only when the underlying CLI supports them.

### Local session history

Browse, resume, and delete conversations from the history already maintained by each CLI. Agent Launcher understands their different JSONL and SQLite storage formats without uploading the history to another service.

### Usage insights

See local token usage, request counts, active days, session totals, and model distribution across agents. Optional model-pricing records can be used to organize cost information locally.

### MCP servers and Skills

Inspect and manage MCP server entries and installed Skills from the same workspace. Skills can also be discovered and installed from [skills.sh](https://skills.sh/).

### Cross-platform updates

Check installed CLI versions and update individual agents without changing their selected installation source. Agent Launcher can also check GitHub Releases and install supported app updates.

## Platforms

Release builds are available for:

- macOS: DMG and ZIP
- Windows: NSIS installer
- Linux: AppImage

Download the appropriate package from [GitHub Releases](https://github.com/matrixlabs/agent-launcher/releases).

## Privacy and Security

Agent Launcher is local-first, but not offline-only. Installations and updates may contact npm, official Node.js downloads, GitHub Releases, and skills.sh. Running an agent sends requests to the official provider or relay endpoint selected in that agent's profile.

API keys are deliberately stored as plaintext in `~/.agent-launcher/config.json` and, when required, in sandboxed CLI-native config files. Secrets are masked in the interface, but the files remain readable by your local user account. Never attach real config directories, unredacted logs, or screenshots containing credentials to a public issue.

Please report vulnerabilities according to the [security policy](./SECURITY.md).

## Project

- [Contributing guide](./CONTRIBUTING.md) - local setup, development commands, architecture, testing, and release details
- [Security policy](./SECURITY.md) - supported versions and private vulnerability reporting
- [Issue tracker](https://github.com/matrixlabs/agent-launcher/issues) - bug reports and feature requests

## License

Agent Launcher is released under the [MIT License](./LICENSE).
