import type { PreloadApi } from '../../../../../preload/api-types'
import { getBrowserPlatform } from '../web-storage'
import {
  closeBrowserNotifications,
  readBrowserNotificationsState,
  showBrowserNotification
} from './web-browser-notifications'

export function createNotificationsApi(): NonNullable<Partial<PreloadApi>['notifications']> {
  return {
    getDesktopAwayState: async () => undefined,
    dispatch: (args) => Promise.resolve(showBrowserNotification(args)),
    acknowledgeAttention: () => Promise.resolve({ dismissed: 0 }),
    dismiss: (ids) => Promise.resolve({ dismissed: closeBrowserNotifications(ids) }),
    // The browser client relays nothing to phones, so there is nothing to settle.
    settleStructuredPrompts: () => Promise.resolve(),
    openSystemSettings: () => Promise.resolve(),
    getPermissionStatus: () => {
      const state = readBrowserNotificationsState()
      return Promise.resolve({
        supported: state !== 'unsupported',
        platform: getBrowserPlatform(),
        requested: state !== 'unsupported' && Notification.permission !== 'default'
      })
    },
    probeDelivery: () => Promise.resolve({ state: 'unsupported' as const, authoritative: false }),
    playSound: () => Promise.resolve({ played: false, reason: 'missing-path' })
  }
}
