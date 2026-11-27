import { throwIfSignalAborted } from '../../../../../shared/concurrency/abort-signal-reason'
import { WebRuntimeClient } from './web-runtime-client'
import {
  createRequestCancelProbe,
  needsOwnSocket,
  unsubscribeOnAbort
} from './web-runtime-shared-subscription'
import type {
  WebRuntimeSubscribeOptions,
  WebRuntimeSubscriptionCallbacks,
  WebRuntimeTransportSubscriptionHandle
} from './web-runtime-subscription-contract'

/**
 * A client whose subscriptions share its one socket when the host can cancel a stream on it.
 * Without that, or for binary protocols, it gives each subscription a socket of its own as
 * the base client does.
 */
export class SharedSocketWebRuntimeClient extends WebRuntimeClient {
  private readonly hostCancelsRequests = createRequestCancelProbe({
    waitForConnected: (timeoutMs, signal) => this.waitForConnected(timeoutMs, signal),
    connectionEpoch: () => this.connectionEpoch,
    status: () => this.transport.call('status.get', undefined, { timeoutMs: 15_000 })
  })

  override subscribe(
    method: string,
    params: unknown,
    callbacks: WebRuntimeSubscriptionCallbacks,
    options?: WebRuntimeSubscribeOptions
  ): Promise<WebRuntimeTransportSubscriptionHandle> {
    // files.watch already shares the socket and has its own unwatch.
    return method === 'files.watch' || needsOwnSocket(method, callbacks)
      ? super.subscribe(method, params, callbacks, options)
      : this.subscribeShared(method, params, callbacks, options)
  }

  private async subscribeShared(
    method: string,
    params: unknown,
    callbacks: WebRuntimeSubscriptionCallbacks,
    options?: WebRuntimeSubscribeOptions
  ): Promise<WebRuntimeTransportSubscriptionHandle> {
    throwIfSignalAborted(options?.signal)
    if (!(await this.hostCancelsRequests(options))) {
      return super.subscribe(method, params, callbacks, options)
    }
    const handle = await this.subscribeOnCurrentConnection(method, params, callbacks, {
      ...options,
      cancelOnUnsubscribe: true
    })
    return unsubscribeOnAbort(handle, options)
  }
}
