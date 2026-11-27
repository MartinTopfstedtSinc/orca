import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** `__Host-` pins the cookie to the slot's own host, `/` and Secure: no sibling host can plant it. */
export const CHE_PORT_SLOT_COOKIE = '__Host-orca-port'
export const CHE_PORT_TICKET_TTL_MS = 60_000
export const CHE_PORT_COOKIE_TTL_MS = 12 * 60 * 60_000
const MAX_TICKETS = 256

type Ticket = { slot: string; generation: number; path: string; expiresAt: number }

/**
 * Subdomain routes carry no Che auth, so a slot admits only browsers that redeemed a one-time
 * ticket minted for this slot and assignment. The key lives in memory; a restart signs everyone out.
 */
export class ChePortSlotAuth {
  private readonly tickets = new Map<string, Ticket>()

  constructor(
    private readonly key: Buffer = randomBytes(32),
    private readonly now: () => number = Date.now
  ) {}

  mintTicket(slot: string, generation: number, path: string): string {
    const now = this.now()
    for (const [id, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) {
        this.tickets.delete(id)
      }
    }
    while (this.tickets.size >= MAX_TICKETS) {
      const oldest = this.tickets.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.tickets.delete(oldest)
    }
    const id = randomBytes(32).toString('base64url')
    this.tickets.set(id, { slot, generation, path, expiresAt: now + CHE_PORT_TICKET_TTL_MS })
    return id
  }

  /** One use only: a redeemed, expired or foreign ticket is gone or refused. Returns the path. */
  redeemTicket(id: string, slot: string, generation: number): string | null {
    const ticket = this.tickets.get(id)
    if (!ticket) {
      return null
    }
    this.tickets.delete(id)
    return ticket.slot === slot && ticket.generation === generation && ticket.expiresAt > this.now()
      ? ticket.path
      : null
  }

  private sign(slot: string, generation: number, expiresAt: number): string {
    return createHmac('sha256', this.key)
      .update(`${slot}\n${generation}\n${expiresAt}`)
      .digest('base64url')
  }

  cookieValue(slot: string, generation: number): string {
    const expiresAt = this.now() + CHE_PORT_COOKIE_TTL_MS
    return `${generation}.${expiresAt}.${this.sign(slot, generation, expiresAt)}`
  }

  /** Valid only for this slot's current assignment and before its expiry. */
  verifyCookie(value: string | undefined, slot: string, generation: number): boolean {
    const match = value ? /^(\d{1,12})\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(value) : null
    if (!match || Number(match[1]) !== generation || Number(match[2]) <= this.now()) {
      return false
    }
    const expected = Buffer.from(this.sign(slot, generation, Number(match[2])))
    const actual = Buffer.from(match[3]!)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  setCookieHeader(slot: string, generation: number): string {
    return `${CHE_PORT_SLOT_COOKIE}=${this.cookieValue(slot, generation)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${CHE_PORT_COOKIE_TTL_MS / 1000}`
  }
}

/** The named cookie from a Cookie header; the last one wins, as browsers send the most specific last. */
export function readRequestCookie(header: string | undefined, name: string): string | undefined {
  let value: string | undefined
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      value = part.slice(eq + 1).trim()
    }
  }
  return value
}

/** Expires every cookie the browser sent, so the previous app on this host leaves none behind. */
export function expireRequestCookies(header: string | undefined): string[] {
  const names = new Set<string>()
  for (const part of header?.split(';') ?? []) {
    const name = part.split('=')[0]?.trim()
    if (name && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) && name !== CHE_PORT_SLOT_COOKIE) {
      names.add(name)
    }
  }
  return [...names].map((name) => `${name}=; Path=/; Max-Age=0; Secure`)
}
