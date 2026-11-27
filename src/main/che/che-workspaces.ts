import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { lazyZodSchema } from '../../shared/schema/lazy-zod-schema'
import { upsertEphemeralVmRuntime } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import {
  addEnvironmentFromPairingCode,
  listEnvironments,
  updateEnvironmentFromPairingCode
} from '../../shared/remote-runtime/host-store/runtime-environment-store'
import { redactRuntimeEnvironment } from '../../shared/remote-runtime/host-catalog/runtime-environments'
import { defineMethod, InvalidArgumentError } from '../runtime/rpc/core'
import { forgetClusterCheck, logUnavailable, probe } from './che-workspace-probe'
import {
  cleanup,
  dataPath,
  exclusive,
  find,
  lifecycle,
  operations,
  provider,
  recipe,
  records,
  resource,
  update
} from './che-workspace-records'

const controllers = new Map<string, AbortController>()

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
    handler: async (args, { runtime, signal }) => {
      const repo = runtime.listRepos().find((entry) => entry.id === args.repoId)
      const id = randomUUID()
      const key = args.provisionId ?? id
      if (controllers.has(key)) {
        throw new InvalidArgumentError('Provisioning is already running for this request.')
      }
      // Register first so cancelProvision also stops a create still waiting on the probe.
      const controller = new AbortController()
      controllers.set(key, controller)
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
      }
      let checked: Awaited<ReturnType<typeof probe>>
      try {
        checked = await probe(repo)
      } catch (error) {
        signal?.removeEventListener('abort', abort)
        controllers.delete(key)
        throw error
      }
      if (controller.signal.aborted || 'reason' in checked) {
        signal?.removeEventListener('abort', abort)
        controllers.delete(key)
        if (!('reason' in checked)) {
          return {
            ok: false as const,
            error: 'Provisioning was cancelled.',
            stdout: '',
            stderr: ''
          }
        }
        // Recheck at create time: the composer's recipe list can be stale.
        const error = checked.reason ?? 'Agent workspaces are not configured on this Orca server.'
        logUnavailable(error)
        return { ok: false as const, fallback: true, error, stdout: '', stderr: '' }
      }
      const { repoUrl } = checked
      const backend = provider()
      const allocation = backend.allocation(id)
      const now = Date.now()
      upsertEphemeralVmRuntime(dataPath(), {
        id,
        recipeId: recipe.id,
        recipe,
        repoId: args.repoId,
        projectId: args.projectId,
        workspaceId: args.workspaceId,
        workspaceName: args.workspaceName,
        status: 'provisioning',
        cleanupStatus: 'not_started',
        createdAt: now,
        updatedAt: now,
        recipeResult: {
          schemaVersion: 1,
          pairingCode: 'pending',
          projectRoot: '/projects/source',
          userData: allocation
        }
      })
      operations.add(id)
      try {
        const recipeResult = await backend.create(allocation, repoUrl, controller.signal)
        const environment = await addEnvironmentFromPairingCode(dataPath(), {
          name: `${args.workspaceName || 'Che workspace'} (${id.slice(0, 8)})`,
          pairingCode: recipeResult.pairingCode,
          source: 'ephemeral-vm'
        })
        const row = update(id, {
          status: 'running',
          connectionMode: 'orca-server',
          runtimeEnvironmentId: environment.id,
          recipeResult
        })
        return {
          ok: true as const,
          connectionType: 'orca-server' as const,
          runtime: row,
          environment: redactRuntimeEnvironment(environment),
          stderr: '',
          warnings: []
        }
      } catch (error) {
        // Rollback is not cancellable; a failed rollback stays recorded for retry.
        await cleanup(find(id))
        // Failures before the DevWorkspace exists (quota, admission, Route) fall back to this host.
        const fallback =
          error instanceof Error && (error as Error & { fallback?: boolean }).fallback === true
        if (fallback) {
          forgetClusterCheck()
        }
        return {
          ok: false as const,
          ...(fallback ? { fallback: true } : {}),
          error: error instanceof Error ? error.message : String(error),
          stdout: '',
          stderr: ''
        }
      } finally {
        signal?.removeEventListener('abort', abort)
        controllers.delete(key)
        operations.delete(id)
      }
    }
  }),
  defineMethod({
    name: 'cheWorkspace.cancelProvision',
    permission: 'host-admin',
    params: ProvisionIdParams,
    handler: ({ provisionId }) => {
      const controller = controllers.get(provisionId)
      controller?.abort()
      return { cancelled: Boolean(controller) }
    }
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
