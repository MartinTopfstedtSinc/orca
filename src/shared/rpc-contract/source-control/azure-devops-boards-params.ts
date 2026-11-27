import { z } from 'zod'
import { lazyZodSchema } from '../../schema/lazy-zod-schema'
import { requiredString } from '../rpc-param-primitives'

// Mirrors AzureDevOpsBoardsRepoArgs. The runtime reads only projects it has registered.
export const AzureDevOpsBoardsRepo = lazyZodSchema(() =>
  z.object({
    repoPath: requiredString('Missing repoPath'),
    repoId: z.string().nullable().optional(),
    connectionId: z.string().nullable().optional()
  })
)

export const AzureDevOpsBoardsTeam = lazyZodSchema(() =>
  AzureDevOpsBoardsRepo.extend({
    teamName: requiredString('Missing teamName'),
    teamId: z.string().nullable().optional()
  })
)

// Mirrors AzureDevOpsBacklogLevel, which the client got from getConfiguration.
const AzureDevOpsBacklogLevelParam = lazyZodSchema(() =>
  z.object({
    id: requiredString('Missing backlog level id'),
    name: z.string(),
    rank: z.number(),
    kind: z.enum(['portfolio', 'requirement', 'task']),
    workItemTypes: z.array(z.string()),
    columnFields: z.array(
      z.object({ referenceName: z.string(), name: z.string(), width: z.number() })
    ),
    hidden: z.boolean()
  })
)

export const AzureDevOpsBoardsBacklog = lazyZodSchema(() =>
  AzureDevOpsBoardsTeam.extend({
    level: AzureDevOpsBacklogLevelParam,
    columnFields: z.array(z.string()).optional()
  })
)

export const AzureDevOpsBoardsBoard = lazyZodSchema(() =>
  AzureDevOpsBoardsTeam.extend({
    level: AzureDevOpsBacklogLevelParam
  })
)

export const AzureDevOpsBoardsWorkItem = lazyZodSchema(() =>
  AzureDevOpsBoardsRepo.extend({
    id: z.number().int().positive(),
    cachedIds: z.array(z.number().int()).optional()
  })
)
