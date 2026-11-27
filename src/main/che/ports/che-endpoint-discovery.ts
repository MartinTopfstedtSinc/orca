import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { KubernetesClient } from '../devworkspace-provider.mjs'

export const CHE_PORT_SLOT_ENDPOINT_PREFIX = 'orca-port-'
const ENDPOINT_URL_ATTRIBUTE = 'controller.devfile.io/endpoint-url'
const DNS_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export type CheSlotEndpoint = { name: string; targetPort: number; origin: string | null }

export type CheEndpoints = {
  /** `https://<che host>`: where the main endpoint's path routes live. */
  publicOrigin: string
  /** `/<user>/<ws>/<port>` without a trailing slash; the gateway strips it before orcad. */
  mainPathPrefix: string
  slots: CheSlotEndpoint[]
}

type Endpoint = {
  name: string
  targetPort: number
  path: string
  url: string | null
  urlRewriteSupported: boolean
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: checked to be a plain object above.
      (value as Record<string, unknown>)
    : null
}

function readEndpoints(document: unknown): Endpoint[] {
  const root = record(document)
  const template = record(record(root?.spec)?.template) ?? root
  const components = Array.isArray(template?.components) ? template.components : []
  const endpoints: Endpoint[] = []
  for (const component of components) {
    const container = record(record(component)?.container)
    for (const raw of Array.isArray(container?.endpoints) ? container.endpoints : []) {
      const endpoint = record(raw)
      const attributes = record(endpoint?.attributes)
      const targetPort = endpoint?.targetPort
      if (
        typeof endpoint?.name !== 'string' ||
        typeof targetPort !== 'number' ||
        !Number.isInteger(targetPort) ||
        targetPort < 1 ||
        targetPort > 65535
      ) {
        continue
      }
      const url = attributes?.[ENDPOINT_URL_ATTRIBUTE]
      const rewrite = attributes?.urlRewriteSupported
      endpoints.push({
        name: endpoint.name,
        targetPort,
        path: typeof endpoint.path === 'string' ? endpoint.path : '',
        url: typeof url === 'string' ? url : null,
        urlRewriteSupported: rewrite === true || rewrite === 'true'
      })
    }
  }
  return endpoints
}

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

/** Splits the main endpoint URL into the Che origin and the gateway path that leads to orcad. */
export function cheMainEndpointBase(
  endpointUrl: string,
  endpointPath: string
): { publicOrigin: string; mainPathPrefix: string } | null {
  const url = httpsUrl(endpointUrl)
  if (!url || url.search || url.hash) {
    return null
  }
  const suffix = endpointPath.replace(/\/+$/, '')
  let pathname = url.pathname.replace(/\/+$/, '')
  if (suffix && suffix !== '/') {
    if (!pathname.endsWith(suffix)) {
      return null
    }
    pathname = pathname.slice(0, -suffix.length)
  }
  if (!pathname.startsWith('/') || pathname.includes('//')) {
    return null
  }
  return { publicOrigin: url.origin, mainPathPrefix: pathname }
}

/** Only a subdomain endpoint at `/` can host an app at its own origin. */
export function cheSlotOrigin(endpointUrl: string | null): string | null {
  const url = endpointUrl ? httpsUrl(endpointUrl) : null
  return url && (url.pathname === '/' || url.pathname === '') ? url.origin : null
}

/** Reads the endpoints of a flattened DevWorkspace template. `mainPort` is orcad's own port. */
export function parseCheEndpoints(document: unknown, mainPort: number): CheEndpoints | null {
  const endpoints = readEndpoints(document)
  const main = endpoints.find(
    (endpoint) => endpoint.targetPort === mainPort && endpoint.urlRewriteSupported && endpoint.url
  )
  const base = main?.url ? cheMainEndpointBase(main.url, main.path) : null
  if (!base) {
    return null
  }
  const slots = endpoints
    .filter(
      (endpoint) =>
        endpoint.name.startsWith(CHE_PORT_SLOT_ENDPOINT_PREFIX) &&
        !endpoint.urlRewriteSupported &&
        endpoint.targetPort !== mainPort
    )
    .map((endpoint) => ({
      name: endpoint.name,
      targetPort: endpoint.targetPort,
      origin: cheSlotOrigin(endpoint.url)
    }))
    .sort((a, b) => a.targetPort - b.targetPort)
  return { ...base, slots }
}

/** The operator publishes subdomain hosts on the routing; the flattened devfile may lack them. */
export function parseRoutingSlotOrigins(routing: unknown): Map<string, string> {
  const origins = new Map<string, string>()
  const exposed = record(record(record(routing)?.status)?.exposedEndpoints)
  for (const list of Object.values(exposed ?? {})) {
    for (const raw of Array.isArray(list) ? list : []) {
      const endpoint = record(raw)
      const origin = typeof endpoint?.url === 'string' ? cheSlotOrigin(endpoint.url) : null
      if (typeof endpoint?.name === 'string' && origin) {
        origins.set(endpoint.name, origin)
      }
    }
  }
  return origins
}

async function readRoutingSlotOrigins(env: NodeJS.ProcessEnv): Promise<Map<string, string> | null> {
  const namespace = env.DEVWORKSPACE_NAMESPACE
  const id = env.DEVWORKSPACE_ID
  if (!namespace || !id || !DNS_NAME.test(namespace) || !DNS_NAME.test(id)) {
    return null
  }
  const routing = await new KubernetesClient(env).request(
    'GET',
    `/apis/controller.devfile.io/v1alpha1/namespaces/${namespace}/devworkspaceroutings/routing-${id}`,
    undefined,
    AbortSignal.timeout(10_000)
  )
  return parseRoutingSlotOrigins(routing)
}

/** Null outside Che, or when this orcad is not the workspace's main endpoint. */
export async function discoverCheEndpoints(
  mainPort: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<CheEndpoints | null> {
  const devfilePath = env.DEVWORKSPACE_FLATTENED_DEVFILE
  if (!env.DEVWORKSPACE_ID || !devfilePath) {
    return null
  }
  const endpoints = parseCheEndpoints(parseYaml(await readFile(devfilePath, 'utf8')), mainPort)
  if (!endpoints || endpoints.slots.every((slot) => slot.origin)) {
    return endpoints
  }
  try {
    const origins = await readRoutingSlotOrigins(env)
    return {
      ...endpoints,
      slots: endpoints.slots.map((slot) => ({
        ...slot,
        origin: slot.origin ?? origins?.get(slot.name) ?? null
      }))
    }
  } catch (error) {
    console.warn(
      `[che-ports] Port slots unavailable: ${error instanceof Error ? error.message : String(error)}`
    )
    return endpoints
  }
}
