# Agent Launcher

Agent Launcher is an Electron desktop app for people who do not want to use the command line. It installs, configures, and runs Claude Code, Codex CLI, OpenCode, Pi, and Hermes Agent from a desktop UI.

## Features

- Sandboxed installs: portable Node, npm cache, CLI binaries, and redirected CLI config live under `~/.agent-launcher/` by default.
- Multi-agent support: Claude Code, Codex CLI, and OpenCode use platform binaries; Pi runs through bundled Node; Hermes Agent uses its official system installer.
- Provider profiles: configure base URL, API key, and model once, then materialize the required env vars and native config files for each CLI.
- Terminal workflow: embedded xterm.js terminal, external terminal launch, official account login, session listing, and session resume.
- Local usage insights: read each CLI's local history to summarize token usage, models, request counts, and sessions.
- Resource management: manage MCP servers, Skills, local model pricing records, and install Skills from skills.sh.
- App updates: check GitHub Releases and auto-update metadata through `electron-updater`.

## Privacy And Security

Agent Launcher is local-first, but it is not offline-only. Installing or updating CLIs may contact npm registry, official Node.js downloads, GitHub Releases, and skills.sh. When you run a CLI, that CLI contacts the model provider or relay endpoint you configured.

API keys are intentionally stored in plaintext on the local machine in `~/.agent-launcher/config.json` and in some CLI-native config files. The UI masks secrets before display. Do not attach real config directories, full logs, or screenshots containing secrets to public issues.

## Development

Requirements:

- Node.js 22 or newer
- pnpm 11.7.0
- macOS, Windows, or Linux

Install dependencies and start the dev app:

```bash
pnpm install
pnpm dev
```

Common commands:

```bash
pnpm verify           # typecheck + test typecheck + Vitest
pnpm typecheck        # main/preload + renderer typecheck
pnpm test:run         # Vitest unit tests
pnpm build            # typecheck, then build into out/
pnpm package          # build and package for the current OS
pnpm package:mac      # package for macOS
pnpm package:win      # package for Windows
pnpm package:linux    # package for Linux
```

Linux packaging may need system dependencies:

```bash
sudo apt-get install -y libarchive-tools libfuse2
```

## Architecture

- `src/main/`: Electron main process, installer, PTY runtime, config writers, and session history readers.
- `src/preload/index.ts`: the only renderer bridge; exposes `window.api`.
- `src/shared/types.ts`: IPC contract shared by main, preload, and renderer.
- `src/renderer/src/`: React 19, Zustand, and Tailwind v4 UI.
- `tests/`: Vitest unit tests.
- `scripts/smoke-*.ts`: manual smoke checks that may use real network access or the real sandbox.

For deeper engineering notes, see [AGENTS.md](./AGENTS.md). For contribution workflow, see [CONTRIBUTING.md](./CONTRIBUTING.md). For security reporting, see [SECURITY.md](./SECURITY.md).

## Releases

Pushing a `v<major>.<minor>.<patch>` tag, including prerelease tags, triggers `.github/workflows/release.yml`. The workflow builds macOS, Windows, and Linux packages and publishes GitHub Releases for tagged builds. Pull requests run CI with typechecks, tests, and dependency audit.

## License

MIT. See [LICENSE](./LICENSE).
