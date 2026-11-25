import { resolve } from 'node:path'
import { ipcMain } from 'electron'
import type { AzureDevOpsBoardsRepoArgs } from '../../shared/azure-devops/boards-repo-resolution'
import type { Repo } from '../../shared/repository/repo-types'
import {
  createAzureDevOpsBoardsService,
  type AzureDevOpsBoardsService
} from '../azure-devops/boards/boards-service'
import type { Store } from '../persistence/loading-store/store'
import { getLocalProjectWorktreeGitOptions } from '../workspaces/execution-host/project-runtime-git-options'

function findRegisteredRepo(store: Store, args: AzureDevOpsBoardsRepoArgs): Repo | null {
  if (args.repoId) {
    const repo = store.getRepo(args.repoId)
    if (repo && repo.path === args.repoPath) {
      return repo
    }
  }
  const repoPath = resolve(args.repoPath)
  return store.getRepos().find((repo) => resolve(repo.path) === repoPath) ?? null
}

// Why: a WSL project runs `git remote get-url` inside the distro; the renderer never knows that.
function resolveLocalGitOptions(
  store: Store,
  args: AzureDevOpsBoardsRepoArgs
): { wslDistro?: string } {
  if (args.connectionId) {
    return {}
  }
  const repo = findRegisteredRepo(store, args)
  return repo ? getLocalProjectWorktreeGitOptions(store, repo) : {}
}

export function registerAzureDevOpsBoardsHandlers(store: Store): void {
  const service = createAzureDevOpsBoardsService((args) => resolveLocalGitOptions(store, args))
  type Args<K extends keyof AzureDevOpsBoardsService> = Parameters<AzureDevOpsBoardsService[K]>[0]
  ipcMain.handle('azureDevOpsBoards:isAuthenticated', (_event, args: Args<'isAuthenticated'>) =>
    service.isAuthenticated(args)
  )
  ipcMain.handle('azureDevOpsBoards:listTeams', (_event, args: Args<'listTeams'>) =>
    service.listTeams(args)
  )
  ipcMain.handle('azureDevOpsBoards:getConfiguration', (_event, args: Args<'getConfiguration'>) =>
    service.getConfiguration(args)
  )
  ipcMain.handle('azureDevOpsBoards:loadBacklog', (_event, args: Args<'loadBacklog'>) =>
    service.loadBacklog(args)
  )
  ipcMain.handle('azureDevOpsBoards:loadBoard', (_event, args: Args<'loadBoard'>) =>
    service.loadBoard(args)
  )
  ipcMain.handle(
    'azureDevOpsBoards:loadAssignedWorkItems',
    (_event, args: Args<'loadAssignedWorkItems'>) => service.loadAssignedWorkItems(args)
  )
  ipcMain.handle('azureDevOpsBoards:getWorkItem', (_event, args: Args<'getWorkItem'>) =>
    service.getWorkItem(args)
  )
}
