// rpc.cancel ends one stream on a shared socket, as closing a socket of its own would.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import { pairedRuntimeConnectionFromOffer } from '../../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { RemoteRuntimeSharedControlConnection } from '../../../../shared/remote-runtime/control/remote-runtime-shared-control-connection'
import {
  RUNTIME_RPC_CANCEL_CAPABILITY,
  RUNTIME_RPC_CANCEL_METHOD
} from '../../../../shared/remote-runtime/rpc/runtime-rpc-cancel'
import { defineStreamingMethod } from '../core'
import { STATUS_METHODS } from '../methods/host-management/status'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'

const streams = new Map<string, { aborted: boolean }>()
const METHODS = [
  ...STATUS_METHODS,
  defineStreamingMethod({
    name: 'test.watch',
    permission: 'workspace',
    params: null,
    handler: (_params, { signal, requestId }, emit) =>
      new Promise<void>((resolve) => {
        const stream = { aborted: false }
        streams.set(requestId!, stream)
        emit({ requestId })
        signal?.addEventListener('abort', () => {
          stream.aborted = true
          resolve()
        })
      })
  })
]

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  streams.clear()
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup()
  }
})

async function startHostAndClient() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-rpc-cancel-'))
  const server = new OrcaRuntimeRpcServer({
    runtime: new OrcaRuntimeService(),
    userDataPath,
    enableWebSocket: true,
    wsPort: 0,
    methods: METHODS
  })
  await server.start()
  cleanups.push(async () => {
    await server.stop().catch(() => {})
    rmSync(userDataPath, { recursive: true, force: true })
  })
  const offer = server.createPairingOffer({ address: '127.0.0.1', scope: 'runtime', name: 'Desk' })
  if (!offer.available) {
    throw new Error('WebSocket pairing unavailable')
  }
  const connection = pairedRuntimeConnectionFromOffer(parsePairingCode(offer.pairingUrl)!)
  return { client: connect(connection), connect: () => connect(connection) }
}

function connect(connection: ReturnType<typeof pairedRuntimeConnectionFromOffer>) {
  const client = new RemoteRuntimeSharedControlConnection(connection, { clientCapabilities: [] })
  cleanups.push(() => client.close())
  return client
}

async function openStream(client: RemoteRuntimeSharedControlConnection): Promise<string> {
  const first = Promise.withResolvers<string>()
  const watch = await client.subscribe<{ requestId: string }>('test.watch', null, 5_000, {
    onResponse: (response) => {
      if (response.ok) {
        first.resolve(response.result.requestId)
      }
    },
    onError: () => {}
  })
  cleanups.push(() => watch.close())
  return first.promise
}

describe('rpc.cancel', () => {
  it('ends only the named stream and keeps the socket open', async () => {
    const { client } = await startHostAndClient()
    const status = await client.request<{ capabilities?: string[] }>('status.get', undefined, 5_000)
    expect(status.ok && status.result.capabilities).toContain(RUNTIME_RPC_CANCEL_CAPABILITY)

    const cancelledId = await openStream(client)
    const keptId = await openStream(client)
    const cancel = await client.request(RUNTIME_RPC_CANCEL_METHOD, { id: cancelledId }, 5_000)
    expect(cancel).toMatchObject({ ok: true, result: { cancelled: true } })
    await vi.waitFor(() => expect(streams.get(cancelledId)?.aborted).toBe(true))
    expect(streams.get(keptId)?.aborted).toBe(false)

    // A finished or unknown request is not an error, so a late cancel is harmless.
    const again = await client.request(RUNTIME_RPC_CANCEL_METHOD, { id: cancelledId }, 5_000)
    expect(again).toMatchObject({ ok: true, result: { cancelled: false } })
    const unknown = await client.request(RUNTIME_RPC_CANCEL_METHOD, { id: 'nope' }, 5_000)
    expect(unknown).toMatchObject({ ok: true, result: { cancelled: false } })
    expect((await client.request('status.get', undefined, 5_000)).ok).toBe(true)
  })

  it('cannot end a stream that another socket opened', async () => {
    const { client: owner, connect } = await startHostAndClient()
    const ownerStream = await openStream(owner)
    // Request ids are only unique per socket, so the same device's other socket must not match.
    const other = connect()
    const cancel = await other.request(RUNTIME_RPC_CANCEL_METHOD, { id: ownerStream }, 5_000)
    expect(cancel).toMatchObject({ ok: true, result: { cancelled: false } })
    expect(streams.get(ownerStream)?.aborted).toBe(false)
  })
})
