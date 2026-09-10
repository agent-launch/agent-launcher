import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')

/**
 * Paths exempt from the tracked-file scan, as `git ls-files` prints them.
 *
 * This file is listed because a future edit might spell the name out. Add a
 * path here when a document *should* record what happened: a postmortem or an
 * ADR explaining the force-push has to be able to name the repository it is
 * about, and this guard must not make deleting that history the only way back
 * to green.
 */
const SCAN_EXEMPT = new Set(['tests/repo/identity.test.ts'])

const OWNER = 'agent-launch'
const REPO = 'agent-launcher'
const APP_ID = 'app.agent-launch.agentlauncher'
const SAFE_ASSET_NAME_PATTERN = '[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?'
const SAFE_ASSET_NAME = new RegExp(`^${SAFE_ASSET_NAME_PATTERN}$`)

/**
 * Assembled at runtime rather than written out, so this guard does not itself
 * put the forbidden name back into the tree: `grep -ri` over a fixed repo must
 * come back empty, including when it greps the test that enforces that.
 */
const PRIVATE_OWNER_FRAGMENT = ['white', 'matrix'].join('')

/**
 * Any URL that addresses the public repository: bare, `git+`-prefixed, and
 * `.git`-suffixed forms all count, and anything may follow the slug.
 */
const PUBLIC_REPO_URL =
  /^(?:git\+)?https:\/\/github\.com\/agent-launch\/agent-launcher(?:\.git)?(?:[/#?]|$)/

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

/**
 * Every file git actually tracks, so the scan cannot drift from the real tree.
 * This makes the suite require a git checkout — it will not run from an
 * exported tarball.
 */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024
  })
  return out.toString('utf8').split('\0').filter(Boolean)
}

/**
 * Whether git would treat these bytes as binary. Icons and other blobs cannot
 * meaningfully contain the name, and decoding them as UTF-8 is pure waste.
 */
function isBinary(contents: Buffer): boolean {
  return contents.includes(0)
}

