export function normalizeVersion(version: string): string
export function compareVersions(a: string, b: string): number
export interface PolicyEvaluation {
  latestVersion?: string
  minVersion?: string
  failures: string[]
}
export function evaluatePolicy(
  policy: Record<string, unknown>,
  promoted: string | undefined
): PolicyEvaluation
