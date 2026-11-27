import { describe, expect, it, vi } from 'vitest'
import {
  RUNTIME_RPC_CANCEL_CAPABILITY,
  RUNTIME_RPC_CANCEL_METHOD
} from '../../../../../shared/remote-runtime/rpc/runtime-rpc-cancel'
import type { RuntimeRpcResponse } from '../../../../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import {
  createRequestCancelProbe,
  hostCancelsRequests,
  needsOwnSocket,
  unsubscribeOnAbort
} from './web-runtime-shared-subscription'
import { enrollWebRuntimeSubscription } from './web-runtime-dedicated-subscription'
import type { WebRuntimeTransportSubscription } from './web-runtime-subscription-contract'

const status = (capabilities: string[]): RuntimeRpcResponse<unknown> =>
  ({ id: 's', ok: true, result: { capabilities }, _meta: { runtimeId: 'r' } }) as never

describe('needsOwnSocket', () => {
  it('keeps binary protocols on a socket of their own', () => {
    expect(needsOwnSocket('terminal.multiplex', { onResponse: () => {} })).toBe(true)
    expect(needsOwnSocket('browser.screencast', { onResponse: () => {} })).toBe(true)
    expect(needsOwnSocket('anything', { onResponse: () => {}, onBinary: () => {} })).toBe(true)
    expect(needsOwnSocket('agentSession.subscribe', { onResponse: () => {} })).toBe(false)
  })
})

describe('hostCancelsRequests', () => {
  it('needs the capability in a successful status', () => {
    expect(hostCancelsRequests(status([RUNTIME_RPC_CANCEL_CAPABILITY]))).toBe(true)
    expect(hostCancelsRequests(status(['runtime.environments.v1']))).toBe(false)
    expect(
      hostCancelsRequests({ id: 's', ok: false, error: { code: 'x', message: 'x' } } as never)
    ).toBe(false)
  })
})

describe('createRequestCancelProbe', () => {
  it('asks once per connection and again after a reconnect', async () => {
    let epoch = 1
    const read = vi.fn(async () => status([RUNTIME_RPC_CANCEL_CAPABILITY]))
    const probe = createRequestCancelProbe({
      waitForConnected: async () => {},
      connectionEpoch: () => epoch,
      status: read
    })
    expect(await probe()).toBe(true)
    expect(await probe()).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
    epoch = 2
    read.mockResolvedValueOnce(status([]))
    expect(await probe()).toBe(false)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('falls back to own sockets when the host cannot be asked', async () => {
    const offline = createRequestCancelProbe({
      waitForConnected: async () => {
        throw new Error('not connected')
      },
      connectionEpoch: () => 1,
      status: async () => status([RUNTIME_RPC_CANCEL_CAPABILITY])
    })
    expect(await offline()).toBe(false)
    const failing = createRequestCancelProbe({
      waitForConnected: async () => {},
      connectionEpoch: () => 1,
      status: async () => {
        throw new Error('timeout')
      }
    })
    expect(await failing()).toBe(false)
  })
})

describe('unsubscribeOnAbort', () => {
  it('ends the subscription once when its signal aborts', () => {
    const unsubscribe = vi.fn()
    const controller = new AbortController()
    const handle = unsubscribeOnAbort(
      { unsubscribe, sendBinary: () => {} },
      { signal: controller.signal }
    )
    controller.abort()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    handle.unsubscribe()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
    controller.abort()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
  })

  it('ends at once when the signal already aborted', () => {
    const unsubscribe = vi.fn()
    unsubscribeOnAbort({ unsubscribe, sendBinary: () => {} }, { signal: AbortSignal.abort() })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('enrollWebRuntimeSubscription on a shared socket', () => {
  async function enroll(cancelOnUnsubscribe: boolean) {
    const sent: { id: string; method: string; params: unknown }[] = []
    const subscriptions = new Map<string, WebRuntimeTransportSubscription>()
    let next = 0
    const handle = await enrollWebRuntimeSubscription({
      method: 'agentSession.subscribe',
      params: { sessionId: 'a' },
      callbacks: { onResponse: () => {} },
      options: { cancelOnUnsubscribe },
      waitForConnected: async () => {},
      nextId: () => `req_${++next}`,
      subscriptions,
      sendEncrypted: (message) => {
        sent.push(message as (typeof sent)[number])
        return true
      },
      sendBinary: () => true,
      deviceToken: 'device'
    })
    return { sent, subscriptions, handle }
  }

  it('cancels the stream by its current request id', async () => {
    const { sent, subscriptions, handle } = await enroll(true)
    // A reconnect replays the subscription under a new id.
    const subscription = subscriptions.get('req_1')!
    subscriptions.delete('req_1')
    subscription.id = 'req_9'
    subscriptions.set('req_9', subscription)
    handle.unsubscribe()
    expect(subscriptions.size).toBe(0)
    expect(sent.at(-1)).toMatchObject({
      method: RUNTIME_RPC_CANCEL_METHOD,
      params: { id: 'req_9' }
    })
  })

  it('sends nothing extra on a socket of its own, which closes instead', async () => {
    const { sent, handle } = await enroll(false)
    handle.unsubscribe()
    expect(sent.map((message) => message.method)).toEqual(['agentSession.subscribe'])
  })
})
