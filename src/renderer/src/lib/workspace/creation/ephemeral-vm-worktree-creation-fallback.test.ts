import { beforeEach, expect, it, vi } from 'vitest'
import type { WorktreeCreationRequest } from './pending-worktree-creation'

const { prepareTargetMock, store } = vi.hoisted(() => ({
  prepareTargetMock: vi.fn(),
  store: {
    repos: [],
    pendingWorktreeCreations: { 'creation-1': { provisioningLog: '' } },
    activePendingCreationId: 'creation-1',
    updatePendingWorktreeCreation: vi.fn()
  }
}))

vi.mock('@/store/index', () => ({ useAppStore: { getState: () => store } }))
vi.mock('@/runtime/ephemeral-vm/ephemeral-vm-workspace-target', () => ({
  prepareEphemeralVmWorkspaceTarget: prepareTargetMock
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }))

import { prepareRequestForCreate } from './ephemeral-vm-worktree-creation'

const request = {
  repoId: 'repo-1',
  name: 'feature',
  setupDecision: 'inherit',
  ephemeralVmRecipe: {
    sourceRepoId: 'repo-1',
    recipeId: 'che-devworkspace',
    projectId: 'github:example/repo'
  }
} as WorktreeCreationRequest

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { api: { ephemeralVm: { onProvisionEvent: () => () => {} } } })
})

it('creates the workspace on the source host when no environment could be created', async () => {
  prepareTargetMock.mockResolvedValue({
    ok: false,
    fallback: true,
    error: 'This workspace cannot create devworkspaces.',
    stderr: ''
  })

  const prepared = await prepareRequestForCreate('creation-1', request)

  expect(prepared).toMatchObject({ repoId: 'repo-1', name: 'feature' })
  expect(prepared?.ephemeralVmRecipe).toBeUndefined()
  expect(store.updatePendingWorktreeCreation).not.toHaveBeenCalledWith(
    'creation-1',
    expect.objectContaining({ status: 'error' })
  )
})

it('keeps the error when the environment failed after it started', async () => {
  prepareTargetMock.mockResolvedValue({ ok: false, error: 'Timed out.', stderr: '' })

  const prepared = await prepareRequestForCreate('creation-1', request)

  expect(prepared).toBeNull()
  expect(store.updatePendingWorktreeCreation).toHaveBeenCalledWith('creation-1', {
    status: 'error',
    error: 'Timed out.'
  })
})
