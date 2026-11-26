import { describe, expect, it } from 'vitest'
import { buildExecutionHostRegistry } from './execution-host-registry'

describe('agent environment hosts', () => {
  it('labels managed runtimes as agent environments without changing their identity', () => {
    const hosts = buildExecutionHostRegistry({
      repos: [{ connectionId: null, executionHostId: 'runtime:agent-1' }],
      settings: null,
      runtimeEnvironments: [
        { id: 'agent-1', name: 'My agent', source: 'ephemeral-vm' },
        { id: 'server-1', name: 'dev box', source: 'manual' }
      ]
    })
    expect(hosts.find((host) => host.id === 'runtime:agent-1')).toMatchObject({
      kind: 'runtime',
      label: 'My agent',
      detail: 'Agent environment'
    })
    expect(hosts.find((host) => host.id === 'runtime:server-1')).toMatchObject({
      label: 'dev box',
      detail: 'Orca server'
    })
  })
})
