import { z } from 'zod'
import { lazyZodSchema } from '../../shared/schema/lazy-zod-schema'
import {
  listEnvironments,
  updateEnvironmentFromPairingCode
} from '../../shared/remote-runtime/host-store/runtime-environment-store'
import { defineMethod } from '../runtime/rpc/core'
import { logUnavailable, probe } from './che-workspace-probe'
import { cancelCheProvision, provisionCheWorkspace } from './che-workspace-provision'
import {
  cleanup,
  dataPath,
  exclusive,
  find,
  lifecycle,
  provider,
  recipe,
  records,
  resource,
  update
} from './che-workspace-records'

const RuntimeId = lazyZodSchema(() => z.object({ runtimeId: z.string().min(1) }))
const WorkspaceId = lazyZodSchema(() => z.object({ workspaceId: z.string().min(1) }))
const RepoIdParams = lazyZodSchema(() => z.object({ repoId: z.string() }))
const ProvisionIdParams = lazyZodSchema(() => z.object({ provisionId: z.string() }))
const AttachWorkspaceParams = lazyZodSchema(() => RuntimeId.extend({ workspaceId: z.string() }))
const ProvisionParams = lazyZodSchema(() =>
  z.object({
    repoId: z.string(),
    recipeId: z.literal('che-devworkspace'),
    projectId: z.string().optional(),
    workspaceId: z.string().optional(),
    workspaceName: z.string().optional(),
    provisionId: z.string().optional(),
    branch: z.string().optional(),
    ref: z.string().optional()
  })
)

export const CHE_WORKSPACE_METHODS = [
  defineMethod({
    name: 'cheWorkspace.listRecipes',
    permission: 'workspace',
    params: RepoIdParams,
    handler: async ({ repoId }, { runtime }) => {
      const repo = runtime.listRepos().find((entry) => entry.id === repoId)
      const result = await probe(repo)
      if ('reason' in result) {
        logUnavailable(result.reason)
      }
      return {
        status: 'ok' as const,
        repoPath: repo?.path ?? null,
        recipes: 'repoUrl' in result ? [recipe] : [],
        diagnostics: []
      }
    }
  }),
  // These credentials travel only through Orca's authenticated, encrypted runtime connection.
  defineMethod({
    name: 'cheWorkspace.environments',
    permission: 'host-admin',
    params: null,
    handler: async () => {
      const ids = new Set(
        records()
          .filter((row) => row.status !== 'cleaned')
          .map((row) => row.runtimeEnvironmentId)
      )
      return (await listEnvironments(dataPath())).filter((env) => ids.has(env.id))
    }
  }),
  defineMethod({
    name: 'cheWorkspace.listRuntimes',
    permission: 'host-admin',
    params: null,
    handler: () => records().filter((row) => row.status !== 'cleaned')
  }),
  defineMethod({
    name: 'cheWorkspace.provision',
    permission: 'host-admin',
    params: ProvisionParams,
    handler: (args, { runtime, signal }) =>
      provisionCheWorkspace(
        runtime.listRepos().find((entry) => entry.id === args.repoId),
        args,
        signal
      )
  }),
  defineMethod({
    name: 'cheWorkspace.cancelProvision',
    permission: 'host-admin',
    params: ProvisionIdParams,
    handler: ({ provisionId }) => ({ cancelled: cancelCheProvision(provisionId) })
  }),
  defineMethod({
    name: 'cheWorkspace.attachWorkspace',
    permission: 'host-admin',
    params: AttachWorkspaceParams,
    handler: ({ runtimeId, workspaceId }) => {
      find(runtimeId)
      return update(runtimeId, { workspaceId })
    }
  }),
  defineMethod({
    name: 'cheWorkspace.cleanup',
    permission: 'host-admin',
    params: RuntimeId,
    handler: ({ runtimeId }) => exclusive(runtimeId, () => cleanup(find(runtimeId)))
  }),
  defineMethod({
    name: 'cheWorkspace.suspendWorkspace',
    permission: 'host-admin',
    params: WorkspaceId,
    handler: async ({ workspaceId }, { signal }) => {
      const row = records().find(
        (entry) => entry.workspaceId === workspaceId && entry.status !== 'cleaned'
      )
      if (!row || row.status === 'suspended') {
        return { ok: true as const, runtime: row ?? null }
      }
      return lifecycle(row, 'suspend_failed', async () => {
        await provider().suspend(resource(row), signal)
        return update(row.id, { status: 'suspended', lifecycleLastError: null })
      })
    }
  }),
  defineMethod({
    name: 'cheWorkspace.resumeWorkspace',
    permission: 'host-admin',
    params: WorkspaceId,
    handler: async ({ workspaceId }, { signal }) => {
      const row = records().find(
        (entry) => entry.workspaceId === workspaceId && entry.status !== 'cleaned'
      )
      if (!row || !['suspended', 'resume_failed', 'suspend_failed'].includes(row.status)) {
        return { ok: true as const, runtime: row ?? null }
      }
      return lifecycle(row, 'resume_failed', async () => {
        const recipeResult = await provider().resume(resource(row), signal)
        if (row.runtimeEnvironmentId) {
          await updateEnvironmentFromPairingCode(dataPath(), row.runtimeEnvironmentId, {
            pairingCode: recipeResult.pairingCode
          })
        }
        return update(row.id, { status: 'running', recipeResult, lifecycleLastError: null })
      })
    }
  })
]
