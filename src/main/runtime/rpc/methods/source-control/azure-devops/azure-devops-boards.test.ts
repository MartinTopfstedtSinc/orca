import { describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  isAuthenticated: vi.fn(async () => true),
  listTeams: vi.fn(async () => []),
  getConfiguration: vi.fn(),
  loadBacklog: vi.fn(),
  loadBoard: vi.fn(),
  loadAssignedWorkItems: vi.fn(),
  getWorkItem: vi.fn(async () => null)
}))

vi.mock('../../../../../azure-devops/boards/boards-service', () => ({
  createAzureDevOpsBoardsService: () => service
}))

const { AZURE_DEVOPS_BOARDS_METHODS } = await import('./azure-devops-boards')
const { ALL_RPC_METHODS } = await import('../../rpc-method-registry')

const repos = [{ id: 'repo-1', path: '/projects/app' }]
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers read only runtime.listRepos, and only id and path of each repo.
const context = { runtime: { listRepos: () => repos } } as never

function method(name: string) {
  const found = AZURE_DEVOPS_BOARDS_METHODS.find((entry) => entry.name === name)
  if (!found) {
    throw new Error(name)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: calls the handler with raw params, as the dispatcher does after parsing them.
  return found as unknown as { handler: (params: unknown, ctx: never) => Promise<unknown> }
}

describe('azureDevOpsBoards RPC methods', () => {
  it('are registered, so the web client can reach them', () => {
    const names = new Set(ALL_RPC_METHODS.map((entry) => entry.name))
    for (const entry of AZURE_DEVOPS_BOARDS_METHODS) {
      expect(names.has(entry.name)).toBe(true)
    }
  })

  it('read a registered project by path, as a local repo', async () => {
    await method('azureDevOpsBoards.listTeams').handler(
      { repoPath: '/projects/app/', connectionId: 'desktop-ssh' },
      context
    )
    expect(service.listTeams).toHaveBeenCalledWith({
      repoPath: '/projects/app',
      repoId: 'repo-1',
      connectionId: null
    })
  })

  it('keep the rest of the request', async () => {
    await method('azureDevOpsBoards.getWorkItem').handler(
      { repoPath: '/projects/app', repoId: 'repo-1', id: 7, cachedIds: [1] },
      context
    )
    expect(service.getWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, cachedIds: [1], repoPath: '/projects/app' })
    )
  })

  it('refuse a path that is not a registered project', async () => {
    await expect(
      method('azureDevOpsBoards.isAuthenticated').handler({ repoPath: '/etc' }, context)
    ).rejects.toThrow('Unknown project.')
    await expect(
      method('azureDevOpsBoards.isAuthenticated').handler(
        { repoPath: '/etc', repoId: 'repo-1' },
        context
      )
    ).rejects.toThrow('Unknown project.')
    expect(service.isAuthenticated).not.toHaveBeenCalled()
  })
})
