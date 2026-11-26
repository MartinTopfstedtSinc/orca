import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import {
  listEphemeralVmRuntimes,
  updateEphemeralVmRuntimeStatus
} from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import {
  listEnvironments,
  removeEnvironment
} from '../../shared/remote-runtime/host-store/runtime-environment-store'
import { InvalidArgumentError } from '../runtime/rpc/core'
import { configuration, DevWorkspaceProvider, type Resource } from './devworkspace-provider.mjs'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'

export const recipe = {
  id: 'che-devworkspace',
  name: 'Che DevWorkspace',
  create: 'che:managed',
  suspend: 'che:managed',
  resume: 'che:managed',
  destroy: 'che:managed'
}
export const operations = new Set<string>()
export const dataPath = () => getAppEnvironment().getPath('userData')
export const records = () =>
  listEphemeralVmRuntimes(dataPath()).filter((row) => row.recipeId === recipe.id)
export const provider = () => {
  const config = configuration()
  if (!config) {
    throw new InvalidArgumentError(
      'DevWorkspace provisioning is not configured on this Orca server.'
    )
  }
  return new DevWorkspaceProvider(config)
}

export const find = (id: string) => {
  const row = records().find((entry) => entry.id === id)
  if (!row) {
    throw new InvalidArgumentError('Unknown Che DevWorkspace runtime.')
  }
  return row
}
export const resource = (row: EphemeralVmRuntimeRecord) => {
  const allocation = row.recipeResult?.userData
  if (!allocation) {
    throw new InvalidArgumentError('This Che DevWorkspace runtime has no recorded resources.')
  }
  return allocation as Resource
}
export const update = (id: string, patch: Parameters<typeof updateEphemeralVmRuntimeStatus>[2]) =>
  updateEphemeralVmRuntimeStatus(dataPath(), id, patch)
export const exclusive = async <T>(id: string, operation: () => Promise<T>): Promise<T> => {
  if (operations.has(id)) {
    throw new InvalidArgumentError('An environment lifecycle operation is already running.')
  }
  operations.add(id)
  try {
    return await operation()
  } finally {
    operations.delete(id)
  }
}

export async function cleanup(row: EphemeralVmRuntimeRecord) {
  if (row.status === 'cleaned') {
    return row
  }
  update(row.id, { status: 'cleanup_pending', cleanupStatus: 'running' })
  try {
    await provider().destroy(resource(row))
    if (
      row.runtimeEnvironmentId &&
      (await listEnvironments(dataPath())).some((env) => env.id === row.runtimeEnvironmentId)
    ) {
      await removeEnvironment(dataPath(), row.runtimeEnvironmentId)
    }
    return update(row.id, { status: 'cleaned', cleanupStatus: 'succeeded', cleanupLastError: null })
  } catch (error) {
    return update(row.id, {
      status: 'cleanup_failed',
      cleanupStatus: 'failed',
      cleanupLastError: String(error)
    })
  }
}

// Suspend and resume report failures as values, as upstream's recipe lifecycle does.
export async function lifecycle(
  row: EphemeralVmRuntimeRecord,
  failed: 'suspend_failed' | 'resume_failed',
  operation: () => Promise<EphemeralVmRuntimeRecord>
) {
  try {
    return { ok: true as const, runtime: await exclusive(row.id, operation) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!(error instanceof InvalidArgumentError)) {
      update(row.id, { status: failed, lifecycleLastError: { error: message } })
    }
    return { ok: false as const, error: message }
  }
}
