import { readdir, readFile, readlink } from 'node:fs/promises'
import { parseProcNetTcp } from '../../ports/linux-proc-net-listeners'

/** Strips its prefix: for apps that use relative URLs. */
export const CHE_PORT_PATH_PREFIX = '/__orca/port/'
/** Keeps the full public path: for apps configured with it as their base path. */
export const CHE_PORT_ABSOLUTE_PATH_PREFIX = '/__orca/absport/'

export type ChePortPathRequest =
  | { kind: 'proxy'; port: number; path: string; absolute: boolean }
  | { kind: 'redirect'; port: number; absolute: boolean }
  | { kind: 'invalid' }

/** Parses `/__orca/port/<n>/<rest>` and `/__orca/absport/<n>/<rest>`; null for any other URL. */
export function parseChePortPath(rawUrl: string | undefined): ChePortPathRequest | null {
  const routePrefix = [CHE_PORT_PATH_PREFIX, CHE_PORT_ABSOLUTE_PATH_PREFIX].find((prefix) =>
    rawUrl?.startsWith(prefix.slice(0, -1))
  )
  if (!rawUrl || !routePrefix) {
    return null
  }
  const absolute = routePrefix === CHE_PORT_ABSOLUTE_PATH_PREFIX
  const queryAt = rawUrl.search(/[?#]/)
  const pathname = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt)
  const query = queryAt === -1 ? '' : rawUrl.slice(queryAt).replace(/#.*$/, '')
  if (pathname === routePrefix.slice(0, -1)) {
    return { kind: 'invalid' }
  }
  if (!pathname.startsWith(routePrefix)) {
    return null
  }
  const rest = pathname.slice(routePrefix.length)
  const match = /^([1-9]\d{0,4})(\/.*)?$/.exec(rest)
  const port = match ? Number(match[1]) : 0
  if (!match || port > 65535) {
    return { kind: 'invalid' }
  }
  if (match[2] === undefined) {
    return { kind: 'redirect', port, absolute }
  }
  return isTraversalFree(match[2])
    ? { kind: 'proxy', port, path: match[2] + query, absolute }
    : { kind: 'invalid' }
}

// Dot segments would let a proxy or the app resolve outside this port's prefix.
function isTraversalFree(path: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return false
  }
  return (
    !decoded.includes('\\') &&
    !decoded.split('/').some((segment) => segment === '..' || segment === '.')
  )
}

export type ChePortTargetRefusal = 'not_listening' | 'orca_listener'
export type ChePortTarget = { host: '127.0.0.1' | '::1'; port: number }

type ProcSource = {
  readNetTcp: () => Promise<string[]>
  readOwnSocketInodes: () => Promise<Set<number>>
  uid: number | undefined
}

const procSource: ProcSource = {
  readNetTcp: () =>
    Promise.all(
      ['/proc/net/tcp', '/proc/net/tcp6'].map((path) => readFile(path, 'utf8').catch(() => ''))
    ),
  readOwnSocketInodes: async () => {
    const inodes = new Set<number>()
    const fds = await readdir('/proc/self/fd').catch((): string[] => [])
    await Promise.all(
      fds.map(async (fd) => {
        const link = await readlink(`/proc/self/fd/${fd}`).catch(() => '')
        const match = /^socket:\[(\d+)\]$/.exec(link)
        if (match) {
          inodes.add(Number(match[1]))
        }
      })
    )
    return inodes
  },
  uid: process.getuid?.()
}

const LOOPBACK_V4 = new Set(['127.0.0.1', '0.0.0.0'])
const LOOPBACK_V6 = new Set(['::1', '::'])

/** The loopback address a user's listener answers on. Orca's own sockets are never targets. */
export async function resolveChePortTarget(
  port: number,
  source: ProcSource = procSource
): Promise<ChePortTarget | ChePortTargetRefusal> {
  const [tables, ownInodes] = await Promise.all([source.readNetTcp(), source.readOwnSocketInodes()])
  const listeners = tables.flatMap((table) => parseProcNetTcp(table, source.uid))
  const matching = listeners.filter((listener) => listener.port === port)
  if (matching.some((listener) => ownInodes.has(listener.inode))) {
    return 'orca_listener'
  }
  if (matching.some((listener) => LOOPBACK_V4.has(listener.host))) {
    return { host: '127.0.0.1', port }
  }
  if (matching.some((listener) => LOOPBACK_V6.has(listener.host))) {
    return { host: '::1', port }
  }
  return 'not_listening'
}
