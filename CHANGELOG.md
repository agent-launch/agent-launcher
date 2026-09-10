# Changelog

All notable changes to Agent Launcher will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Community health files, bilingual contribution and support guidance, and structured issue forms.
- ESLint, Prettier, and cross-platform CI quality gates.
- Project-folder selection, recent-folder persistence, and folder drag-and-drop for new sessions.
- Intel and Apple silicon macOS release targets and conditional release-signing verification.

### Changed

- Repository, update, release, and package metadata now point to `agent-launch/agent-launcher`.
- The application id is `app.agent-launch.agentlauncher`.
- Tagged builds are published as prereleases; a maintainer promotes a release before updater clients can receive it.
- A macOS build without a signing certificate now fails instead of producing an unsigned application.
