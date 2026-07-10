# Security Policy

## Supported Versions

The `main` branch and the latest GitHub Release are the primary supported targets. If you are using an older build, please upgrade first and confirm whether the issue still reproduces.

## Reporting A Vulnerability

Please use GitHub private vulnerability reporting when available. If it is not enabled for the repository, open a minimal public issue asking the maintainers to contact you. Do not include exploit details, real API keys, user path screenshots, or full logs in a public issue.

Useful reports include:

- Affected version, operating system, and CPU architecture.
- Reproduction steps and expected impact.
- Whether the issue involves plaintext secrets, arbitrary file access, command execution, update flow, or install flow.
- Minimal logs with API keys, tokens, and personal paths removed.

## Response

Maintainers will confirm the impact, decide on a fix branch and release plan, and coordinate disclosure. Issues involving secret exposure, arbitrary code execution, update-chain compromise, or download integrity bypass are treated as high priority.

## Design Note

Agent Launcher intentionally stores API keys in plaintext local config files and masks them in the UI. That design choice is not itself a vulnerability. However, any behavior that unexpectedly uploads, displays publicly, sends remotely, or reads those files through an unintended path should be reported as a security issue.
