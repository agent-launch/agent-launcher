import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio
} from 'node:child_process'

function isWindowsShellScript(file: string): boolean {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(file)
}

function quoteCmdArg(value: string): string {
  if (!value) return '""'
  return `"${value.replace(/"/g, '""')}"`
}

export function windowsShellTarget(file: string, args: string[] = []): { file: string; args: string[] } {
  if (!isWindowsShellScript(file)) return { file, args }

  return {
    file: process.env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', ['call', quoteCmdArg(file), ...args.map(quoteCmdArg)].join(' ')]
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
  return spawn(target.file, target.args, options)
}
