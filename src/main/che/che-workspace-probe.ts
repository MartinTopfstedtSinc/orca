import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { checkRepoUrl, configuration, DevWorkspaceProvider } from './devworkspace-provider.mjs'

// Agent workspaces are an upgrade, not a requirement: when this server cannot create
// one, the composer offers only its normal targets and workspaces stay on this host.
type Probe = { repoUrl: string } | { reason: string | null }
type Repo = { path: string; kind?: string }
const run = promisify(execFile)
const CLUSTER_CHECK_MS = 30_000
let clusterCheck: { at: number; reason: Promise<string | null> } | null = null
let loggedReason: string | null = null

function clusterUnavailable(backend: DevWorkspaceProvider): Promise<string | null> {
  if (!clusterCheck || Date.now() - clusterCheck.at > CLUSTER_CHECK_MS) {
    const reason = backend.unavailable(AbortSignal.timeout(10_000)).catch((error) => String(error))
    clusterCheck = { at: Date.now(), reason }
  }
  return clusterCheck.reason
}

// A null reason means the feature is not configured, which needs no explanation.
export async function probe(repo: Repo | undefined): Promise<Probe> {
  let config
  try {
    config = configuration()
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) }
  }
  if (!config) {
    return { reason: null }
  }
  if (!repo || repo.kind === 'folder') {
    return { reason: 'The project is not a Git repository.' }
  }
  let repoUrl: string
  try {
    repoUrl = (
      await run('git', ['remote', 'get-url', 'origin'], {
        cwd: repo.path,
        encoding: 'utf8',
        timeout: 10_000
      })
    ).stdout.trim()
    checkRepoUrl(repoUrl)
  } catch (error) {
    return {
      reason:
        error instanceof Error && !('code' in error)
          ? error.message
          : 'The project has no Git origin.'
    }
  }
  const reason = await clusterUnavailable(new DevWorkspaceProvider(config))
  return reason ? { reason } : { repoUrl }
}

export function logUnavailable(reason: string | null) {
  if (!reason || reason === loggedReason) {
    return
  }
  loggedReason = reason
  console.warn(`Agent workspaces unavailable; creating workspaces on this host: ${reason}`)
}

// A refused create may mean the cluster changed, so the next probe asks it again.
export function forgetClusterCheck(): void {
  clusterCheck = null
}
