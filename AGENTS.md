# AGENTS.md

This file provides guidance to coding agents (Codex, opencode, etc.) when working with code in this repository.

## What this is

AgentLauncher is an Electron desktop app that **configures and runs** six coding-agent CLIs — Claude Code, Codex, opencode, Pi, Gemini CLI, and Hermes Agent — for users who don't use the command line. The app detects and links existing system CLIs but does not install, reinstall, or update them. It materializes provider/relay config from the UI and spawns each CLI in an embedded terminal. Open-source docs and package metadata are English-first; the UI is localized in Chinese and English.

## Commands

```bash
pnpm dev              # run the app in dev (electron-vite, HMR for renderer)
pnpm build            # typecheck (node + web) then electron-vite build → out/
pnpm typecheck        # both projects; or typecheck:node / typecheck:web individually
pnpm test:run         # Vitest unit tests
pnpm lint             # ESLint; warnings fail CI
pnpm format:check     # verify Prettier formatting
pnpm verify           # typecheck + test typecheck + Vitest
pnpm package          # build + electron-builder (current OS); also package:mac/win/linux
```

`tests/**/*.test.ts` run under Vitest. `scripts/smoke-*.ts` are standalone manual smoke checks (config, CLI linking, sessions, native config, codex, chat, transcript) that import directly from `src/main/*`; they are run ad hoc against a real network/sandbox. Use `pnpm verify` as the normal correctness gate after edits, or `pnpm typecheck` for a quicker pass.

Package manager is **pnpm** (see `packageManager` in `package.json` and dependency settings in `pnpm-workspace.yaml`). The native module `@lydell/node-pty` and `sql.js` (ships a `.wasm`) drive the asar/build config in `electron-builder.yml`.

## Architecture

Three TS projects, two tsconfigs: **main** + **preload** compile under `tsconfig.node.json`; **renderer** under `tsconfig.web.json`. `src/shared/types.ts` is the IPC contract imported by both sides — change it and update `src/preload/index.ts` (the typed bridge) together. Path aliases: `@/*` → `src/renderer/src/*`, `@shared/*` → `src/shared/*`.

All renderer↔main communication goes through `src/preload/index.ts`, which exposes `window.api`. Every channel there has a matching `ipcMain.handle` in `src/main/ipc.ts`. There is no direct Node access in the renderer (`contextIsolation: true`, `sandbox: false`).

### App data and legacy managed installs

`src/main/sandbox.ts` defines `~/.agent-launcher/` for Agent Launcher state and compatibility with old app-managed installs. The managed-install feature is deprecated: do not add installation flows under `paths.cliInstall`, bundled Node, the private npm cache, the system npm, or official installers. Existing legacy installs remain readable so users can migrate without losing config.

### How a CLI gets configured (two mechanisms, often both)

A provider profile (`CliProfile`: baseUrl/apiKey/model) is turned into CLI config two ways:

1. **Env vars** — `src/main/cli-env.ts` (`buildCliEnv`) injects relay/auth/model variables. System installs use their normal config homes; redirected config directories remain only for legacy managed installs.
2. **Native config files** — `src/main/native-config.ts` writes the files some CLIs read instead of (or in addition to) env: Claude Code `settings.json` (env block), Codex `config.toml`+`auth.json`, opencode `opencode.json` (custom `@ai-sdk/openai-compatible` provider), Pi `models.json`, Hermes `config.yaml`+`.env`. `hasNativeConfig(id)` gates this; Gemini is env-var only. **Any profile change in `ipc.ts` re-runs `writeNativeConfig` via the `synced()` wrapper** — keep that invariant when adding config mutations.

`readNativeFiles` produces **masked** copies for the UI (`resolvedEnvPreview` does the same for smoke checks/tests); secrets are stored plaintext on disk by deliberate product decision (no keychain) — see `store.ts`.

### CLI discovery and linking (`src/main/install/`)

The app detects existing system commands, lets users choose among duplicate paths, and records the selected command. It never invokes npm, package-manager updates, or official CLI installers. Legacy `source: "sandbox"` records remain supported only for reading and running.

`platform.ts` holds all the OS/arch → package-key/triple mapping quirks (win32→"windows"/"win", musl on linux, etc.). `detect.ts` reports environment facts to the wizard and cross-checks recorded `binPath`s still exist on disk.

### Runtime: PTY (`src/main/pty.ts`)

`createSession` resolves what to spawn (`resolveTarget`): the CLI binary, or bundled-node + JS entry for node-npm CLIs, plus resume args and the YOLO flag. **YOLO/auto-approve flags differ per CLI** and live in `yoloArgs()` (mirrored for the UI in `data/clis.ts` `YOLO_SUPPORT`); Pi has none. Data streams back over `pty:data`/`pty:exit`; `killAll()` runs on quit.

### Sessions history (`src/main/sessions-history.ts`)

Reads each CLI's **own** on-disk conversation history so users can resume — each CLI stores it differently: Claude/Codex/Pi use JSONL (different dir layouts and title fields), Gemini writes JSON log arrays, and **opencode and Hermes use SQLite DBs read via `sql.js`/WASM** (Hermes merged with its JSON session files). `resumeArgs()` maps a session id back to the CLI's resume flag. Adding a CLI means adding both a `list*` reader and a `resumeArgs` case.

### Renderer

React 19 + Zustand + Tailwind v4. `App.tsx` shows `Onboarding` (first-run detection, linking, and configuration) until `onboarded`, then `Shell`. `store/app.ts` is the only persisted client store (localStorage). The CLI catalog (`data/clis.ts`) and provider/relay presets (`data/providers.ts`) are static data. Terminal UI is xterm.js in `components/terminal/TerminalView.tsx`. Frameless window with a custom `Titlebar` (window controls go through `window:*` IPC in `index.ts`).

## Adding a new CLI

It's a `CliId` union member touched in many places — grep for an existing id like `'opencode'`. Minimally: `shared/types.ts` (`CliId`), `store.ts` (`CLI_IDS`), `cli-env.ts` (env vars), `install/installer.ts` (+`platform.ts` keys), `pty.ts` (`yoloArgs`, node-entry handling), `sessions-history.ts` (`list*` + `resumeArgs`), `native-config.ts` if file-configured, and renderer `data/clis.ts` + `data/providers.ts`.

DO NOT send optional commentary
