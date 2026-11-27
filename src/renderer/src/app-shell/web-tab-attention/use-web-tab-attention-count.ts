import { useMemo, useSyncExternalStore } from 'react'
import { useAgentBucketCounts } from '@/components/dashboard/bucket-counts/useAgentBucketCounts'
import { useBotHomeWorkspaces, useBots, useBotsEnabled } from '@/lib/bot-catalog'
import {
  readBotHostState,
  readBotItemsNeedingOwner,
  subscribeToBotChanges
} from '@/lib/bot-catalog-snapshot'
import type { Bot } from '../../../../shared/bot-types'
import type { FolderWorkspace } from '../../../../shared/folder-workspaces/folder-workspace-types'

const NO_BOTS: readonly Bot[] = []

export type WebTabAttentionSources = {
  liveBots: readonly Bot[]
  homes: readonly FolderWorkspace[]
}

/** Bots that can ask anything (not paused) and their homes; none while bots are off. */
export function useWebTabAttentionSources(): WebTabAttentionSources {
  const botsEnabled = useBotsEnabled()
  const bots = useBots(botsEnabled)
  const liveBots = useMemo(
    () => (botsEnabled ? bots.filter((bot) => !bot.paused) : NO_BOTS),
    [bots, botsEnabled]
  )
  const homes = useBotHomeWorkspaces(liveBots, NO_BOTS)
  return useMemo(() => ({ liveBots, homes }), [liveBots, homes])
}

/** A bot's Needs you items, or null while its host is offline (an offline host asks nothing). */
export function readLiveBotItems(bot: Bot): number | null {
  return readBotHostState(bot.hostId) === 'live' ? (readBotItemsNeedingOwner(bot) ?? 0) : null
}

/** What waits on the owner, from the counts the sidebar already shows: agents in the Agents
 *  dashboard's Needs You bucket, bots' Needs you items, and bots' unread replies. */
export function useWebTabAttentionCount({ liveBots, homes }: WebTabAttentionSources): number {
  const agents = useAgentBucketCounts().attention
  const readItems = (): number =>
    liveBots.reduce((sum, bot) => sum + (readLiveBotItems(bot) ?? 0), 0)
  const items = useSyncExternalStore(subscribeToBotChanges, readItems, readItems)
  const unread = useMemo(() => homes.filter((home) => home.isUnread).length, [homes])
  return agents + items + unread
}
