import { AGENT_WORKSPACE_SERVER } from '../../shared/che/agent-workspace-target'
import { configuration } from './devworkspace-provider.mjs'

/** On an Orca that creates Che agent workspaces, a bot starts each worker in one of its own. */
export function agentWorkspaceBotRules(cli: string): string[] {
  try {
    if (!configuration()) {
      return []
    }
  } catch {
    return []
  }
  return [
    `- This Orca gives each worker its own Che agent workspace, a separate container with its own checkout: add \`--on ${AGENT_WORKSPACE_SERVER}\` to \`${cli} orchestration worker-start\`, with \`--worktree new-child\` and \`--repo\` naming this Orca's project, as without it; \`--item\` works as usual. Creating the workspace takes a few minutes. Leave it out only when your owner wants the work in this workspace.`
  ]
}
