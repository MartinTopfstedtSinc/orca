// `worker-start --on agent-workspace`: create a Che agent workspace for the project, then start the
// worker on its Orca server the way `--on <server>` starts one on any paired server. The browser's
// composer creates agent workspaces through the same provisioning, so both kinds look alike.
import { AGENT_WORKSPACE_SERVER } from '../../shared/che/agent-workspace-target'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import type { WorkerStartInput } from '../runtime/rpc/methods/orchestration/worker/start/worker-start-input'
import { provisionCheWorkspace } from './che-workspace-provision'
import { cleanup, exclusive, find, update } from './che-workspace-records'

type Runtime = Pick<OrcaRuntimeService, 'listRepos' | 'getOrchestrationDb'>
type Repo = ReturnType<OrcaRuntimeService['listRepos']>[number]

// Che clones the project as the DevWorkspace's `source` project; its Orca registers that checkout.
const AGENT_WORKSPACE_REPO = 'path:/projects/source'

/** This Orca's one project `--repo` names, by `id:`, `path:` or `name:`, or by any of them bare. */
function findRepo(repos: readonly Repo[], selector: string): Repo | undefined {
  const prefixed = /^(id|path|name):(.*)$/s.exec(selector)
  const kind = prefixed?.[1]
  const value = prefixed ? prefixed[2] : selector
  const matches = repos.filter(
    (repo) =>
      ((!kind || kind === 'id') && repo.id === value) ||
      ((!kind || kind === 'path') && repo.path === value) ||
      ((!kind || kind === 'name') && repo.displayName === value)
  )
  return matches.length === 1 ? matches[0] : undefined
}

/** The paired server a start is sent to, or undefined for one that runs on this Orca or in a new
 *  agent workspace, which `worker-start --item` may use as well: this Orca keeps its Dispatch. */
export function remoteServer(params: Pick<WorkerStartInput, 'on'>): string | undefined {
  return params.on === AGENT_WORKSPACE_SERVER ? undefined : params.on
}

const refuse = (message: string): never => {
  throw new OrchestrationError('invalid_argument', `${message} No effects were applied.`, {
    effectsApplied: false
  })
}

/** Starts the worker with `start`, first creating its agent workspace when the start asks for one. */
export async function placeOnAgentWorkspace<T>(
  runtime: Runtime,
  params: WorkerStartInput,
  start: (params: WorkerStartInput) => Promise<T>
): Promise<T> {
  if (params.on !== AGENT_WORKSPACE_SERVER) {
    return start(params)
  }
  const worktree = params.worktree ?? 'new-top-level'
  if (worktree !== 'new-top-level' && worktree !== 'new-child') {
    refuse(
      '--on agent-workspace starts the worker in a new workspace: use new-child or new-top-level.'
    )
  }
  if (!params.repo) {
    refuse('--on agent-workspace needs --repo naming the project on this Orca.')
  }
  if (params.terminal) {
    refuse('--terminal cannot combine with --on agent-workspace.')
  }
  const repo = findRepo(runtime.listRepos(), params.repo as string)
  if (!repo) {
    return refuse(`No one project on this Orca matches --repo ${params.repo}.`)
  }
  const provisioned = await provisionCheWorkspace(repo, {
    repoId: repo.id,
    workspaceName: params.name ?? params.displayName ?? params.taskTitle
  })
  if (!provisioned.ok) {
    throw new OrchestrationError(
      'host_unavailable',
      `Could not create an agent workspace: ${provisioned.error} No worker was started.`,
      { effectsApplied: false }
    )
  }
  const runtimeId = provisioned.runtime.id
  const removeWorkspace = () => exclusive(runtimeId, () => cleanup(find(runtimeId)))
  let receipt: T
  try {
    receipt = await start({
      ...params,
      on: provisioned.environment.id,
      // A new-child here nests under the caller's workspace on this Orca, as on any paired server.
      worktree,
      repo: AGENT_WORKSPACE_REPO
    })
  } catch (error) {
    await removeWorkspace().catch(() => undefined)
    throw error
  }
  const placed = receipt as { state?: string; dispatchId?: string } | null
  if (placed?.state === 'ready' && placed.dispatchId) {
    // The worker's workspace owns the environment: removing it in Orca removes the DevWorkspace.
    const workspaceId = runtime
      .getOrchestrationDb()
      .getFederatedDispatch(placed.dispatchId)?.remote_worktree_id
    if (workspaceId) {
      update(runtimeId, { workspaceId })
    }
  } else if (placed?.state !== 'outcome_unknown') {
    // Nothing runs there: a failed start leaves no workspace behind.
    await removeWorkspace().catch(() => undefined)
  }
  return receipt
}
