import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProjectDirectory } from '../../src/main/workspace-directory'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('project directory selection', () => {
  it('accepts existing directories and resolves them to absolute paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-launcher-project-'))
    temporaryRoots.push(root)
    const project = join(root, 'project')
    mkdirSync(project)

    expect(resolveProjectDirectory(project)).toBe(project)
    expect(resolveProjectDirectory(`  ${project}  `)).toBe(project)
  })

  it('rejects relative paths instead of resolving against the process cwd', () => {
    expect(resolveProjectDirectory('.')).toBeNull()
    expect(resolveProjectDirectory('src')).toBeNull()
    expect(resolveProjectDirectory(relative('/', process.cwd()))).toBeNull()
  })

  it('rejects empty, missing, and file paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-launcher-project-'))
    temporaryRoots.push(root)
    const file = join(root, 'file.txt')
    writeFileSync(file, 'not a directory')

    expect(resolveProjectDirectory()).toBeNull()
    expect(resolveProjectDirectory(join(root, 'missing'))).toBeNull()
    expect(resolveProjectDirectory(file)).toBeNull()
  })
})
