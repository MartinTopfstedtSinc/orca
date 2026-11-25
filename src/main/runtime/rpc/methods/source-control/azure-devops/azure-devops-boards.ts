import { resolve } from 'node:path'
import { defineMethod, InvalidArgumentError } from '../../../core'
import type { AzureDevOpsBoardsRepoArgs } from '../../../../../../shared/azure-devops/boards-repo-resolution'
import {
  AzureDevOpsBoardsBacklog,
  AzureDevOpsBoardsBoard,
  AzureDevOpsBoardsRepo,
  AzureDevOpsBoardsTeam,
  AzureDevOpsBoardsWorkItem
} from '../../../../../../shared/rpc-contract/source-control/azure-devops-boards-params'
import type { Repo } from '../../../../../../shared/repository/repo-types'
import { createAzureDevOpsBoardsService } from '../../../../../azure-devops/boards/boards-service'

// Why: the web client talks to the runtime that owns the project, so the runtime reads the
// remote itself. Remote-runtime and WSL routing belong to the desktop and never apply here.
const service = createAzureDevOpsBoardsService(() => ({}))

// Read only registered projects, so a client cannot point the git probe at any directory.
function registeredRepoArgs<T extends AzureDevOpsBoardsRepoArgs>(
  repos: readonly Repo[],
  args: T
): T {
  const repoPath = resolve(args.repoPath)
  const repo =
    (args.repoId ? repos.find((entry) => entry.id === args.repoId) : undefined) ??
    repos.find((entry) => resolve(entry.path) === repoPath)
  if (!repo || resolve(repo.path) !== repoPath) {
    throw new InvalidArgumentError('Unknown project.')
  }
  return { ...args, repoPath: repo.path, repoId: repo.id, connectionId: null }
}

export const AZURE_DEVOPS_BOARDS_METHODS = [
  defineMethod({
    name: 'azureDevOpsBoards.isAuthenticated',
    permission: 'workspace',
    params: AzureDevOpsBoardsRepo,
    handler: async (params, { runtime }) =>
      service.isAuthenticated(registeredRepoArgs(runtime.listRepos(), params))
  }),
  defineMethod({
    name: 'azureDevOpsBoards.listTeams',
    permission: 'workspace',
    params: AzureDevOpsBoardsRepo,
    handler: async (params, { runtime }) =>
      service.listTeams(registeredRepoArgs(runtime.listRepos(), params))
  }),
  defineMethod({
    name: 'azureDevOpsBoards.getConfiguration',
    permission: 'workspace',
    params: AzureDevOpsBoardsTeam,
    handler: async (params, { runtime }) =>
      service.getConfiguration(registeredRepoArgs(runtime.listRepos(), params))
  }),
  defineMethod({
    name: 'azureDevOpsBoards.loadBacklog',
    permission: 'workspace',
    params: AzureDevOpsBoardsBacklog,
    handler: async (params, { runtime }) =>
      service.loadBacklog(registeredRepoArgs(runtime.listRepos(), params))
  }),
  defineMethod({
    name: 'azureDevOpsBoards.loadBoard',
    permission: 'workspace',
    params: AzureDevOpsBoardsBoard,
    handler: async (params, { runtime }) =>
      service.loadBoard(registeredRepoArgs(runtime.listRepos(), params))
  }),
  defineMethod({
    name: 'azureDevOpsBoards.loadAssignedWorkItems',
    permission: 'workspace',
    params: AzureDevOpsBoardsRepo,
    handler: async (params, { runtime }) =>
      service.loadAssignedWorkItems(registeredRepoArgs(runtime.listRepos(), params))
  }),
  defineMethod({
    name: 'azureDevOpsBoards.getWorkItem',
    permission: 'workspace',
    params: AzureDevOpsBoardsWorkItem,
    handler: async (params, { runtime }) =>
      service.getWorkItem(registeredRepoArgs(runtime.listRepos(), params))
  })
]
