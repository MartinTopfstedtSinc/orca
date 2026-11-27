import { useMemo, useSyncExternalStore } from 'react'
import { useAgentBucketCounts } from '@/components/dashboard/bucket-counts/useAgentBucketCounts'
import { useBotHomeWorkspaces, useBots, useBotsEnabled } from '@/lib/bot-catalog'
import {
  readBotHostState,
  readBotItemsNeedingOwner,
  subscribeToBotChanges
} from '@/lib/bot-catalog-snapshot'
import type { Bot } from '../../../../shared/bot-types'

const NO_BOTS: readonly Bot[] = []

/** What waits on the owner, from the counts the sidebar already shows: agents in the Agents
 *  dashboard's Needs You bucket, bots' Needs you items, and bots' unread replies. */
export function useWebTabAttentionCount(): number {
  const agents = useAgentBucketCounts().attention
  const botsEnabled = useBotsEnabled()
  const bots = useBots(botsEnabled)
  const liveBots = useMemo(
    () => (botsEnabled ? bots.filter((bot) => !bot.paused) : NO_BOTS),
    [bots, botsEnabled]
  )
  // Same filter as the bots section's collapsed preview: a paused bot or an offline host asks nothing.
  const readItems = (): number =>
    liveBots.reduce(
      (sum, bot) =>
        readBotHostState(bot.hostId) === 'live' ? sum + (readBotItemsNeedingOwner(bot) ?? 0) : sum,
      0
    )
  const items = useSyncExternalStore(subscribeToBotChanges, readItems, readItems)
  const homes = useBotHomeWorkspaces(liveBots, NO_BOTS)
  const unread = useMemo(() => homes.filter((home) => home.isUnread).length, [homes])
  return agents + items + unread
}
