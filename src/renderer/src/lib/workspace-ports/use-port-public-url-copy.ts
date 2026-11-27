import { useMemo } from 'react'
import { useRuntimeEnvironmentCapability } from '@/runtime/rpc/compatibility/use-runtime-environment-capability'
import { WORKSPACE_PORTS_PUBLIC_URL_RUNTIME_CAPABILITY } from '../../../../shared/remote-runtime/protocol/workspace-ports-runtime-capabilities'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { WorkspacePort } from '../../../../shared/workspace/ports/workspace-ports'
import { copyRuntimePortPublicUrl } from './runtime-port-public-url'
import { workspaceRunsOnServer } from './server-port-forward-support'

/** "Copy Public URL" for a server that publishes its ports (Eclipse Che); undefined elsewhere. */
export function usePortPublicUrlCopy(
  runtimeTarget: RuntimeClientTarget | null
): ((port: WorkspacePort) => void) | undefined {
  const environmentId = runtimeTarget?.kind === 'environment' ? runtimeTarget.environmentId : null
  const publishes = useRuntimeEnvironmentCapability(
    environmentId,
    WORKSPACE_PORTS_PUBLIC_URL_RUNTIME_CAPABILITY
  )
  return useMemo(
    () =>
      publishes && environmentId
        ? (port: WorkspacePort) => {
            // A workspace the server reaches over SSH has another localhost than the server's.
            if (
              port.kind !== 'workspace' ||
              workspaceRunsOnServer(environmentId, port.owner.worktreeId)
            ) {
              void copyRuntimePortPublicUrl(environmentId, port.port)
            }
          }
        : undefined,
    [environmentId, publishes]
  )
}
