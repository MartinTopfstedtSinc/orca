import { waitForPromiseWithSignal } from '../../../../../shared/concurrency/abort-signal-reason'
import { RUNTIME_RPC_CANCEL_CAPABILITY } from '../../../../../shared/remote-runtime/rpc/runtime-rpc-cancel'
import type { RuntimeRpcResponse } from '../../../../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import type {
  WebRuntimeSubscribeOptions,
  WebRuntimeSubscriptionCallbacks,
  WebRuntimeTransportSubscriptionHandle
} from './web-runtime-subscription-contract'

/**
 * Browsers cap open WebSockets per profile, so subscriptions share the client's socket when
 * the host can cancel one stream on it. Binary protocols keep a socket of their own: the host
 * routes raw binary frames per socket, one handler each, and this client hands every binary
 * frame to every subscription on the socket.
 */
const OWN_SOCKET_SUBSCRIPTION_METHODS = new Set([
  'terminal.multiplex',
  'terminal.subscribe',
  'browser.screencast',
  'browser.downloadCopyStream',
  'network.browserTunnel',
  'network.portForward',
  'jira.attachmentImage'
])

export function needsOwnSocket(
  method: string,
  callbacks: WebRuntimeSubscriptionCallbacks
): boolean {
  return OWN_SOCKET_SUBSCRIPTION_METHODS.has(method) || callbacks.onBinary !== undefined
}

export function hostCancelsRequests(status: RuntimeRpcResponse<unknown>): boolean {
  if (!status.ok) {
    return false
  }
  const capabilities = (status.result as { capabilities?: unknown } | null)?.capabilities
  return Array.isArray(capabilities) && capabilities.includes(RUNTIME_RPC_CANCEL_CAPABILITY)
}

/** Asks once per connection: a reconnect may reach a different build of the host. */
export function createRequestCancelProbe(host: {
  waitForConnected: (timeoutMs?: number, signal?: AbortSignal) => Promise<void>
  connectionEpoch: () => number
  status: () => Promise<RuntimeRpcResponse<unknown>>
}): (options?: WebRuntimeSubscribeOptions) => Promise<boolean> {
  let known: { epoch: number; supported: Promise<boolean> } | null = null
  return async (options) => {
    try {
      await waitForPromiseWithSignal(
        host.waitForConnected(options?.timeoutMs, options?.signal),
        options?.signal
      )
    } catch {
      // Why: the own-socket path reports connection failures as it always has.
      return false
    }
    const epoch = host.connectionEpoch()
    if (known?.epoch !== epoch) {
      known = { epoch, supported: host.status().then(hostCancelsRequests, () => false) }
    }
    return known.supported
  }
}

/** A shared socket outlives the subscription, so an abort ends just this one. */
export function unsubscribeOnAbort(
  handle: WebRuntimeTransportSubscriptionHandle,
  options?: WebRuntimeSubscribeOptions
): WebRuntimeTransportSubscriptionHandle {
  const signal = options?.signal
  if (!signal) {
    return handle
  }
  const onAbort = (): void => handle.unsubscribe()
  if (signal.aborted) {
    onAbort()
    return handle
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return {
    unsubscribe: () => {
      signal.removeEventListener('abort', onAbort)
      handle.unsubscribe()
    },
    sendBinary: (bytes) => handle.sendBinary(bytes)
  }
}
