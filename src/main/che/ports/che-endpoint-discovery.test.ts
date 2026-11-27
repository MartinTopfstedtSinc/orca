import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  cheMainEndpointBase,
  parseCheEndpoints,
  parseRoutingSlotOrigins
} from './che-endpoint-discovery'

// Shaped like /devworkspace-metadata/flattened.devworkspace.yaml in an Orca Che workspace.
const FLATTENED = `
components:
- name: orca-runtime
  container:
    endpoints:
    - attributes:
        controller.devfile.io/endpoint-url: https://che.example.com/me/orcas/6768/web-index.html
        cookiesAuthEnabled: true
        type: main
        urlRewriteSupported: true
      exposure: public
      name: orca
      path: /web-index.html
      protocol: https
      targetPort: 6768
    - attributes:
        controller.devfile.io/endpoint-url: https://ws1-orca-port-2.apps.example.com/
        urlRewriteSupported: false
      name: orca-port-2
      targetPort: 6772
    - attributes:
        urlRewriteSupported: false
      name: orca-port-1
      targetPort: 6771
    - attributes:
        urlRewriteSupported: true
      name: orca-port-3
      targetPort: 6773
- name: tools
  container:
    endpoints:
    - name: http-8080
      targetPort: 8080
`

describe('parseCheEndpoints', () => {
  it('derives the gateway path to orcad and the subdomain slots', () => {
    expect(parseCheEndpoints(parseYaml(FLATTENED), 6768)).toEqual({
      publicOrigin: 'https://che.example.com',
      mainPathPrefix: '/me/orcas/6768',
      slots: [
        { name: 'orca-port-1', targetPort: 6771, origin: null },
        {
          name: 'orca-port-2',
          targetPort: 6772,
          origin: 'https://ws1-orca-port-2.apps.example.com'
        }
      ]
    })
  })

  it('is null when this orcad is not the main endpoint', () => {
    expect(parseCheEndpoints(parseYaml(FLATTENED), 7000)).toBeNull()
    expect(parseCheEndpoints({ spec: { template: {} } }, 6768)).toBeNull()
  })

  it('accepts only https endpoint URLs whose path ends in the endpoint path', () => {
    expect(cheMainEndpointBase('https://che.example.com/me/ws/6768/', '')).toEqual({
      publicOrigin: 'https://che.example.com',
      mainPathPrefix: '/me/ws/6768'
    })
    expect(cheMainEndpointBase('http://che.example.com/me/ws/6768/', '')).toBeNull()
    expect(cheMainEndpointBase('https://u:p@che.example.com/me/', '')).toBeNull()
    expect(
      cheMainEndpointBase('https://che.example.com/me/ws/6768/x', '/web-index.html')
    ).toBeNull()
  })
})

describe('parseRoutingSlotOrigins', () => {
  it('reads subdomain origins from the routing status, ignoring path endpoints', () => {
    const origins = parseRoutingSlotOrigins({
      status: {
        exposedEndpoints: {
          'orca-runtime': [
            { name: 'orca', url: 'https://che.example.com/me/orcas/6768/' },
            { name: 'orca-port-1', url: 'https://ws1-orca-port-1.apps.example.com/' },
            { name: 'orca-port-9', url: 'http://plain.example.com/' }
          ]
        }
      }
    })
    expect([...origins]).toEqual([['orca-port-1', 'https://ws1-orca-port-1.apps.example.com']])
  })
})
