import type {
  AzureDevOpsAssignedWorkItemsPage,
  AzureDevOpsBacklogLevel,
  AzureDevOpsBacklogPage,
  AzureDevOpsBoardPage,
  AzureDevOpsTeam,
  AzureDevOpsTeamConfiguration,
  AzureDevOpsWorkItemDetail
} from '../../../shared/azure-devops/boards-types'
import {
  AZURE_DEVOPS_REMOTE_REQUIRED_ERROR,
  AZURE_DEVOPS_REPO_UNVERIFIABLE_ERROR,
  azureDevOpsTeamRouteSegment,
  type AzureDevOpsBoardsRepoArgs,
  type AzureDevOpsTeamRoute
} from '../../../shared/azure-devops/boards-repo-resolution'
import { isAzureDevOpsReviewCreationAuthenticated } from '../pull-request-creation'
import { getAzureDevOpsRepoRef, type AzureDevOpsRepoRef } from '../repository-ref'
import { loadAzureDevOpsAssignedWorkItems } from './assigned-work-items-client'
import { loadAzureDevOpsBacklogPage } from './backlog-client'
import { getAzureDevOpsBacklogViewSettings } from './backlog-view-settings-client'
import { getAzureDevOpsBacklogConfiguration } from './board-configuration-client'
import { loadAzureDevOpsBoardPage } from './board-items-client'
import { listAzureDevOpsIterations, listAzureDevOpsTeams } from './team-resolution'
import { getAzureDevOpsWorkItemDetail } from './work-item-client'
import { getAzureDevOpsWorkItemTypes } from './work-item-type-metadata'

type LocalGitOptions = { wslDistro?: string }

export type AzureDevOpsBoardsService = {
  isAuthenticated: (args: AzureDevOpsBoardsRepoArgs) => Promise<boolean>
  listTeams: (args: AzureDevOpsBoardsRepoArgs) => Promise<AzureDevOpsTeam[]>
  getConfiguration: (
    args: AzureDevOpsBoardsRepoArgs & AzureDevOpsTeamRoute
  ) => Promise<AzureDevOpsTeamConfiguration>
  loadBacklog: (
    args: AzureDevOpsBoardsRepoArgs &
      AzureDevOpsTeamRoute & { level: AzureDevOpsBacklogLevel; columnFields?: string[] }
  ) => Promise<AzureDevOpsBacklogPage>
  loadBoard: (
    args: AzureDevOpsBoardsRepoArgs & AzureDevOpsTeamRoute & { level: AzureDevOpsBacklogLevel }
  ) => Promise<AzureDevOpsBoardPage | null>
  loadAssignedWorkItems: (
    args: AzureDevOpsBoardsRepoArgs
  ) => Promise<AzureDevOpsAssignedWorkItemsPage>
  getWorkItem: (
    args: AzureDevOpsBoardsRepoArgs & { id: number; cachedIds?: number[] }
  ) => Promise<AzureDevOpsWorkItemDetail | null>
}

/**
 * Boards reads shared by the desktop IPC handlers and the runtime RPC methods, so the
 * web client served by a headless runtime gets the same Tasks page as the desktop app.
 */
export function createAzureDevOpsBoardsService(
  localGitOptionsFor: (args: AzureDevOpsBoardsRepoArgs) => LocalGitOptions
): AzureDevOpsBoardsService {
  async function resolveRepo(
    args: AzureDevOpsBoardsRepoArgs
  ): Promise<{ repo: AzureDevOpsRepoRef; localGitOptions: LocalGitOptions }> {
    const connectionId = args.connectionId ?? null
    const localGitOptions = localGitOptionsFor(args)
    const repo = await getAzureDevOpsRepoRef(args.repoPath, connectionId, localGitOptions)
    if (!repo) {
      // Why: on a remote host a null probe is loss of contact, never a verdict about the remote.
      throw new Error(
        connectionId ? AZURE_DEVOPS_REPO_UNVERIFIABLE_ERROR : AZURE_DEVOPS_REMOTE_REQUIRED_ERROR
      )
    }
    return { repo, localGitOptions }
  }

  return {
    isAuthenticated: async (args) => {
      const { localGitOptions } = await resolveRepo(args)
      return isAzureDevOpsReviewCreationAuthenticated(args.repoPath, args.connectionId ?? null, {
        localGitExecOptions: localGitOptions
      })
    },
    listTeams: async (args) => listAzureDevOpsTeams((await resolveRepo(args)).repo),
    getConfiguration: async (args) => {
      const { repo } = await resolveRepo(args)
      const team = azureDevOpsTeamRouteSegment(args)
      const [backlog, iterations, workItemTypes] = await Promise.all([
        getAzureDevOpsBacklogConfiguration(repo, team),
        listAzureDevOpsIterations(repo, team),
        getAzureDevOpsWorkItemTypes(repo)
      ])
      // Why: the settings endpoint is keyed by team id only; a name-routed team has no per-user view.
      const viewSettings =
        args.teamId && backlog
          ? await getAzureDevOpsBacklogViewSettings(repo, args.teamId, backlog.levels)
          : null
      return {
        backlog,
        iterations,
        workItemTypes,
        repo: { organization: repo.organization ?? null, project: repo.project },
        viewSettings
      }
    },
    loadBacklog: async (args) =>
      loadAzureDevOpsBacklogPage(
        (await resolveRepo(args)).repo,
        azureDevOpsTeamRouteSegment(args),
        args.level,
        args.columnFields ?? []
      ),
    loadBoard: async (args) =>
      loadAzureDevOpsBoardPage(
        (await resolveRepo(args)).repo,
        azureDevOpsTeamRouteSegment(args),
        args.level
      ),
    loadAssignedWorkItems: async (args) =>
      loadAzureDevOpsAssignedWorkItems((await resolveRepo(args)).repo),
    getWorkItem: async (args) =>
      getAzureDevOpsWorkItemDetail((await resolveRepo(args)).repo, args.id, {
        cachedIds: args.cachedIds ?? []
      })
  }
}
