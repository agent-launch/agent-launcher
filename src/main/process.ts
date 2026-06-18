import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio
} from 'node:child_process'
import { TextDecoder } from 'node:util'

function isWindowsShellScript(file: string): boolean {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(file)
}

function quoteCmdArg(value: string): string {
  if (!value) return '""'
  const escaped = value.replace(/%/g, '%%').replace(/"/g, '""')
  return /[\s&()^|<>"]/u.test(escaped) ? `"${escaped}"` : escaped
}

function windowsBatchLine(file: string, args: string[]): string {
  return ['call', quoteCmdArg(file), ...args.map(quoteCmdArg)].join(' ')
}

export function windowsShellTarget(file: string, args: string[] = []): { file: string; args: string[] } {
  if (!isWindowsShellScript(file)) return { file, args }

  return {
    file: process.env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', windowsBatchLine(file, args)]
  }
}

export function spawnProcess(
  file: string,
  args?: string[],
  options?: SpawnOptionsWithoutStdio
): ChildProcessWithoutNullStreams
export function spawnProcess(file: string, args: string[] | undefined, options: SpawnOptions): ChildProcess
export function spawnProcess(file: string, args: string[] = [], options: SpawnOptions = {}): ChildProcess {
  const target = windowsShellTarget(file, args)
  const spawnOptions =
    target.file === file
      ? options
      : {
          ...options,
          windowsVerbatimArguments: true
        }
  return spawn(target.file, target.args, spawnOptions)
}

export function decodeProcessOutput(chunk: Buffer | string): string {
  if (typeof chunk === 'string') return chunk
  if (process.platform !== 'win32') return chunk.toString('utf8')
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(chunk)
  if (!utf8.includes('\uFFFD')) return utf8

  try {
    return new TextDecoder('gb18030', { fatal: false }).decode(chunk)
  } catch {
    return utf8
  }
}

export function lastLines(text: string, count: number): string {
  const lines = text.trim().split(/\r?\n/)
  return lines.slice(Math.max(0, lines.length - count)).join('\n')
}
