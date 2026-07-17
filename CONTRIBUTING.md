# Contributing to Agent Launcher

Thanks for helping improve Agent Launcher. The app is designed for people who may not be comfortable with command-line tools, so changes must protect their local environment, credentials, and existing CLI configuration.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.7.0
- macOS, Windows, or Linux

Use pnpm for all dependency and script operations. The expected version is declared in `package.json`.

## Local Setup

Fork and clone the repository, then install dependencies:

```bash
git clone https://github.com/<your-account>/agent-launcher.git
cd agent-launcher
pnpm install
```

Start the development app with renderer hot module replacement:

```bash
pnpm dev
```

Agent Launcher keeps its runtime data under `~/.agent-launcher/`. Development builds use the same root, so do not point manual tests at credentials or configuration you are not prepared to change.

## Development Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the Electron app in development mode |
| `pnpm verify` | Run both typecheck projects, test typechecking, and all Vitest tests |
| `pnpm typecheck` | Typecheck the main/preload and renderer projects |
| `pnpm test:run` | Run the Vitest suite once |
| `pnpm build` | Typecheck and build the app into `out/` |
| `pnpm package` | Build and package for the current operating system |
| `pnpm package:mac` | Build macOS DMG and ZIP packages |
| `pnpm package:win` | Build the Windows NSIS package |
| `pnpm package:linux` | Build the Linux AppImage |

Linux packaging may require additional system dependencies:

```bash
sudo apt-get install -y libarchive-tools libfuse2
```

## Architecture

Agent Launcher has three TypeScript projects across Electron's main, preload, and renderer contexts:

- `src/main/` contains installation, sandbox, configuration, PTY, session-history, update, and IPC logic.
- `src/preload/index.ts` is the typed bridge exposed to the renderer as `window.api`.
- `src/shared/types.ts` defines the IPC contract shared across process boundaries.
- `src/renderer/src/` contains the React 19, Zustand, Tailwind CSS, and xterm.js interface.
- `tests/` contains Vitest unit tests.
- `scripts/smoke-*.ts` contains manual checks that may use the network, real CLIs, or the local sandbox.

Path aliases map `@/*` to `src/renderer/src/*` and `@shared/*` to `src/shared/*`. Main and preload code compile with `tsconfig.node.json`; renderer code compiles with `tsconfig.web.json`.

For a detailed map of installation strategies, native config formats, runtime behavior, and session readers, see [AGENTS.md](./AGENTS.md).

## Code Rules

- Route all renderer-to-main communication through `window.api` in `src/preload/index.ts`, with a matching handler in `src/main/ipc.ts`.
- When changing `src/shared/types.ts`, update the preload bridge, IPC handlers, and relevant tests together.
- Resolve sandbox paths through `paths.*` in `src/main/sandbox.ts`. Do not read or write a user's existing CLI config unless they selected a system installation.
- Keep native config synchronization in the `synced()` path after profile, auth-mode, or active-profile changes.
- Never log or display real API keys. Mask config and environment data before sending it to the renderer.
- Verify downloaded artifacts. npm packages use registry integrity; portable Node.js builds use the official `SHASUMS256.txt`.
- Keep Chinese and English UI messages in sync when adding or changing localized copy.
- Preserve the established installation, configuration, and history formats of each supported CLI.

## Testing

Run the full correctness gate before opening a pull request:

```bash
pnpm verify
```

Add focused Vitest coverage for pure logic and file parsing. Main-process changes should cover affected installation, platform mapping, config writing, or session-history behavior. Renderer changes should cover static catalogs, persisted state, and localization where applicable.

Changes involving real downloads, system installers, PTY behavior, app updates, or native CLI history should also run the relevant standalone smoke check in `scripts/`. These checks are intentionally excluded from the normal test suite because they can access the network and the real sandbox. Include the command and result in the pull request description.

## Packaging

Packages are generated in `release/`. The build includes unpacking rules for the native PTY module and the `sql.js` WASM asset, so packaging changes should be verified with an installed artifact on the affected operating system.

Regular pull requests do not need to package all three platforms. CI runs the correctness checks and the release workflow provides cross-platform package coverage.

## Pull Requests

Keep changes focused and explain user-visible behavior. Before submitting, confirm that:

- `pnpm verify` passes.
- Relevant tests and manual smoke checks have been added or run.
- Chinese and English UI copy remain aligned.
- Documentation and shared types reflect behavior changes.
- `release/`, `out/`, `node_modules/`, config files, logs, and secrets are not committed.
- The description calls out changes to user data paths, plaintext secrets, system CLI config, or downloaded artifacts.
- Dependency or release-workflow changes include the result of `pnpm audit:ci`.

## Releases

The release workflow builds macOS, Windows, and Linux packages. Pushing a `v<major>.<minor>.<patch>` tag, including a valid prerelease suffix, publishes a GitHub Release after all platform builds succeed. The workflow also generates the update metadata consumed by `electron-updater`.

Release mechanics are maintained in `.github/workflows/release.yml` and `electron-builder.yml`.

### Update policy (`update-policy.json`)

The app's update checker fetches `update-policy.json` from this repository's `main` branch at runtime (see `src/main/app-update.ts`). It lets maintainers announce the latest version and, via `minVersion`/`force`, require users below a minimum version to update before continuing. When cutting a release, bump `latestVersion` (and `minVersion` only when older versions must be retired) on `main`.
