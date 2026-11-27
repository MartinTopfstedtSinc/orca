import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { reserveBrowserTunnelOrcaListenerPort } from '../../browser/network/tunnels/browser-network-tunnel-destination-policy'
import {
  proxyChePortRequest,
  proxyChePortUpgrade,
  writeChePortNotice,
  type ChePortProxyRoute
} from './che-port-proxy'
import {
  CHE_PORT_SLOT_COOKIE,
  expireRequestCookies,
  readRequestCookie,
  type ChePortSlotAuth
} from './che-port-slot-auth'
import type { ChePortSlot, ChePortSlotTable } from './che-port-slots'

export const CHE_PORT_SLOT_AUTH_PATH = '/__orca/auth'
const SIGN_IN_NOTICE = 'Open this port from Orca to sign in to it.'

function slotRoute(slot: ChePortSlot, port: number, path: string): ChePortProxyRoute {
  return {
    port,
    path,
    publicOrigin: slot.origin,
    publicPrefix: '',
    forwardedHost: new URL(slot.origin).host,
    forwardedPrefix: ''
  }
}

function isSafeLocalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !/[\\\r\n]/.test(path)
}

/** One listener per subdomain endpoint. Che routes the endpoint to the pod IP, so these bind all
 *  interfaces and every request must carry the slot cookie for the slot's current assignment. */
export class ChePortSlotServers {
  private readonly servers: Server[] = []
  private readonly releases: (() => void)[] = []

  constructor(
    private readonly table: ChePortSlotTable,
    private readonly auth: ChePortSlotAuth
  ) {}

  async start(): Promise<void> {
    await Promise.all(
      this.table.slots.map(async (slot) => {
        const server = createServer((request, response) =>
          this.handleRequest(slot, request, response)
        )
        server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) =>
          this.handleUpgrade(slot, request, socket, head)
        )
        try {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(slot.targetPort, '0.0.0.0', () => {
              server.off('error', reject)
              resolve()
            })
          })
        } catch (error) {
          console.warn(
            `[che-ports] Slot ${slot.name} cannot listen on ${slot.targetPort}: ${String(error)}`
          )
          return
        }
        this.servers.push(server)
        // A slot listener is Orca's own: no port route or paired tunnel may dial it.
        this.releases.push(reserveBrowserTunnelOrcaListenerPort(slot.targetPort))
      })
    )
  }

  stop(): void {
    for (const server of this.servers.splice(0)) {
      server.close()
      server.closeAllConnections()
    }
    for (const release of this.releases.splice(0)) {
      release()
    }
  }

  private authorized(slot: ChePortSlot, request: IncomingMessage): boolean {
    const cookie = readRequestCookie(request.headers.cookie, CHE_PORT_SLOT_COOKIE)
    return slot.assignedPort !== null && this.auth.verifyCookie(cookie, slot.name, slot.generation)
  }

  private redeem(slot: ChePortSlot, request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? '/', 'https://slot.invalid')
    const ticket = url.searchParams.get('ticket') ?? ''
    const path =
      slot.assignedPort === null ? null : this.auth.redeemTicket(ticket, slot.name, slot.generation)
    if (!path || !isSafeLocalPath(path)) {
      writeChePortNotice(response, 401, SIGN_IN_NOTICE)
      return
    }
    const cookies = [this.auth.setCookieHeader(slot.name, slot.generation)]
    const headers: Record<string, string | string[]> = {
      Location: path,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Length': '0'
    }
    if (slot.clearPending) {
      slot.clearPending = false
      // "cookies" would clear the whole registrable domain in Chromium; expire this host's instead.
      headers['Clear-Site-Data'] = '"storage", "cache"'
      cookies.unshift(...expireRequestCookies(request.headers.cookie))
    }
    headers['Set-Cookie'] = cookies
    response.writeHead(303, headers)
    response.end()
  }

  private handleRequest(
    slot: ChePortSlot,
    request: IncomingMessage,
    response: ServerResponse
  ): void {
    if ((request.url ?? '').split('?')[0] === CHE_PORT_SLOT_AUTH_PATH) {
      this.redeem(slot, request, response)
      return
    }
    if (!this.authorized(slot, request) || slot.assignedPort === null) {
      writeChePortNotice(response, 401, SIGN_IN_NOTICE)
      return
    }
    this.table.touch(slot)
    const route = slotRoute(slot, slot.assignedPort, request.url ?? '/')
    void proxyChePortRequest(request, response, route).catch(() =>
      writeChePortNotice(response, 502, 'The port could not be reached.')
    )
  }

  private handleUpgrade(
    slot: ChePortSlot,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): void {
    if (!this.authorized(slot, request) || slot.assignedPort === null) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    this.table.touch(slot)
    const route = slotRoute(slot, slot.assignedPort, request.url ?? '/')
    void proxyChePortUpgrade(request, socket, head, route).catch(() => socket.destroy())
  }
}
