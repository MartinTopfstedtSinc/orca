import { describe, expect, it } from 'vitest'
import { parseChePortPath, resolveChePortTarget } from './che-port-proxy-target'

describe('parseChePortPath', () => {
  it('routes only well-formed port paths and keeps the query', () => {
    expect(parseChePortPath('/web-index.html')).toBeNull()
    expect(parseChePortPath('/__orca/portal')).toBeNull()
    expect(parseChePortPath('/__orca/port/5173/src/main.ts?t=1')).toEqual({
      kind: 'proxy',
      port: 5173,
      path: '/src/main.ts?t=1'
    })
    expect(parseChePortPath('/__orca/port/5173')).toEqual({ kind: 'redirect', port: 5173 })
  })

  it('refuses ports out of range and dot segments, encoded or not', () => {
    for (const url of [
      '/__orca/port',
      '/__orca/port/',
      '/__orca/port/0/',
      '/__orca/port/65536/',
      '/__orca/port/05173/',
      '/__orca/port/abc/',
      '/__orca/port/5173%2f..%2f6768/',
      '/__orca/port/5173/../../6768/',
      '/__orca/port/5173/%2e%2e/6768',
      '/__orca/port/5173/a/%2E/b',
      '/__orca/port/5173/..%5c6768',
      '/__orca/port/5173/%zz'
    ]) {
      expect(parseChePortPath(url), url).toEqual({ kind: 'invalid' })
    }
  })
})

// uid 1000 listens on 127.0.0.1:5173 (inode 11), [::1]:3000 (12), 0.0.0.0:8000 (13) and orcad's 6768 (14).
const TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 11 1 0 100 0 0 10 0
   1: 00000000:1F40 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 13 1 0 100 0 0 10 0
   2: 0100007F:1A70 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 14 1 0 100 0 0 10 0
`
const TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12 1 0 100 0 0 10 0
`
const source = {
  readNetTcp: async () => [TCP, TCP6],
  readOwnSocketInodes: async () => new Set([14]),
  uid: 1000
}

describe('resolveChePortTarget', () => {
  it("dials the loopback a user's listener answers on", async () => {
    await expect(resolveChePortTarget(5173, source)).resolves.toEqual({
      host: '127.0.0.1',
      port: 5173
    })
    await expect(resolveChePortTarget(8000, source)).resolves.toEqual({
      host: '127.0.0.1',
      port: 8000
    })
    await expect(resolveChePortTarget(3000, source)).resolves.toEqual({ host: '::1', port: 3000 })
  })

  it("refuses Orca's own listeners and ports nothing listens on", async () => {
    await expect(resolveChePortTarget(6768, source)).resolves.toBe('orca_listener')
    await expect(resolveChePortTarget(9999, source)).resolves.toBe('not_listening')
  })
})
