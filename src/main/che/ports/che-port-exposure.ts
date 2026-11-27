import type { RuntimeHttpPortRoutes } from '../../runtime/rpc/transports/websocket/runtime-http-port-routes'
import type {
  ChePortExposureMode,
  WorkspacePortPublicUrl
} from '../../../shared/workspace/ports/workspace-port-public-url'
import { setChePortPublicUrls, type ChePortPublicUrls } from './che-port-exposure-registry'
import { discoverCheEndpoints, type CheEndpoints } from './che-endpoint-discovery'
import {
  CHE_PORT_ABSOLUTE_PATH_PREFIX,
  CHE_PORT_PATH_PREFIX,
  parseChePortPath,
  resolveChePortTarget
} from './che-port-proxy-target'
import { ChePortSlotTable } from './che-port-slots'
import { ChePortSlotAuth } from './che-port-slot-auth'
import { CHE_PORT_SLOT_AUTH_PATH, ChePortSlotServers } from './che-port-slot-servers'
import {
  proxyChePortRequest,
  proxyChePortUpgrade,
  writeChePortNotice,
  type ChePortProxyRoute
} from './che-port-proxy'

export const CHE_PORT_PUBLIC_PATH_PREFIX_ENV = 'ORCA_PORT_PUBLIC_PATH_PREFIX'
export const CHE_PORT_PUBLIC_ORIGIN_ENV = 'ORCA_PORT_PUBLIC_ORIGIN'

type ReadMode = () => ChePortExposureMode | undefined

const isListening = async (port: number): Promise<boolean> =>
  typeof (await resolveChePortTarget(port)) === 'object'

export class ChePortExposure implements ChePortPublicUrls {
  constructor(
    readonly endpoints: CheEndpoints,
    private readonly readMode: ReadMode,
    private readonly slots: ChePortSlotTable | null = null,
    private readonly auth: ChePortSlotAuth = new ChePortSlotAuth()
  ) {}

  private get slotModeEnabled(): boolean {
    const mode = this.readMode() ?? 'auto'
    return (mode === 'auto' || mode === 'slots') && this.slots?.available === true
  }

  get pathModeEnabled(): boolean {
    return (this.readMode() ?? 'auto') !== 'off'
  }

  /** `/<user>/<ws>/<port>/__orca/port` (prefix stripped) or `…/__orca/absport` (kept); append `/<n>/`. */
  private routePrefix(absolute: boolean): string {
    const route = absolute ? CHE_PORT_ABSOLUTE_PATH_PREFIX : CHE_PORT_PATH_PREFIX
    return `${this.endpoints.mainPathPrefix}${route.slice(0, -1)}`
  }

  get publicPathPrefix(): string {
    return this.routePrefix(false)
  }

  async publicUrl(
    port: number,
    path = '/',
    options: { ticket?: boolean } = {}
  ): Promise<WorkspacePortPublicUrl | null> {
    if (!this.pathModeEnabled) {
      return null
    }
    const suffix = path.startsWith('/') ? path : `/${path}`
    if (this.slots && this.slotModeEnabled) {
      // Never spend a slot (and evict another app) on Orca's own or a closed port.
      if (!(await isListening(port))) {
        return null
      }
      const { slot, evictedPort } = await this.slots.assign(port)
      const evicted = evictedPort === null ? {} : { evictedPort }
      if (options.ticket === false) {
        return { url: `${slot.origin}${suffix}`, mode: 'che-slot', ...evicted }
      }
      const ticket = this.auth.mintTicket(slot.name, slot.generation, suffix)
      return {
        url: `${slot.origin}${CHE_PORT_SLOT_AUTH_PATH}?ticket=${ticket}`,
        mode: 'che-slot',
        ...evicted
      }
    }
    return {
      url: `${this.endpoints.publicOrigin}${this.publicPathPrefix}/${port}${suffix}`,
      mode: 'che-path'
    }
  }

  publicBaseUrl(): string | null {
    return this.pathModeEnabled ? `${this.endpoints.publicOrigin}${this.publicPathPrefix}/` : null
  }

  ptyEnv(): Record<string, string> {
    return this.pathModeEnabled
      ? {
          // A base path names the full public path, so apps configured with it use the kept-prefix route.
          [CHE_PORT_PUBLIC_PATH_PREFIX_ENV]: this.routePrefix(true),
          [CHE_PORT_PUBLIC_ORIGIN_ENV]: this.endpoints.publicOrigin
        }
      : {}
  }

  private pathRoute(port: number, path: string, absolute: boolean): ChePortProxyRoute {
    const routePath = `${this.routePrefix(absolute)}/${port}`
    return {
      port,
      // The kept-prefix route hands the app the full public path its base path names.
      path: absolute ? `${routePath}${path}` : path,
      publicOrigin: this.endpoints.publicOrigin,
      publicPrefix: routePath,
      publicRoot: `${this.endpoints.mainPathPrefix}/`,
      forwardedHost: new URL(this.endpoints.publicOrigin).host,
      forwardedPrefix: routePath
    }
  }

  readonly httpRoutes: RuntimeHttpPortRoutes = {
    handleRequest: (request, response) => {
      const parsed = parseChePortPath(request.url)
      if (!parsed) {
        return false
      }
      if (!this.pathModeEnabled || parsed.kind === 'invalid') {
        writeChePortNotice(response, 404, 'Not found.')
        return true
      }
      if (parsed.kind === 'redirect') {
        response.writeHead(308, {
          Location: `${this.routePrefix(parsed.absolute)}/${parsed.port}/`,
          'Content-Length': 0
        })
        response.end()
        return true
      }
      const route = this.pathRoute(parsed.port, parsed.path, parsed.absolute)
      void proxyChePortRequest(request, response, route).catch(() =>
        writeChePortNotice(response, 502, 'The port could not be reached.')
      )
      return true
    },
    handleUpgrade: (request, socket, head) => {
      const parsed = parseChePortPath(request.url)
      if (!parsed) {
        return false
      }
      if (!this.pathModeEnabled || parsed.kind !== 'proxy') {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return true
      }
      void proxyChePortUpgrade(
        request,
        socket,
        head,
        this.pathRoute(parsed.port, parsed.path, parsed.absolute)
      ).catch(() => socket.destroy())
      return true
    }
  }
}

let active: ChePortExposure | null = null
let discovery: Promise<void> | null = null

async function startChePortExposure(mainPort: number, readMode: ReadMode): Promise<void> {
  try {
    const endpoints = await discoverCheEndpoints(mainPort)
    if (endpoints) {
      const slots = new ChePortSlotTable(endpoints.slots, isListening)
      const auth = new ChePortSlotAuth()
      if (slots.available) {
        await new ChePortSlotServers(slots, auth).start()
      }
      active = new ChePortExposure(endpoints, readMode, slots.available ? slots : null, auth)
      setChePortPublicUrls(active)
    }
  } catch (error) {
    console.warn(
      `[che-ports] Public port URLs unavailable: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/** Routes that claim nothing until discovery finds this listener behind the Che main endpoint. */
export function createChePortRoutes(readMode: ReadMode): RuntimeHttpPortRoutes {
  return {
    handleRequest: (request, response) =>
      active?.httpRoutes.handleRequest(request, response) ?? false,
    handleUpgrade: (request, socket, head) =>
      active?.httpRoutes.handleUpgrade(request, socket, head) ?? false,
    onListening: (port) => {
      discovery ??= startChePortExposure(port, readMode)
    }
  }
}
