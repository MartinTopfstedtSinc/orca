import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { connectNativeLoopbackTarget } from '../../browser/network/execution-routes/browser-network-execution-route'
import {
  cheBrowserResponseHeaders,
  cheUpstreamRequestHeaders,
  type ChePortForwardContext
} from './che-port-proxy-headers'
import { resolveChePortTarget, type ChePortTarget } from './che-port-proxy-target'

export type ChePortProxyRoute = Omit<ChePortForwardContext, 'upstreamHost'> & {
  /** Upstream path and query, starting with `/`. */
  path: string
}

// The policy env is empty on purpose: an opt-out for paired browser tunnels never opens Orca's listeners here.
const ENFORCED_POLICY_ENV = {}

export function writeChePortNotice(
  response: ServerResponse,
  status: number,
  message: string
): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  const body = `<!doctype html><meta charset="utf-8"><title>Orca port</title><p>${message}</p>\n`
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(body)
}

async function resolveTarget(port: number): Promise<ChePortTarget | string> {
  const target = await resolveChePortTarget(port)
  if (target === 'orca_listener') {
    return `Port ${port} belongs to Orca and cannot be opened.`
  }
  if (target === 'not_listening') {
    return `Nothing in this workspace listens on localhost:${port}.`
  }
  return target
}

export async function proxyChePortRequest(
  request: IncomingMessage,
  response: ServerResponse,
  route: ChePortProxyRoute
): Promise<void> {
  const target = await resolveTarget(route.port)
  if (typeof target === 'string') {
    writeChePortNotice(response, 502, target)
    return
  }
  let upstreamSocket: Socket
  try {
    upstreamSocket = connectNativeLoopbackTarget(target, ENFORCED_POLICY_ENV)
  } catch {
    writeChePortNotice(response, 403, `Port ${route.port} cannot be opened.`)
    return
  }
  const upstream = httpRequest(
    {
      method: request.method,
      path: route.path,
      headers: cheUpstreamRequestHeaders(
        request.headers,
        { ...route, upstreamHost: target.host },
        false
      ),
      // No agent: a pooled socket could carry this request to another port's app.
      createConnection: () => upstreamSocket
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.statusMessage,
        cheBrowserResponseHeaders(upstreamResponse.headers, route)
      )
      upstreamResponse.pipe(response)
      upstreamResponse.on('error', () => response.destroy())
    }
  )
  upstream.on('error', () =>
    writeChePortNotice(response, 502, `localhost:${route.port} did not answer.`)
  )
  response.on('close', () => upstream.destroy())
  request.pipe(upstream)
}

function rawRequestHead(method: string, path: string, headers: Record<string, unknown>): string {
  const lines = [`${method} ${path} HTTP/1.1`]
  for (const [name, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const text = String(item)
      // Header values never carry line breaks; refusing them keeps the raw head unforgeable.
      if (!/[\r\n]/.test(text)) {
        lines.push(`${name}: ${text}`)
      }
    }
  }
  return `${lines.join('\r\n')}\r\n\r\n`
}

function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/** Pipes a websocket upgrade to the app; the app's handshake answer passes through unchanged. */
export async function proxyChePortUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  route: ChePortProxyRoute
): Promise<void> {
  socket.on('error', () => socket.destroy())
  const target = await resolveTarget(route.port)
  if (typeof target === 'string') {
    refuseUpgrade(socket, 502, 'Bad Gateway')
    return
  }
  let upstream: Socket
  try {
    upstream = connectNativeLoopbackTarget(target, ENFORCED_POLICY_ENV)
  } catch {
    refuseUpgrade(socket, 403, 'Forbidden')
    return
  }
  upstream.on('error', () => socket.destroy())
  socket.on('close', () => upstream.destroy())
  upstream.on('close', () => socket.destroy())
  upstream.once('connect', () => {
    const headers = cheUpstreamRequestHeaders(
      request.headers,
      { ...route, upstreamHost: target.host },
      true
    )
    upstream.write(rawRequestHead(request.method ?? 'GET', route.path, headers))
    if (head.length > 0) {
      upstream.write(head)
    }
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
}
