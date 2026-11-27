import { randomUUID } from 'node:crypto'
import { upsertEphemeralVmRuntime } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import { addEnvironmentFromPairingCode } from '../../shared/remote-runtime/host-store/runtime-environment-store'
import { redactRuntimeEnvironment } from '../../shared/remote-runtime/host-catalog/runtime-environments'
import { InvalidArgumentError } from '../runtime/rpc/core'
import { forgetClusterCheck, logUnavailable, probe } from './che-workspace-probe'
import {
  cleanup,
  dataPath,
  find,
  operations,
  provider,
  recipe,
  update
} from './che-workspace-records'

export type CheProvisionArgs = {
  repoId: string
  projectId?: string
  workspaceId?: string
  workspaceName?: string
  provisionId?: string
}

const controllers = new Map<string, AbortController>()

const failed = (error: string, fallback?: boolean) => ({
  ok: false as const,
  ...(fallback ? { fallback: true } : {}),
  error,
  stdout: '',
  stderr: ''
})

/** Stops a create by its provision ID; false when none is running. */
export function cancelCheProvision(provisionId: string): boolean {
  const controller = controllers.get(provisionId)
  controller?.abort()
  return Boolean(controller)
}

/** Creates a DevWorkspace for the project and pairs its Orca server with this one.
 *  The browser's composer and `worker-start --on agent-workspace` both create through here. */
export async function provisionCheWorkspace(
  repo: { path: string; kind?: string } | undefined,
  args: CheProvisionArgs,
  signal?: AbortSignal
) {
  const id = randomUUID()
  const key = args.provisionId ?? id
  if (controllers.has(key)) {
    throw new InvalidArgumentError('Provisioning is already running for this request.')
  }
  // Register first so cancelProvision also stops a create still waiting on the probe.
  const controller = new AbortController()
  controllers.set(key, controller)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) {
    abort()
  }
  const release = () => {
    signal?.removeEventListener('abort', abort)
    controllers.delete(key)
  }
  let checked: Awaited<ReturnType<typeof probe>>
  try {
    checked = await probe(repo)
  } catch (error) {
    release()
    throw error
  }
  if ('reason' in checked) {
    release()
    // Recheck at create time: the composer's recipe list can be stale.
    const error = checked.reason ?? 'Agent workspaces are not configured on this Orca server.'
    logUnavailable(error)
    return failed(error, true)
  }
  if (controller.signal.aborted) {
    release()
    return failed('Provisioning was cancelled.')
  }
  const backend = provider()
  const allocation = backend.allocation(id)
  const now = Date.now()
  upsertEphemeralVmRuntime(dataPath(), {
    id,
    recipeId: recipe.id,
    recipe,
    repoId: args.repoId,
    projectId: args.projectId,
    workspaceId: args.workspaceId,
    workspaceName: args.workspaceName,
    status: 'provisioning',
    cleanupStatus: 'not_started',
    createdAt: now,
    updatedAt: now,
    recipeResult: {
      schemaVersion: 1,
      pairingCode: 'pending',
      projectRoot: '/projects/source',
      userData: allocation
    }
  })
  operations.add(id)
  try {
    const recipeResult = await backend.create(allocation, checked.repoUrl, controller.signal)
    const environment = await addEnvironmentFromPairingCode(dataPath(), {
      name: `${args.workspaceName || 'Che workspace'} (${id.slice(0, 8)})`,
      pairingCode: recipeResult.pairingCode,
      source: 'ephemeral-vm'
    })
    const row = update(id, {
      status: 'running',
      connectionMode: 'orca-server',
      runtimeEnvironmentId: environment.id,
      recipeResult
    })
    return {
      ok: true as const,
      connectionType: 'orca-server' as const,
      runtime: row,
      environment: redactRuntimeEnvironment(environment),
      stderr: '',
      warnings: []
    }
  } catch (error) {
    // Rollback is not cancellable; a failed rollback stays recorded for retry.
    await cleanup(find(id))
    // Failures before the DevWorkspace exists (quota, admission, Route) fall back to this host.
    const fallback =
      error instanceof Error && (error as Error & { fallback?: boolean }).fallback === true
    if (fallback) {
      forgetClusterCheck()
    }
    return failed(error instanceof Error ? error.message : String(error), fallback)
  } finally {
    release()
    operations.delete(id)
  }
}
