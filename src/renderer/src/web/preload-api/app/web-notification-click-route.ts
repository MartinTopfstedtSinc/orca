import { activateWorktreeAgentPane } from '@/components/sidebar/workspace-card/activity/use-worktree-agent-activation'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { useAppStore } from '@/store/index'
import type { NotificationDispatchRequest } from '../../../../../shared/notifications/notification-settings-types'

/** Opens what a clicked notification names: the agent's pane, else its workspace. */
export function revealNotificationTarget(args: NotificationDispatchRequest): void {
  const row = args.paneKey
    ? useAppStore.getState().agentStatusByPaneKey.projection.row(args.paneKey)
    : undefined
  if (row) {
    activateWorktreeAgentPane(
      row.tab.worktreeId,
      row.tab.id,
      row.activationPaneKey ?? row.paneKey,
      args.workspaceExecutionHostId ?? undefined,
      { revealInSidebar: true }
    )
    return
  }
  if (args.worktreeId) {
    activateAndRevealWorkspace(args.worktreeId, {
      executionHostId: args.workspaceExecutionHostId ?? undefined,
      revealInSidebar: false
    })
  }
}
