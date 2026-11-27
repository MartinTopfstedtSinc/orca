// `worker-start --on agent-workspace` asks this Orca to create a Che agent workspace for the
// project first, then start the worker there as it would on any paired server.
export const AGENT_WORKSPACE_SERVER = 'agent-workspace'

// The DevWorkspace provider waits up to five minutes for the workspace's Orca server.
const AGENT_WORKSPACE_PROVISION_BUDGET_MS = 360_000

/** Extra time a worker start needs when it first creates its agent workspace. */
export function agentWorkspaceStartBudgetMs(params: unknown): number {
  return typeof params === 'object' &&
    params !== null &&
    'on' in params &&
    params.on === AGENT_WORKSPACE_SERVER
    ? AGENT_WORKSPACE_PROVISION_BUDGET_MS
    : 0
}
