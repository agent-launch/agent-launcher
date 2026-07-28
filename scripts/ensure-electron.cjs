const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function platformExecutableName() {
  const platform =
    process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || os.platform()
  switch (platform) {
    case 'darwin':
    case 'mas':
      return path.join('Electron.app', 'Contents', 'MacOS', 'Electron')
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron'
    case 'win32':
      return 'electron.exe'
    default:
      throw new Error(`Unsupported Electron platform: ${platform}`)
  }
}

function resolveElectronRoot() {
  return path.dirname(require.resolve('electron'))
}

function electronExecutablePath(root) {
  const pathFile = path.join(root, 'path.txt')
  const executable = fs.existsSync(pathFile)
    ? fs.readFileSync(pathFile, 'utf8').trim()
    : platformExecutableName()
  const distPath = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(root, 'dist')
  return path.join(distPath, executable)
}

function isInstalled(root) {
  const pkg = require(path.join(root, 'package.json'))
  const versionFile = path.join(root, 'dist', 'version')
  const executable = electronExecutablePath(root)

  try {
    const installedVersion = fs.readFileSync(versionFile, 'utf8').replace(/^v/, '').trim()
    return installedVersion === pkg.version && fs.existsSync(executable)
  } catch {
    return false
  }
}

function installElectron(root) {
  const installScript = require.resolve('electron/install.js')
  console.log('Electron binary is missing; downloading it now...')
  const result = spawnSync(process.execPath, [installScript], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function main() {
  const root = resolveElectronRoot()
  if (isInstalled(root)) return
  installElectron(root)
  if (!isInstalled(root)) {
    const executable = electronExecutablePath(root)
    console.error(`Electron binary is still missing after install: ${executable}`)
    process.exit(1)
  }
}

main()
