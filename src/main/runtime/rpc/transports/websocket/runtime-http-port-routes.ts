import type {
  IncomingMessage,
  RequestListener,
  Server as HttpServer,
  ServerResponse
} from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'

/** Extra HTTP routes consulted before the web client and the runtime upgrade; false means "not mine". */
export type RuntimeHttpPortRoutes = {
  handleRequest(request: IncomingMessage, response: ServerResponse): boolean
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean
  /** The port the runtime listener bound, once it did. */
  onListening?(port: number): void
}

export function withRuntimeHttpPortRoutes(
  handler: RequestListener,
  routes: RuntimeHttpPortRoutes | undefined
): RequestListener {
  return routes
    ? (request, response) => {
        if (!routes.handleRequest(request, response)) {
          handler(request, response)
        }
      }
    : handler
}

/** Without routes the server owns every upgrade, exactly as before routes existed. */
export function createRuntimeWebSocketServer(
  httpServer: HttpServer,
  routes: RuntimeHttpPortRoutes | undefined,
  maxPayload: number
): WebSocketServer {
  if (!routes) {
    return new WebSocketServer({ server: httpServer, maxPayload })
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload })
  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!routes.handleUpgrade(request, socket, head)) {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
    }
  })
  return wss
}
