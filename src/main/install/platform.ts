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
