import { describe, expect, it } from 'vitest'
import {
  cheBrowserResponseHeaders,
  cheUpstreamRequestHeaders,
  rewriteChePortLocation,
  rewriteChePortSetCookie
} from './che-port-proxy-headers'

const ORIGIN = 'https://che.example.com'
const PREFIX = '/user/ws/6768/__orca/port/5173'
const target = { publicOrigin: ORIGIN, publicPrefix: PREFIX, port: 5173 }

describe('rewriteChePortLocation', () => {
  it("maps the app's own localhost and root paths under its public prefix", () => {
    expect(rewriteChePortLocation('http://localhost:5173/login?next=%2F', target)).toBe(
      `${ORIGIN}${PREFIX}/login?next=%2F`
    )
    expect(rewriteChePortLocation('http://127.0.0.1:5173/', target)).toBe(`${ORIGIN}${PREFIX}/`)
    expect(rewriteChePortLocation('/dashboard', target)).toBe(`${PREFIX}/dashboard`)
  })

  it('leaves redirects to an already public path (an app with a base path) unprefixed', () => {
    const based = { ...target, publicRoot: '/user/ws/6768/' }
    const base = '/user/ws/6768/__orca/absport/5173/'
    expect(rewriteChePortLocation(base, based)).toBe(base)
    expect(rewriteChePortLocation(`http://localhost:5173${base}x`, based)).toBe(`${ORIGIN}${base}x`)
    expect(rewriteChePortLocation('/login', based)).toBe(`${PREFIX}/login`)
  })

  it('leaves relative, other-port, other-host and protocol-relative redirects alone', () => {
    for (const location of [
      'next',
      '../up',
      'http://localhost:3000/',
      'https://accounts.example.com/auth',
      '//evil.example/x'
    ]) {
      expect(rewriteChePortLocation(location, target)).toBe(location)
    }
  })
})

describe('rewriteChePortSetCookie', () => {
  it('scopes cookies to the prefix and drops Domain', () => {
    expect(rewriteChePortSetCookie('sid=1; Path=/; Domain=localhost; HttpOnly', PREFIX)).toBe(
      `sid=1; Path=${PREFIX}/; HttpOnly`
    )
    expect(rewriteChePortSetCookie('a=b; Path=/api', PREFIX)).toBe(`a=b; Path=${PREFIX}/api`)
    expect(rewriteChePortSetCookie('a=b', PREFIX)).toBe(`a=b; Path=${PREFIX}/`)
    expect(rewriteChePortSetCookie('a=b; Domain=.example.com', '')).toBe('a=b')
    // A base-path app's own path stays; its Path=/ never reaches the whole shared Che origin.
    const root = '/user/ws/6768/'
    expect(rewriteChePortSetCookie(`a=b; Path=${PREFIX}/x`, PREFIX, root)).toBe(
      `a=b; Path=${PREFIX}/x`
    )
    expect(rewriteChePortSetCookie('a=b; Path=/', PREFIX, root)).toBe(`a=b; Path=${PREFIX}/`)
  })
})

const context = {
  ...target,
  forwardedHost: 'che.example.com',
  forwardedPrefix: PREFIX,
  upstreamHost: '127.0.0.1'
}

describe('cheUpstreamRequestHeaders', () => {
  it("never hands the user's Che session or identity to the app", () => {
    const headers = cheUpstreamRequestHeaders(
      {
        host: 'che.example.com',
        cookie: '_oauth_proxy=secret; app=1; __Host-orca-port=sig; _oauth_proxy_1=more',
        authorization: 'Bearer che-token',
        'x-forwarded-access-token': 'token',
        'x-forwarded-user': 'me',
        'x-forwarded-for': '10.0.0.1',
        origin: 'https://evil.example',
        connection: 'keep-alive',
        accept: 'text/html'
      },
      context,
      false
    )
    expect(headers).toEqual({
      host: 'localhost:5173',
      cookie: 'app=1',
      accept: 'text/html',
      origin: 'https://evil.example',
      'x-forwarded-host': 'che.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-prefix': PREFIX
    })
  })

  it("passes the app's own Basic auth and maps only its own public origin to localhost", () => {
    const headers = cheUpstreamRequestHeaders(
      { authorization: 'Basic dTpw', origin: ORIGIN, upgrade: 'websocket', connection: 'Upgrade' },
      context,
      true
    )
    expect(headers.authorization).toBe('Basic dTpw')
    expect(headers.origin).toBe('http://localhost:5173')
    expect(headers.upgrade).toBe('websocket')
  })
})

describe('cheBrowserResponseHeaders', () => {
  it('drops Orca auth cookies and shared-origin site wipes from the app', () => {
    const headers = cheBrowserResponseHeaders(
      {
        'set-cookie': ['__Host-orca-port=forged; Path=/; Secure', 'app=1; Path=/'],
        'clear-site-data': '"cookies"',
        location: '/next',
        'transfer-encoding': 'chunked'
      },
      target
    )
    expect(headers).toEqual({
      'set-cookie': [`app=1; Path=${PREFIX}/`],
      location: `${PREFIX}/next`
    })
  })
})
