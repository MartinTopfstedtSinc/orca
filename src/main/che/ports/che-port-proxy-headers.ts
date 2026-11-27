import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

// Hop-by-hop headers belong to one connection; node sets its own for the upstream leg.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

// Identity the Che gateway adds after forwardAuth; a dev app must never see the user's Che session.
const CHE_IDENTITY_HEADERS = new Set([
  'x-forwarded-access-token',
  'x-forwarded-user',
  'x-forwarded-email',
  'x-forwarded-preferred-username',
  'x-forwarded-groups',
  'x-auth-request-access-token',
  'x-auth-request-user',
  'x-auth-request-email',
  'gap-auth'
])

export type ChePortPublicLocation = {
  /** `https://<host>` the browser sees. */
  publicOrigin: string
  /** Path the browser sees in front of the app's own paths; empty for an app at `/`. */
  publicPrefix: string
  /** Paths under this are already public (an app configured with its base path); never prefixed. */
  publicRoot?: string
  port: number
}

/** Maps a redirect the app aimed at its own localhost URL, or its own root, onto the public URL. */
export function rewriteChePortLocation(location: string, target: ChePortPublicLocation): string {
  const alreadyPublic = (path: string): boolean =>
    target.publicRoot !== undefined && path.startsWith(target.publicRoot)
  if (location.startsWith('/') && !location.startsWith('//')) {
    return alreadyPublic(location) ? location : target.publicPrefix + location
  }
  let url: URL
  try {
    url = new URL(location)
  } catch {
    return location
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    port !== target.port
  ) {
    return location
  }
  const prefix = alreadyPublic(url.pathname) ? '' : target.publicPrefix
  return `${target.publicOrigin}${prefix}${url.pathname}${url.search}${url.hash}`
}

/** Scopes an app's cookie to its public prefix; `Domain` would leak it to sibling hosts. */
export function rewriteChePortSetCookie(
  cookie: string,
  publicPrefix: string,
  publicRoot?: string
): string {
  const [pair = '', ...attributes] = cookie.split(';')
  let hasPath = false
  const kept: string[] = []
  for (const attribute of attributes) {
    const name = attribute.split('=')[0]?.trim().toLowerCase()
    if (name === 'domain') {
      continue
    }
    if (name === 'path') {
      hasPath = true
      const value = attribute.slice(attribute.indexOf('=') + 1).trim()
      const path = value.startsWith('/') ? value : `/${value}`
      kept.push(
        ` Path=${publicRoot !== undefined && path.startsWith(publicRoot) ? '' : publicPrefix}${path}`
      )
      continue
    }
    kept.push(attribute)
  }
  if (!hasPath && publicPrefix) {
    kept.push(` Path=${publicPrefix}/`)
  }
  return [pair, ...kept].join(';')
}

/** Drops cookies the app must not receive: Che's session and Orca's slot auth. */
export function filterChePortRequestCookies(
  cookieHeader: string | undefined,
  isBlocked: (name: string) => boolean
): string | undefined {
  if (!cookieHeader) {
    return undefined
  }
  const kept = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !isBlocked(part.split('=')[0]?.trim() ?? ''))
  return kept.length > 0 ? kept.join('; ') : undefined
}

export const isCheSessionCookie = (name: string): boolean =>
  name.startsWith('_oauth_proxy') || name.startsWith('__Host-orca-port')

export type ChePortForwardContext = ChePortPublicLocation & {
  forwardedHost: string
  /** Value of X-Forwarded-Prefix: where the app is mounted publicly. */
  forwardedPrefix: string
  upstreamHost: string
}

/** Request headers for the upstream app: its own Host, so dev-server host checks pass. */
export function cheUpstreamRequestHeaders(
  headers: IncomingHttpHeaders,
  context: ChePortForwardContext,
  keepUpgrade: boolean
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || CHE_IDENTITY_HEADERS.has(name) || name.startsWith('x-forwarded-')) {
      continue
    }
    if (HOP_BY_HOP.has(name) && !(keepUpgrade && (name === 'connection' || name === 'upgrade'))) {
      continue
    }
    if (name === 'authorization' && typeof value === 'string' && /^bearer\s/i.test(value)) {
      continue
    }
    if (name === 'cookie') {
      const cookie = filterChePortRequestCookies(
        Array.isArray(value) ? value.join('; ') : value,
        isCheSessionCookie
      )
      if (cookie) {
        out.cookie = cookie
      }
      continue
    }
    out[name] = value
  }
  const hostPort = context.upstreamHost === '::1' ? `[::1]` : 'localhost'
  out.host = `${hostPort}:${context.port}`
  out['x-forwarded-host'] = context.forwardedHost
  out['x-forwarded-proto'] = 'https'
  if (context.forwardedPrefix) {
    out['x-forwarded-prefix'] = context.forwardedPrefix
  }
  // Dev servers compare Origin with Host; only the app's own public origin passes as its localhost.
  if (headers.origin === context.publicOrigin) {
    out.origin = `http://${out.host}`
  }
  return out
}

/** Response headers for the browser, with redirects and cookies kept under the public URL. */
export function cheBrowserResponseHeaders(
  headers: IncomingHttpHeaders,
  location: ChePortPublicLocation
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name)) {
      continue
    }
    // Che's origin is shared, and "cookies" clears a slot host's whole registrable domain.
    if (name === 'clear-site-data') {
      continue
    }
    if (name === 'location' && typeof value === 'string') {
      out.location = rewriteChePortLocation(value, location)
      continue
    }
    if (name === 'set-cookie') {
      const cookies = Array.isArray(value) ? value : [String(value)]
      out['set-cookie'] = cookies
        .filter((cookie) => !isCheSessionCookie(cookie.split('=')[0]?.trim() ?? ''))
        .map((cookie) =>
          rewriteChePortSetCookie(cookie, location.publicPrefix, location.publicRoot)
        )
      continue
    }
    out[name] = value
  }
  return out
}
