import { useSyncExternalStore } from 'react'
import { BellRing } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import {
  readBrowserNotificationsState,
  setBrowserNotificationsEnabled,
  subscribeToBrowserNotifications
} from '@/web/preload-api/app/web-browser-notifications'
import { Button } from '../../ui/button'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { NotificationSettingToggle } from './NotificationSettingToggle'

/** The web client's opt-in to this browser's notifications; asking permission waits for the toggle. */
export function WebNotificationsPane(): React.JSX.Element {
  const t = useTranslate()
  const state = useSyncExternalStore(
    subscribeToBrowserNotifications,
    readBrowserNotificationsState,
    readBrowserNotificationsState
  )
  const hint =
    state === 'blocked'
      ? t(
          'web.settings.notifications.blocked',
          'This browser blocks notifications from this site. Allow them in the site settings, then turn this on.'
        )
      : state === 'unsupported'
        ? t('web.settings.notifications.unsupported', 'This browser cannot show notifications.')
        : null

  return (
    <SettingsGroup>
      <NotificationSettingToggle
        label={t('web.settings.notifications.label', 'Browser notifications')}
        description={t(
          'web.settings.notifications.description',
          'While this tab is in the background, notify when an agent or bot starts needing you.'
        )}
        checked={state === 'on'}
        disabled={state === 'blocked' || state === 'unsupported'}
        onToggle={() => void setBrowserNotificationsEnabled(state !== 'on')}
      />
      {hint ? <p className="pb-2 text-xs text-muted-foreground">{hint}</p> : null}
      <div data-settings-row="" className="flex flex-wrap items-center gap-2 py-2">
        <Button
          variant="outline"
          size="sm"
          disabled={state !== 'on'}
          onClick={() => void window.api.notifications.dispatch({ source: 'test' })}
        >
          <BellRing className="size-3.5" />
          {t('web.settings.notifications.test', 'Send test notification')}
        </Button>
      </div>
    </SettingsGroup>
  )
}
