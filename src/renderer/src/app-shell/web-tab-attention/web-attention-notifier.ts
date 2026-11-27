import type { NotificationDispatchRequest } from '../../../../shared/notifications/notification-settings-types'

/** One thing waiting on the owner; `weight` grows when more of it waits (a bot's item count). */
export type WebAttentionItem = {
  key: string
  weight: number
  request: NotificationDispatchRequest
}

/** Picks what started needing the owner while the tab was hidden, once per item per hidden spell. */
export class WebAttentionNotifier {
  private seen: Map<string, number> | null = null

  /** What to announce now; nothing while visible, and the first hidden read only sets the baseline. */
  update(items: readonly WebAttentionItem[], hidden: boolean): WebAttentionItem[] {
    if (!hidden) {
      this.seen = null
      return []
    }
    if (!this.seen) {
      this.seen = new Map(items.map((item) => [item.key, item.weight]))
      return []
    }
    const fresh = items.filter((item) => item.weight > (this.seen!.get(item.key) ?? 0))
    for (const item of fresh) {
      this.seen.set(item.key, item.weight)
    }
    return fresh
  }
}
