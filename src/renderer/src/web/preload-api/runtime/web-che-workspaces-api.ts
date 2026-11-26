import type { PreloadApi } from '../../../../../preload/api-types'
import type { KnownRuntimeEnvironment } from '../../../../../shared/remote-runtime/host-catalog/runtime-environments'
import { callRuntimeResult } from '../../runtime/client/web-runtime-calls'
import { setCheEnvironments } from '../../runtime/client/web-che-environments'
import {
  assertActiveEnvironment,
  closeCheRuntimeClients,
  getClientForEnvironment,
  invalidateRuntimeWorktreeCaches,
  requireActiveEnvironment
} from '../../runtime/client/web-runtime-session'
import { noopUnsubscribe } from '../web-storage'

type EphemeralVmApi = PreloadApi['ephemeralVm']

export async function refreshCheEnvironments(): Promise<KnownRuntimeEnvironment[]> {
  const controller = requireActiveEnvironment().id
  const environments = await callRuntimeResult<KnownRuntimeEnvironment[]>('cheWorkspace.environments')
  assertActiveEnvironment(controller)
  if (!Array.isArray(environments)) throw new Error('Invalid Che runtime environment response.')
  setCheEnvironments(environments)
  return environments
}

// The browser has no Electron main process, so the controlling orcad runs the lifecycle.
export function createWebCheWorkspacesApi(): EphemeralVmApi {
  const call = <T>(method: string, args?: unknown) =>
    callRuntimeResult<T>(`cheWorkspace.${method}`, args, 360_000)
  const lifecycle = async (method: 'suspendWorkspace' | 'resumeWorkspace', args: { workspaceId: string }) => {
    const result = await call<Awaited<ReturnType<EphemeralVmApi[typeof method]>>>(method, args)
    // Suspend stops the pod and resume issues new pairing credentials; reconnect either way.
    if (result.ok && result.runtime?.runtimeEnvironmentId) closeCheRuntimeClients(result.runtime.runtimeEnvironmentId)
    if (method === 'resumeWorkspace') await refreshCheEnvironments().catch(() => undefined)
    return result
  }
  return {
    listRecipes: (args) => call('listRecipes', args),
    listRecipeCatalog: async () => [],
    // Agent environments run no recipe scripts, so no host credentials reach them.
    listCredentialEnvNames: async () => [],
    doctor: async () => {
      throw new Error('Che environment configuration is managed by the deployment administrator.')
    },
    provision: async (args) => {
      const result = await call<Awaited<ReturnType<EphemeralVmApi['provision']>>>('provision', args)
      // The workspace exists now; a failed refresh must not hide it from the caller.
      if (result.ok) await refreshCheEnvironments().catch(() => undefined)
      return result
    },
    // Cancellation must not queue behind a full set of long-running creates.
    cancelProvision: async (args) => {
      const environment = requireActiveEnvironment()
      const response = await getClientForEnvironment(environment).call('cheWorkspace.cancelProvision', args, {
        timeoutMs: 15_000
      })
      if (!response.ok) throw new Error(response.error.message)
      return response.result as { cancelled: boolean }
    },
    onProvisionEvent: () => noopUnsubscribe,
    listRuntimes: () => call('listRuntimes'),
    attachWorkspace: (args) => call('attachWorkspace', args),
    suspendWorkspace: (args) => lifecycle('suspendWorkspace', args),
    resumeWorkspace: (args) => lifecycle('resumeWorkspace', args),
    onRuntimesChanged: () => noopUnsubscribe,
    cleanup: async (args) => {
      const row = await call<Awaited<ReturnType<EphemeralVmApi['cleanup']>>>('cleanup', args)
      if (row.runtimeEnvironmentId) closeCheRuntimeClients(row.runtimeEnvironmentId)
      await refreshCheEnvironments()
      invalidateRuntimeWorktreeCaches()
      return row
    },
    stopCleanup: async () => {
      throw new Error('Wait for the Kubernetes cleanup operation to finish, then retry if needed.')
    },
    // The server records each environment before it creates anything, so there is nothing to forget.
    forgetRuntime: async () => undefined,
    getCleanupCommand: async ({ runtimeId }) => ({
      runtimeId,
      command: null,
      payloadJson: '{}',
      cleanupDisabled: false,
      message: 'This environment is managed through the Che DevWorkspace API.'
    }),
    // Agent environments clone on the cluster, so the browser holds no pending checkouts.
    publishPendingCheckouts: () => undefined,
    listPendingCheckouts: async () => [],
    onPendingCheckoutsChanged: () => noopUnsubscribe
  }
}
