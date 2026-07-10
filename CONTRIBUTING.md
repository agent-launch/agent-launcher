# Contributing

Thanks for helping improve Agent Launcher. The app is built for users who may not be comfortable with command-line tools, so changes should protect their local environment, API keys, and existing CLI configuration first.

## Development Workflow

1. Install dependencies: `pnpm install`
2. Start the app locally: `pnpm dev`
3. Run the pre-PR gate: `pnpm verify`
4. If you changed installation, updates, real CLI execution, or history readers, run the relevant `scripts/smoke-*.ts` check manually.

`pnpm verify` runs main/preload typecheck, renderer typecheck, test typecheck, and Vitest. Regular PRs do not need to build packages for every platform; the release workflow handles that.

## Code Rules

- All renderer-to-main communication must go through `window.api` in `src/preload/index.ts`, with a matching handler in `src/main/ipc.ts`.
- When changing `src/shared/types.ts`, update the preload bridge, IPC handlers, and relevant tests together.
- Sandbox paths must come from `src/main/sandbox.ts` `paths.*`. Do not read or write the user's existing CLI config directories unless the user selected a system CLI.
- After changing provider profiles, auth mode, or active profile, CLIs with native config must still go through the `synced()` path that calls `writeNativeConfig`.
- Do not log or print real API keys. Any config or env data shown in the UI must be masked.
- Download and install logic must verify integrity. npm tarballs use registry integrity; portable Node builds use the official `SHASUMS256.txt`.
- UI copy is localized. If you change an existing i18n key, keep the Chinese and English messages in sync.

## Testing Guidance

- Add Vitest coverage for pure logic and file parsing behavior.
- Cover main-layer changes for CLI installation, platform mapping, config writing, and session history readers.
- Cover renderer changes for static catalogs, Zustand persistence, and i18n.
- For real network, system install, or PTY changes, document the manual smoke command and result in the PR.

## Pull Request Checklist

- `pnpm verify` passes.
- No `release/`, `out/`, `node_modules/`, real config files, logs, or secrets are committed.
- Relevant README, AGENTS, CLAUDE, user copy, or shared types are updated.
- The PR description explains any impact on user data paths, plaintext secrets, or system CLI config.
- Dependency or release-flow changes include the `pnpm audit:ci` result.
