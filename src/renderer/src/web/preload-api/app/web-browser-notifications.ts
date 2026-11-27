import appIconUrl from '../../../../../../resources/icon.png?url'
import { translate } from '@/i18n/i18n'
import { createNonSecureContextUuid } from '../../../../../shared/identifiers/non-secure-context-uuid'
import { formatAgentTypeLabel } from '../../../../../shared/agent-status/presentation/agent-type-label'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult
} from '../../../../../shared/notifications/notification-settings-types'
import { BROWSER_NOTIFICATIONS_STORAGE_KEY, readJson, writeJson } from '../web-storage'

export type BrowserNotificationsState = 'unsupported' | 'off' | 'on' | 'blocked'

const listeners = new Set<() => void>()
const shown = new Map<string, Notification>()

function isSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function readOptIn(): boolean {
  try {
    return readJson(BROWSER_NOTIFICATIONS_STORAGE_KEY, { enabled: false }).enabled === true
  } catch {
    return false
  }
}

/** This browser's opt-in: off until the owner turns it on, and blocked once the browser denies it. */
export function readBrowserNotificationsState(): BrowserNotificationsState {
  if (!isSupported()) {
    return 'unsupported'
  }
  if (Notification.permission === 'denied') {
    return 'blocked'
  }
  return readOptIn() && Notification.permission === 'granted' ? 'on' : 'off'
}

export function subscribeToBrowserNotifications(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Call from a user gesture: browsers show their permission prompt only for one. */
export async function setBrowserNotificationsEnabled(
  enabled: boolean
): Promise<BrowserNotificationsState> {
  if (enabled && isSupported() && Notification.permission === 'default') {
    await Notification.requestPermission().catch(() => 'denied')
  }
  try {
    writeJson(BROWSER_NOTIFICATIONS_STORAGE_KEY, { enabled })
  } catch {
    // Without storage the opt-in lasts for this page only.
  }
  for (const listener of Array.from(listeners)) {
    listener()
  }
  return readBrowserNotificationsState()
}

function browserNotificationContent(args: NotificationDispatchRequest): {
  title: string
  body: string
} {
  const title = args.worktreeLabel || 'Orca'
  if (args.source === 'test') {
    return {
      title,
      body: translate('web.notifications.testBody', 'Browser notifications are on.')
    }
  }
  if (args.agentType) {
    const agent = formatAgentTypeLabel(args.agentType)
    return {
      title,
      body:
        args.agentState === 'blocked'
          ? translate('web.notifications.agentPermission', '{{agent}} asks for permission', {
              agent
            })
          : translate('web.notifications.agentInput', '{{agent}} needs your input', { agent })
    }
  }
  return { title, body: args.terminalTitle ?? '' }
}

/** Shows `args` as a browser notification; a click focuses this tab and opens what it names. */
export function showBrowserNotification(
  args: NotificationDispatchRequest
): NotificationDispatchResult {
  const state = readBrowserNotificationsState()
  if (state !== 'on') {
    return { delivered: false, reason: state === 'unsupported' ? 'not-supported' : 'disabled' }
  }
  if (args.source !== 'test' && document.visibilityState === 'visible' && document.hasFocus()) {
    return { delivered: false, reason: 'suppressed-focus' }
  }
  const id = args.notificationId ?? args.attentionKey ?? createNonSecureContextUuid()
  const { title, body } = browserNotificationContent(args)
  let notification: Notification
  try {
    notification = new Notification(title, { body, tag: id, icon: appIconUrl })
  } catch {
    // Mobile browsers show page notifications only through a service worker.
    return { delivered: false, reason: 'not-supported' }
  }
  shown.get(id)?.close()
  shown.set(id, notification)
  notification.onclose = () => {
    if (shown.get(id) === notification) {
      shown.delete(id)
    }
  }
  notification.onclick = () => {
    window.focus()
    notification.close()
    void import('./web-notification-click-route').then(({ revealNotificationTarget }) =>
      revealNotificationTarget(args)
    )
  }
  return { delivered: true }
}

export function closeBrowserNotifications(ids: readonly string[]): number {
  let closed = 0
  for (const id of ids) {
    const notification = shown.get(id)
    if (notification) {
      notification.close()
      shown.delete(id)
      closed += 1
    }
  }
  return closed
}
