# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

AgentLauncher is an Electron desktop app that **installs, configures, and runs** five coding-agent CLIs — Claude Code, Codex, opencode, Pi, and Hermes Agent — for users who don't use the command line. It bundles each sandbox-managed CLI into an isolated home, materializes its provider/relay config from the UI, and spawns it in an embedded terminal. Open-source docs and package metadata are English-first; the UI is localized in Chinese and English.

## Commands

```bash
pnpm dev              # run the app in dev (electron-vite, HMR for renderer)
pnpm build            # typecheck (node + web) then electron-vite build → out/
pnpm typecheck        # both projects; or typecheck:node / typecheck:web individually
pnpm test:run         # Vitest unit tests
pnpm verify           # typecheck + test typecheck + Vitest
pnpm package          # build + electron-builder (current OS); also package:mac/win/linux
```

`tests/**/*.test.ts` run under Vitest. `scripts/smoke-*.ts` are standalone manual smoke checks (config, install, sessions, native config, codex) that import directly from `src/main/*`; they are run ad hoc against a real network/sandbox. Use `pnpm verify` as the normal correctness gate after edits, or `pnpm typecheck` for a quicker pass.

Package manager is **pnpm** (see `packageManager` in `package.json` and dependency settings in `pnpm-workspace.yaml`). The native module `@lydell/node-pty` and `sql.js` (ships a `.wasm`) drive the asar/build config in `electron-builder.yml`.

## Architecture

Three TS projects, two tsconfigs: **main** + **preload** compile under `tsconfig.node.json`; **renderer** under `tsconfig.web.json`. `src/shared/types.ts` is the IPC contract imported by both sides — change it and update `src/preload/index.ts` (the typed bridge) together. Path aliases: `@/*` → `src/renderer/src/*`, `@shared/*` → `src/shared/*`.

All renderer↔main communication goes through `src/preload/index.ts`, which exposes `window.api`. Every channel there has a matching `ipcMain.handle` in `src/main/ipc.ts`. There is no direct Node access in the renderer (`contextIsolation: true`, `sandbox: false`).

### The sandbox is the core design constraint

`src/main/sandbox.ts` defines `~/.agent-launcher/` — the app **never touches the user's existing CLI installs, global npm, or `~/.npmrc`**. Everything (config, a bundled portable Node, npm cache, per-CLI installs, and per-CLI redirected config dirs) lives under that root. When adding any feature that reads/writes CLI state, route it through `paths.*` — do not assume system paths.

### How a CLI gets configured (two mechanisms, often both)

A provider profile (`CliProfile`: baseUrl/apiKey/model) is turned into CLI config two ways:

1. **Env vars** — `src/main/cli-env.ts` (`buildCliEnv`) injects per-CLI vars (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, opencode's `XDG_*`, `PI_CODING_AGENT_DIR`, plus `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`/etc. and the auth token). This points each CLI's config dir into the sandbox and sets its relay endpoint.
2. **Native config files** — `src/main/native-config.ts` writes the files some CLIs read instead of (or in addition to) env: Codex `config.toml`+`auth.json`, opencode `opencode.json` (custom `@ai-sdk/openai-compatible` provider), Pi `models.json`. `hasNativeConfig(id)` gates this. **Any profile change in `ipc.ts` re-runs `writeNativeConfig` via the `synced()` wrapper** — keep that invariant when adding config mutations.

`resolvedEnvPreview` / `readNativeFiles` produce **masked** copies for the UI; secrets are stored plaintext on disk by deliberate product decision (no keychain) — see `store.ts`.

### Install layer (`src/main/install/`)

Two strategies, per `CliMeta.install`:

- **native-binary** (Claude Code, Codex, opencode): download the platform-specific npm tarball from the registry, extract with system `tar`, run the binary directly. Codex binaries live under `vendor/<rust-triple>/bin/`.
- **node-npm** (Pi): a real Node app, so `node-runtime.ts` first fetches a **portable Node LTS** (SHA256-verified against `SHASUMS256.txt`), then `npm install`s the package into the sandbox with an empty `--userconfig` so the user's npmrc is never read. Spawned later via `binPath`(=node) + `nodeEntry`(=the JS entry).
- **system** (Hermes Agent, or user-selected system installs): link or install a system-managed binary, then use that CLI's normal config home.

`platform.ts` holds all the OS/arch → package-key/triple mapping quirks (win32→"windows"/"win", musl on linux, etc.). `detect.ts` reports environment facts to the wizard and cross-checks recorded `binPath`s still exist on disk.

### Runtime: PTY (`src/main/pty.ts`)

`createSession` resolves what to spawn (`resolveTarget`): the CLI binary, or bundled-node + JS entry for node-npm CLIs, plus resume args and the YOLO flag. **YOLO/auto-approve flags differ per CLI** and live in `yoloArgs()` (mirrored for the UI in `data/clis.ts` `YOLO_SUPPORT`); Pi has none. Data streams back over `pty:data`/`pty:exit`; `killAll()` runs on quit.

### Sessions history (`src/main/sessions-history.ts`)

Reads each CLI's **own** on-disk conversation history so users can resume — each CLI stores it differently: Claude/Codex/Pi use JSONL (different dir layouts and title fields), **opencode uses a SQLite DB read via `sql.js`/WASM**. `resumeArgs()` maps a session id back to the CLI's resume flag. Adding a CLI means adding both a `list*` reader and a `resumeArgs` case.

### Renderer

React 19 + Zustand + Tailwind v4. `App.tsx` shows `Onboarding` (first-run install wizard) until `onboarded`, then `Shell`. `store/app.ts` is the only persisted client store (localStorage). The CLI catalog (`data/clis.ts`) and provider/relay presets (`data/providers.ts`, ported from cc-switch) are static data. Terminal UI is xterm.js in `components/terminal/TerminalView.tsx`. Frameless window with a custom `Titlebar` (window controls go through `window:*` IPC in `index.ts`).

## Adding a new CLI

It's a `CliId` union member touched in many places — grep for an existing id like `'opencode'`. Minimally: `shared/types.ts` (`CliId`), `store.ts` (`CLI_IDS`), `cli-env.ts` (env vars), `install/installer.ts` (+`platform.ts` keys), `pty.ts` (`yoloArgs`, node-entry handling), `sessions-history.ts` (`list*` + `resumeArgs`), `native-config.ts` if file-configured, and renderer `data/clis.ts` + `data/providers.ts`.

DO NOT send optional commentary
