import type {
  WorkspacePortHostKillRequest,
  WorkspacePortHostScanResult,
  WorkspacePortKillRequest,
  WorkspacePortKillResult,
  WorkspacePortProbe,
  WorkspacePortScanResult
} from '../../../../shared/workspace/ports/workspace-ports'
import {
  filterWorkspacePortProbes,
  killWorkspacePort,
  scanWorkspacePortProbes
} from '../../../ports/workspace-port-ownership'
import {
  killWorkspacePortOnExecutionHost,
  scanWorkspacePortsOnExecutionHost,
  type WorkspacePortExecutionHostDeps
} from '../../../ports/workspace-port-execution-host'
import { resolveWorktreeHostRouting } from '../catalog/worktree-launch-host-repo'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host/execution-host'
import { RuntimeWorkspaceSleepOperations } from '../sleep/runtime-workspace-sleep-operations'
import { getChePortPublicUrls } from '../../../che/ports/che-port-exposure-registry'

async function withChePublicBaseUrl<T extends WorkspacePortScanResult>(
  scan: T | Promise<T>
): Promise<T> {
  const result = await scan
  const publicBaseUrl = getChePortPublicUrls()?.publicBaseUrl()
  return publicBaseUrl ? { ...result, publicBaseUrl } : result
}

export abstract class RuntimeWorkspacePortOperations extends RuntimeWorkspaceSleepOperations {
  async scanWorkspacePorts(repoId?: string): Promise<WorkspacePortScanResult> {
    return withChePublicBaseUrl(scanWorkspacePortProbes(await this.getWorkspacePortProbes(repoId)))
  }

  async killWorkspacePort(args: WorkspacePortKillRequest): Promise<WorkspacePortKillResult> {
    return killWorkspacePort(await this.getWorkspacePortProbes(args.repoId), args)
  }

  // Why the workspace, not a client-named host: this server resolves where the workspace runs.
  async scanWorkspacePortsOnHost(worktreeSelector: string): Promise<WorkspacePortHostScanResult> {
    const { executionHostId } = await this.resolveRuntimeFileTarget(worktreeSelector)
    const scan = await scanWorkspacePortsOnExecutionHost(
      executionHostId,
      this.getWorkspacePortHostDeps()
    )
    return executionHostId === LOCAL_EXECUTION_HOST_ID ? withChePublicBaseUrl(scan) : scan
  }

  async killWorkspacePortOnHost(
    args: WorkspacePortHostKillRequest
  ): Promise<WorkspacePortKillResult> {
    const { executionHostId } = await this.resolveRuntimeFileTarget(args.worktree)
    return killWorkspacePortOnExecutionHost(executionHostId, args, this.getWorkspacePortHostDeps())
  }

  protected getWorkspacePortHostDeps(): WorkspacePortExecutionHostDeps {
    return {
      getLocalProbes: () => this.getWorkspacePortProbes()
    }
  }

  // Authorize RPC port probes from host-owned workspace paths, never client-supplied paths.
  protected async getWorkspacePortProbes(repoId?: string): Promise<WorkspacePortProbe[]> {
    const repos = this.requireStore().getRepos()
    return filterWorkspacePortProbes(
      (await this.listResolvedWorktrees()).map((worktree) => {
        // Resolve executionHostId too: remote SSH paths must never authorize local listeners.
        const routing = resolveWorktreeHostRouting(repos, worktree)
        return {
          id: worktree.id,
          repoId: worktree.repoId,
          displayName: worktree.displayName,
          path: worktree.git.path,
          runsHere:
            routing.kind === 'unowned' ||
            (routing.kind === 'resolved' && routing.hostId === LOCAL_EXECUTION_HOST_ID)
        }
      }),
      repoId
    )
  }
}
