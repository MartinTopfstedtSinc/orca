import { beforeEach, describe, expect, it, vi } from 'vitest'

const provision = vi.hoisted(() => vi.fn())
const cleanup = vi.hoisted(() => vi.fn(async (row: unknown) => row))
const update = vi.hoisted(() => vi.fn())

vi.mock('./che-workspace-provision', () => ({ provisionCheWorkspace: provision }))
vi.mock('./che-workspace-records', () => ({
  cleanup,
  update,
  find: (id: string) => ({ id }),
  exclusive: (_id: string, operation: () => Promise<unknown>) => operation()
}))

import { placeOnAgentWorkspace, remoteServer } from './che-worker-start'

const repo = { id: 'repo-1', path: '/projects/app', displayName: 'app' }
const runtime = (remoteWorktreeId = 'remote-wt') => ({
  listRepos: () => [repo, { id: 'repo-2', path: '/projects/other', displayName: 'other' }],
  getOrchestrationDb: () => ({
    getFederatedDispatch: (id: string) =>
      id === 'dispatch-1' ? { remote_worktree_id: remoteWorktreeId } : undefined
  })
})
const params = {
  from: 'term_1',
  spec: 'Fix it',
  on: 'agent-workspace',
  worktree: 'new-child',
  repo: 'app',
  name: 'fix-it',
  agent: 'claude'
}

describe('worker-start --on agent-workspace', () => {
  beforeEach(() => {
    provision.mockReset()
    cleanup.mockClear()
    update.mockClear()
    provision.mockResolvedValue({
      ok: true,
      runtime: { id: 'runtime-1' },
      environment: { id: 'env-1' }
    })
  })

  it('passes every other start through untouched', async () => {
    const start = vi.fn(async (_params: unknown) => 'started')
    const other = { ...params, on: 'devbox' }
    await expect(placeOnAgentWorkspace(runtime() as never, other, start)).resolves.toBe('started')
    expect(start).toHaveBeenCalledWith(other)
    expect(provision).not.toHaveBeenCalled()
    expect(remoteServer(other)).toBe('devbox')
    expect(remoteServer(params)).toBeUndefined()
  })

  it('starts the worker on the new workspace and records it as its owner', async () => {
    const start = vi.fn(async (_params: unknown) => ({ state: 'ready', dispatchId: 'dispatch-1' }))
    await placeOnAgentWorkspace(runtime() as never, params, start)
    expect(provision).toHaveBeenCalledWith(repo, { repoId: 'repo-1', workspaceName: 'fix-it' })
    expect(start).toHaveBeenCalledWith({
      ...params,
      on: 'env-1',
      worktree: 'new-child',
      repo: 'path:/projects/source'
    })
    expect(update).toHaveBeenCalledWith('runtime-1', { workspaceId: 'remote-wt' })
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('finds the project by id, path or name', async () => {
    for (const selector of ['id:repo-1', 'path:/projects/app', 'name:app', '/projects/app']) {
      provision.mockClear()
      await placeOnAgentWorkspace(
        runtime() as never,
        { ...params, repo: selector },
        async () => null
      )
      expect(provision.mock.calls[0]?.[0]).toBe(repo)
    }
  })

  it('defaults to a new top-level workspace', async () => {
    const start = vi.fn(async (_params: unknown) => ({ state: 'ready', dispatchId: 'dispatch-1' }))
    await placeOnAgentWorkspace(runtime() as never, { ...params, worktree: undefined }, start)
    expect(start.mock.calls[0][0]).toMatchObject({ worktree: 'new-top-level' })
  })

  it('removes the workspace when the start fails or throws', async () => {
    await placeOnAgentWorkspace(runtime() as never, params, async () => ({ state: 'failed' }))
    expect(cleanup).toHaveBeenCalledTimes(1)
    await expect(
      placeOnAgentWorkspace(runtime() as never, params, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('keeps the workspace while the outcome is unknown', async () => {
    await placeOnAgentWorkspace(runtime() as never, params, async () => ({
      state: 'outcome_unknown',
      dispatchId: 'dispatch-1'
    }))
    expect(cleanup).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses before creating anything', async () => {
    const start = vi.fn()
    for (const bad of [
      { ...params, worktree: 'current' },
      { ...params, repo: undefined },
      { ...params, terminal: 'term_2', agent: undefined },
      { ...params, repo: 'missing' }
    ]) {
      await expect(placeOnAgentWorkspace(runtime() as never, bad, start)).rejects.toMatchObject({
        code: 'invalid_argument'
      })
    }
    expect(provision).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('reports a workspace that could not be created', async () => {
    provision.mockResolvedValue({ ok: false, error: 'Quota exceeded.' })
    const start = vi.fn()
    await expect(placeOnAgentWorkspace(runtime() as never, params, start)).rejects.toMatchObject({
      code: 'host_unavailable',
      message: expect.stringContaining('Quota exceeded.')
    })
    expect(start).not.toHaveBeenCalled()
  })
})