/** The body of a top-level `key:` block in a YAML document, minus the key line. */
function yamlBlock(text: string, key: string): string {
  const lines = text.split('\n')
  const start = lines.indexOf(`${key}:`)
  expect(start, `expected a top-level \`${key}:\` block`).toBeGreaterThanOrEqual(0)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.length > 0 && !/^\s/.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** The body of one `- name: <step>` step in a GitHub Actions workflow. */
function workflowStep(text: string, name: string): string {
  const marker = `- name: ${name}`
  const start = text.indexOf(marker)
  expect(start, `expected a \`${marker}\` step`).toBeGreaterThanOrEqual(0)
  const rest = text.slice(start + marker.length)
  const end = rest.search(/\n\s*- name: /)
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * Agent Launcher ships from the public `agent-launch/agent-launcher`
 * repository, and a force-push once replaced that identity wholesale with a
 * private upstream's. That is not a cosmetic break: the bundle id keys macOS
 * permissions and preferences, and the owner in `electron-builder.yml` /
 * `app-update.ts` / `update-policy.json` is the auto-update feed every
 * installed client polls. Pointing them at a repository the public cannot read
 * silently strands existing installs on their current version.
 *
 * These assertions pin the identity to the values the published `v0.1.0` tag
 * shipped, so the same substitution has to fail CI instead of landing quietly,
 * along with the two guards that keep a release honest: every tagged build is a
 * prerelease until a human promotes it, and a macOS build without a certificate
 * fails instead of shipping unsigned. They deliberately assert on the invariant
 * (which owner, which id, which release channel) and not on surrounding prose
 * or formatting.
 */
describe('repository identity', () => {
  it('names the private upstream owner in no tracked file', () => {
    const needle = new RegExp(PRIVATE_OWNER_FRAGMENT, 'gi')
    const offenders = trackedFiles()
      .filter((path) => !SCAN_EXEMPT.has(path))
      .filter((path) => existsSync(join(root, path)))
      .map((path) => ({ path, contents: readFileSync(join(root, path)) }))
      .filter(({ contents }) => !isBinary(contents))
      .map(({ path, contents }) => ({
        path,
        hits: contents.toString('utf8').match(needle)?.length ?? 0
      }))
      .filter(({ hits }) => hits > 0)
      .map(({ path, hits }) => `${path} (${hits})`)

    expect(offenders).toEqual([])
  })

  it('builds the public bundle id and publishes to the public repo', () => {
    const config = source('electron-builder.yml')

    expect(config).toMatch(new RegExp(`^appId:\\s*${APP_ID.replace(/\./g, '\\.')}\\s*$`, 'm'))

    const publish = yamlBlock(config, 'publish')
    expect(publish).toMatch(new RegExp(`^\\s+owner:\\s*${OWNER}\\s*$`, 'm'))
    expect(publish).toMatch(new RegExp(`^\\s+repo:\\s*${REPO}\\s*$`, 'm'))
  })

  it('fails a macOS build that has no signing certificate', () => {
    // Without this an absent certificate only warns, and the release quietly
    // ships an unsigned app. PR builds are unaffected: electron-builder skips
    // signing entirely before the flag is ever consulted.
    const mac = yamlBlock(source('electron-builder.yml'), 'mac')

    expect(mac).toMatch(/^\s+forceCodeSigning:\s*true\s*$/m)
  })

  it('defaults the update feed to the public repo when no env override is set', () => {
    const appUpdate = source('src/main/app-update.ts')

    expect(appUpdate).toMatch(new RegExp(`GITHUB_OWNER\\s*=[^\\n]*\\|\\|\\s*['"]${OWNER}['"]`))
    expect(appUpdate).toMatch(new RegExp(`GITHUB_REPO\\s*=[^\\n]*\\|\\|\\s*['"]${REPO}['"]`))
  })

  it('serves the update policy from the public repo', () => {
    const policy = JSON.parse(source('update-policy.json')) as { url?: string }

    expect(policy.url ?? '').toMatch(PUBLIC_REPO_URL)
  })

  it('declares public package metadata', () => {
    const pkg = JSON.parse(source('package.json')) as {
      author?: string
      homepage?: string
      repository?: { url?: string }
      bugs?: { url?: string }
    }

    expect(pkg.author).toBe(OWNER)
    expect(pkg.homepage ?? '').toMatch(PUBLIC_REPO_URL)
    expect(pkg.repository?.url ?? '').toMatch(PUBLIC_REPO_URL)
    expect(pkg.bugs?.url ?? '').toMatch(PUBLIC_REPO_URL)
  })

  it('names release artifacts with characters GitHub preserves on upload', () => {
    // GitHub rewrites disallowed characters in uploaded asset names (spaces,
    // plus signs, and edge periods are unsafe), while electron-builder writes
    // the name into latest*.yml
    // with a dash and electron-updater downloads by that exact yml name — so
    // an unsafe artifact name 404s every auto-update. `${productName}` contains
    // a space and must never appear here; the literal parts must stay in
    // GitHub's preserved set. v0.1.0 and v0.2.0-rc.1 shipped broken this way.
    const config = source('electron-builder.yml')
    const matches = [...config.matchAll(/^([^\S\r\n]*)artifactName:[^\S\r\n]*(.*?)[^\S\r\n]*$/gm)]

    expect(
      matches.some((match) => match[1] === ''),
      'expected a top-level artifactName'
    ).toBe(true)
    for (const match of matches) {
      const raw = match[2]
      const quote = raw[0]
      const template =
        (quote === '"' || quote === "'") && raw.at(-1) === quote ? raw.slice(1, -1) : raw

      expect(template).not.toContain('${productName}')
      expect(template.replace(/\$\{(?:version|os|arch|ext)\}/g, 'x')).toMatch(SAFE_ASSET_NAME)
    }

    const verifyStep = workflowStep(
      source('.github/workflows/release.yml'),
      'Verify update metadata'
    )
    expect(verifyStep).toContain(`=~ ^${SAFE_ASSET_NAME_PATTERN}$`)
  })

  it('publishes releases as prereleases so promotion stays a manual step', () => {
    // `releases/latest` skips prereleases, so nothing reaches an updater client
    // until a human promotes the release. A tag alone must not be enough.
    const step = workflowStep(source('.github/workflows/release.yml'), 'Publish GitHub Release')

    expect(step).toMatch(/^\s+prerelease:\s*true\s*$/m)
    expect(step).not.toMatch(/prerelease:\s*\$\{\{/)
  })
})
