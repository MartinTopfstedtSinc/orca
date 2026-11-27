import { describe, expect, it } from 'vitest'
import {
  CHE_PORT_COOKIE_TTL_MS,
  CHE_PORT_SLOT_COOKIE,
  CHE_PORT_TICKET_TTL_MS,
  ChePortSlotAuth,
  expireRequestCookies,
  readRequestCookie
} from './che-port-slot-auth'

function clock(): { now: () => number; advance: (ms: number) => void } {
  let time = 1_000_000
  return { now: () => time, advance: (ms) => (time += ms) }
}

describe('ChePortSlotAuth', () => {
  it('admits a cookie only for its slot, its assignment and until it expires', () => {
    const time = clock()
    const auth = new ChePortSlotAuth(Buffer.alloc(32, 7), time.now)
    const cookie = auth.cookieValue('orca-port-1', 3)
    expect(auth.verifyCookie(cookie, 'orca-port-1', 3)).toBe(true)
    expect(auth.verifyCookie(cookie, 'orca-port-1', 4)).toBe(false)
    expect(auth.verifyCookie(cookie, 'orca-port-2', 3)).toBe(false)
    expect(
      new ChePortSlotAuth(Buffer.alloc(32, 8), time.now).verifyCookie(cookie, 'orca-port-1', 3)
    ).toBe(false)
    const [generation, expiry, signature] = cookie.split('.')
    expect(
      auth.verifyCookie(`${generation}.${Number(expiry) + 1}.${signature}`, 'orca-port-1', 3)
    ).toBe(false)
    const tampered = `${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`
    expect(auth.verifyCookie(`${generation}.${expiry}.${tampered}`, 'orca-port-1', 3)).toBe(false)
    expect(auth.verifyCookie(undefined, 'orca-port-1', 3)).toBe(false)
    time.advance(CHE_PORT_COOKIE_TTL_MS)
    expect(auth.verifyCookie(cookie, 'orca-port-1', 3)).toBe(false)
  })

  it('redeems a ticket once, for its own slot and assignment, before it expires', () => {
    const time = clock()
    const auth = new ChePortSlotAuth(Buffer.alloc(32, 7), time.now)
    const ticket = auth.mintTicket('orca-port-1', 2, '/app?x=1')
    expect(auth.redeemTicket(ticket, 'orca-port-1', 2)).toBe('/app?x=1')
    expect(auth.redeemTicket(ticket, 'orca-port-1', 2)).toBeNull()

    const reassigned = auth.mintTicket('orca-port-1', 2, '/')
    expect(auth.redeemTicket(reassigned, 'orca-port-1', 3)).toBeNull()
    expect(auth.redeemTicket(reassigned, 'orca-port-1', 2)).toBeNull()

    const foreign = auth.mintTicket('orca-port-2', 1, '/')
    expect(auth.redeemTicket(foreign, 'orca-port-1', 1)).toBeNull()

    const late = auth.mintTicket('orca-port-1', 2, '/')
    time.advance(CHE_PORT_TICKET_TTL_MS)
    expect(auth.redeemTicket(late, 'orca-port-1', 2)).toBeNull()
  })
})

describe('slot cookies on the request', () => {
  it('reads the auth cookie and expires every other cookie the browser sent', () => {
    const header = `app=1; ${CHE_PORT_SLOT_COOKIE}=sig; __Secure-x=2; bad name=3`
    expect(readRequestCookie(header, CHE_PORT_SLOT_COOKIE)).toBe('sig')
    expect(expireRequestCookies(header)).toEqual([
      'app=; Path=/; Max-Age=0; Secure',
      '__Secure-x=; Path=/; Max-Age=0; Secure'
    ])
  })
})
