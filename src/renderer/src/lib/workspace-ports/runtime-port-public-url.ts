import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { openSystemHttpLink } from '@/lib/browser/navigation/http-link-routing'
import type { WorkspacePortPublicUrl } from '../../../../shared/workspace/ports/workspace-port-public-url'

/** The port and path a server-localhost URL names, or null for anything else. */
export function loopbackUrlPortAndPath(rawUrl: string): { port: number; path: string } | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
    return { port, path: `${url.pathname}${url.search}${url.hash}` }
  } catch {
    return null
  }
}

/** Resolves a server port's public URL. A slot-mode server assigns a slot, so call it from a gesture. */
export async function resolveRuntimePortPublicUrl(
  environmentId: string,
  port: number,
  path?: string,
  ticket = true
): Promise<WorkspacePortPublicUrl> {
  return callRuntimeRpc<WorkspacePortPublicUrl>(
    { kind: 'environment', environmentId },
    'workspacePorts.publicUrl',
    { port, ...(path && path !== '/' ? { path } : {}), ...(ticket ? {} : { ticket: false }) },
    { timeoutMs: 15_000 }
  )
}

function noticeEvictedPort(resolved: WorkspacePortPublicUrl): void {
  if (resolved.evictedPort !== undefined) {
    toast.info(
      translate(
        'auto.lib.workspace.ports.publicUrl.evicted',
        'Port {{port}} gave up its public URL to make room',
        { port: resolved.evictedPort }
      )
    )
  }
}

function noticePublicUrlFailed(port: number): void {
  toast.error(
    translate(
      'auto.lib.workspace.ports.publicUrl.failed',
      "Couldn't open port {{port}} through the server's public route.",
      { port }
    )
  )
}

/** Opens a server port at its public URL in a new browser tab. The RPC answers well inside the
 *  browser's gesture window, so the web client's popup still counts as user-initiated. */
export async function openRuntimePortPublicUrl(
  environmentId: string,
  port: number,
  path?: string
): Promise<void> {
  let resolved: WorkspacePortPublicUrl
  try {
    resolved = await resolveRuntimePortPublicUrl(environmentId, port, path)
  } catch {
    noticePublicUrlFailed(port)
    return
  }
  await openSystemHttpLink(resolved.url)
  noticeEvictedPort(resolved)
  if (resolved.mode === 'che-path') {
    toast.info(
      translate('auto.lib.workspace.ports.publicUrl.opened', 'Opened port {{port}} via Che route', {
        port
      }),
      {
        id: 'che-path-port-route',
        description: translate(
          'auto.lib.workspace.ports.publicUrl.pathModeLimitation',
          'Che path routes need apps that use relative URLs, or the base path in $ORCA_PORT_PUBLIC_PATH_PREFIX.'
        )
      }
    )
  }
}

/** Opens a server-localhost URL (`http://localhost:<port>/<path>`) at its public URL instead. */
export async function openRuntimeLoopbackPublicUrl(
  rawUrl: string,
  environmentId: string
): Promise<void> {
  const target = loopbackUrlPortAndPath(rawUrl)
  if (target) {
    await openRuntimePortPublicUrl(environmentId, target.port, target.path)
  }
}

export async function copyRuntimePortPublicUrl(environmentId: string, port: number): Promise<void> {
  try {
    // A copied link outlives a one-time ticket; whoever opens it signs in from Orca.
    const resolved = await resolveRuntimePortPublicUrl(environmentId, port, undefined, false)
    noticeEvictedPort(resolved)
    const { url } = resolved
    await window.api.ui.writeClipboardText(url)
    toast.success(translate('auto.lib.workspace.ports.publicUrl.copied', 'Public URL copied'))
  } catch {
    noticePublicUrlFailed(port)
  }
}
