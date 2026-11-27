import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentWorkspaceBotRules } from './che-bot-rules'

describe('agent workspace bot rules', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('tells bots nothing where agent workspaces are not set up', () => {
    vi.stubEnv('ORCA_AGENT_NAMESPACE', '')
    expect(agentWorkspaceBotRules('orca')).toEqual([])
    vi.stubEnv('ORCA_AGENT_NAMESPACE', 'Not A Namespace')
    expect(agentWorkspaceBotRules('orca')).toEqual([])
  })

  it('tells bots to start workers in agent workspaces where they are', () => {
    vi.stubEnv('ORCA_AGENT_NAMESPACE', 'user-agents')
    vi.stubEnv('DEVWORKSPACE_NAMESPACE', 'user-che')
    vi.stubEnv('DEVWORKSPACE_NAME', 'orcas')
    const [rule] = agentWorkspaceBotRules('orca')
    expect(rule).toContain('`--on agent-workspace`')
    expect(rule).toContain('`orca orchestration worker-start`')
  })
})
