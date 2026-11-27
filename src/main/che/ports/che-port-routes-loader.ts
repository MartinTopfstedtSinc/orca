import type { ChePortExposureMode } from '../../../shared/workspace/ports/workspace-port-public-url'
import type { RuntimeHttpPortRoutes } from '../../runtime/rpc/transports/websocket/runtime-http-port-routes'

type SettingsOwner = {
  requireStore(): { getSettings(): { chePortExposure?: ChePortExposureMode } }
}

/** Only Che pods carry these; everywhere else the proxy never loads and the listener is unchanged. */
export async function loadChePortRoutes(
  owner: SettingsOwner,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ portRoutes?: RuntimeHttpPortRoutes }> {
  if (!env.DEVWORKSPACE_ID || !env.DEVWORKSPACE_FLATTENED_DEVFILE) {
    return {}
  }
  const { createChePortRoutes } = await import('./che-port-exposure')
  return {
    portRoutes: createChePortRoutes(() => {
      try {
        return owner.requireStore().getSettings().chePortExposure
      } catch {
        return undefined
      }
    })
  }
}
