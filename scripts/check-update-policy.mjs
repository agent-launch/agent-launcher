// Release gate: update-policy.json must never advertise a version ahead of the
// last promoted (non-prerelease) GitHub release.
//
// src/main/app-update.ts ORs two channels: the releases/latest feed (which
// skips prereleases — that skip IS the manual promotion gate) and this file,
// read from main over raw.githubusercontent.com. Bumping latestVersion here
// before promoting shows every client an update banner (force/minVersion can
// make it mandatory) for a build electron-updater cannot download. The rule
// lives in CONTRIBUTING.md "Release gates"; CI enforces it with this script.
//
// Env: GITHUB_REPOSITORY (owner/repo), GITHUB_TOKEN (optional, for rate
// limits), UPDATE_POLICY_PATH (optional override, handy for manual checks
// against a scratch policy file).

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const RETRY_DELAYS_MS = [2000, 5000, 10000]

// normalizeVersion and compareVersions deliberately mirror
// src/main/app-update.ts rather than semver: the client ranks 0.2.0-rc.1
// ABOVE 0.2.0, and the question this gate answers is "would a client show a
// banner", not "is this semver-correct". A stricter comparator would pass
// states that still produce the banner.
// tests/repo/update-policy-gate.test.ts pins both against the client's copy.
export function normalizeVersion(version) {
  return version.trim().replace(/^v/i, '')
}

export function compareVersions(a, b) {
  const left = normalizeVersion(a).split(/[.-]/)
  const right = normalizeVersion(b).split(/[.-]/)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i += 1) {
    const aa = left[i] ?? '0'
    const bb = right[i] ?? '0'
    const an = /^\d+$/.test(aa) ? Number(aa) : Number.NaN
    const bn = /^\d+$/.test(bb) ? Number(bb) : Number.NaN
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      if (an > bn) return 1
      if (an < bn) return -1
      continue
    }
    if (aa > bb) return 1
    if (aa < bb) return -1
  }

  return 0
}

// Pure decision core, unit-tested without the network. `promoted` is the last
// promoted (non-prerelease) release version, or undefined when there is none.
export function evaluatePolicy(policy, promoted) {
  const latestVersion = typeof policy.latestVersion === 'string' ? policy.latestVersion : undefined
  const minVersion = typeof policy.minVersion === 'string' ? policy.minVersion : undefined
  const failures = []

  if (minVersion && latestVersion && compareVersions(minVersion, latestVersion) > 0) {
    failures.push(
      `minVersion ${minVersion} is above latestVersion ${latestVersion}; the policy contradicts itself`
    )
  }

  if (latestVersion || minVersion) {
    if (!promoted) {
      failures.push(
        'the repository has no promoted (non-prerelease) release, so the policy must not advertise any version yet'
      )
    } else {
      if (latestVersion && compareVersions(latestVersion, promoted) > 0) {
        failures.push(
          `latestVersion ${latestVersion} is ahead of the last promoted release ${promoted}; ` +
            `clients would see an update banner for a build electron-updater cannot download`
        )
      }
      if (minVersion && compareVersions(minVersion, promoted) > 0) {
        failures.push(
          `minVersion ${minVersion} is ahead of the last promoted release ${promoted}; ` +
            `every client would be forced toward a build electron-updater cannot download`
        )
      }
    }
  }

  return { latestVersion, minVersion, failures }
}

// An unreachable or misbehaving GitHub API is NOT a policy violation; it gets
// a distinct, named failure so nobody goes hunting for a policy mistake that
// is not there. The gate runs on every push and PR, so transient blips are
// retried before anything goes red.
class ApiUnreachableError extends Error {}

async function fetchPromotedVersion(repository) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'agent-launcher-update-policy-gate'
  }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const url = `https://api.github.com/repos/${repository}/releases/latest`

  let lastFailure = 'no attempt made'
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      console.log(`releases/latest attempt ${attempt} failed (${lastFailure}); retrying...`)
      await sleep(RETRY_DELAYS_MS[attempt - 1])
    }
    try {
      const res = await fetch(url, { headers })
      // 404 is a real answer, not an outage: the repo has no promoted release.
      if (res.status === 404) return undefined
      if (res.ok) {
        const data = await res.json()
        const tagName = typeof data?.tag_name === 'string' ? data.tag_name : undefined
        if (tagName) return normalizeVersion(tagName)
        lastFailure = 'releases/latest returned no tag_name'
        continue
      }
      lastFailure = `HTTP ${res.status}`
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err)
    }
  }
  throw new ApiUnreachableError(lastFailure)
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY || 'agent-launch/agent-launcher'
  const policyPath =
    process.env.UPDATE_POLICY_PATH || new URL('../update-policy.json', import.meta.url)
  const policy = JSON.parse(await readFile(policyPath, 'utf8'))

  const needsPromoted =
    typeof policy.latestVersion === 'string' || typeof policy.minVersion === 'string'
  let promoted
  if (needsPromoted) {
    try {
      promoted = await fetchPromotedVersion(repository)
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err)
      console.error(
        `::error::Could not reach the GitHub API to determine the last promoted release (${cause}). ` +
          `This is not a policy violation - re-run the job.`
      )
      process.exit(1)
    }
  }

  const { latestVersion, minVersion, failures } = evaluatePolicy(policy, promoted)

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`update-policy gate: ${failure}`)
    }
    console.error(
      'Promote the release first, then bump update-policy.json (CONTRIBUTING.md, Release gates).'
    )
    process.exit(1)
  }

  if (needsPromoted) {
    console.log(
      `update-policy.json OK: latestVersion=${latestVersion ?? '(unset)'} minVersion=${minVersion ?? '(unset)'} <= promoted ${promoted}`
    )
  } else {
    console.log('update-policy.json OK: no latestVersion/minVersion advertised')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
