import type { PlatformInfo } from '@shared/types'

/** Normalize process.platform/arch into the keys our subpackages use. */
export function detectPlatform(): PlatformInfo {
  const os = process.platform
  const arch = process.arch
  if (os !== 'darwin' && os !== 'win32' && os !== 'linux') {
    throw new Error(`Unsupported OS: ${os}`)
  }
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported arch: ${arch}`)
  }
  return { os, arch, platformKey: `${os}-${arch}` }
}

/** Rust target triples used inside the Codex vendor/ tarball layout. */
export function codexTargetTriple(p: PlatformInfo): string {
  const map: Record<string, string> = {
    'linux-x64': 'x86_64-unknown-linux-musl',
    'linux-arm64': 'aarch64-unknown-linux-musl',
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc'
  }
  const triple = map[p.platformKey]
  if (!triple) throw new Error(`No Codex triple for ${p.platformKey}`)
  return triple
}

/** Node dist filename component (note win32 -> "win"). */
export function nodeDistName(p: PlatformInfo, version: string): { file: string; ext: string } {
  const osPart = p.os === 'win32' ? 'win' : p.os
  const ext = p.os === 'win32' ? 'zip' : 'tar.gz'
  return { file: `node-v${version}-${osPart}-${p.arch}.${ext}`, ext }
}
