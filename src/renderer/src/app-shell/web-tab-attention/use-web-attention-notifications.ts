import { useEffect, useRef, useSyncExternalStore } from 'react'
import { translate } from '@/i18n/i18n'
import { subscribeToBotChanges } from '@/lib/bot-catalog-snapshot'
import { useAppStore } from '@/store/index'
import type { AgentStatusProjection } from '@/store/slices/agent-status/projection/agent-status-projection'
import {
  readBrowserNotificationsState,
  subscribeToBrowserNotifications
} from '@/web/preload-api/app/web-browser-notifications'
import { folderWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import { WebAttentionNotifier, type WebAttentionItem } from './web-attention-notifier'
import { readLiveBotItems, type WebTabAttentionSources } from './use-web-tab-attention-count'

function readWebAttentionItems(
  projection: AgentStatusProjection,
  { liveBots, homes }: WebTabAttentionSources
): WebAttentionItem[] {
  const items: WebAttentionItem[] = []
  for (const paneKey of projection.attentionKeys()) {
    const row = projection.row(paneKey)
    if (row) {
      const key = `agent:${paneKey}`
      items.push({
        key,
        weight: 1,
        request: {
          source: 'agent-task-complete',
          attentionKey: key,
          worktreeId: row.tab.worktreeId,
          paneKey,
          worktreeLabel: row.tab.customTitle || row.tab.title,
          agentType: row.agentType,
          agentState: row.entry.state
        }
      })
    }
  }
  for (const bot of liveBots) {
    const count = readLiveBotItems(bot) ?? 0
    if (count > 0) {
      const key = `bot:${bot.hostId}:${bot.id}`
      items.push({
        key,
        weight: count,
        request: {
          source: 'agent-task-complete',
          attentionKey: key,
          worktreeId: folderWorkspaceKey(bot.folderWorkspaceId),
          workspaceExecutionHostId: bot.hostId,
          worktreeLabel: bot.name,
          terminalTitle:
            count === 1
              ? translate('web.notifications.botItem', 'Something needs you')
              : translate('web.notifications.botItems', '{{total}} things need you', {
                  total: count
                })
        }
      })
    }
  }
  for (const home of homes) {
    if (home.isUnread) {
      const key = `home:${home.executionHostId ?? ''}:${home.id}`
      items.push({
        key,
        weight: 1,
        request: {
          source: 'agent-task-complete',
          attentionKey: key,
          worktreeId: folderWorkspaceKey(home.id),
          workspaceExecutionHostId: home.executionHostId ?? null,
          worktreeLabel: home.name,
          terminalTitle: translate('web.notifications.botReply', 'New reply')
        }
      })
    }
  }
  return items
}

/** With browser notifications on, announces what starts needing the owner while this tab is hidden;
 *  they close once the tab is back in view. */
export function useWebAttentionNotifications(sources: WebTabAttentionSources): void {
  const optedIn =
    useSyncExternalStore(
      subscribeToBrowserNotifications,
      readBrowserNotificationsState,
      readBrowserNotificationsState
    ) === 'on'
  const projection = useAppStore((state) => state.agentStatusByPaneKey.projection)
  const notifier = useRef<WebAttentionNotifier | null>(null)
  const shownKeys = useRef(new Set<string>())

  useEffect(() => {
    if (!optedIn) {
      notifier.current = null
      return
    }
    // Kept across source changes: a new baseline would swallow the change that caused it.
    if (notifier.current === null) {
      notifier.current = new WebAttentionNotifier()
    }
    const current = notifier.current
    const shown = shownKeys.current
    const check = (): void => {
      const hidden = document.visibilityState === 'hidden'
      if (!hidden && shown.size) {
        void window.api.notifications.dismiss([...shown])
        shown.clear()
      }
      const items = hidden ? readWebAttentionItems(projection, sources) : []
      for (const item of current.update(items, hidden)) {
        shown.add(item.key)
        void window.api.notifications.dispatch(item.request)
      }
    }
    check()
    document.addEventListener('visibilitychange', check)
    const stopRows = projection.subscribeChanges(check)
    const stopCounts = projection.subscribe('dashboard-counts', check)
    const stopBots = subscribeToBotChanges(check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      stopRows()
      stopCounts()
      stopBots()
    }
  }, [optedIn, projection, sources])
}
