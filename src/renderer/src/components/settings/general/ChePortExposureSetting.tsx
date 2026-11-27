import type React from 'react'
import { useId } from 'react'
import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import {
  CHE_PORT_EXPOSURE_MODES,
  type ChePortExposureMode
} from '../../../../../shared/workspace/ports/workspace-port-public-url'
import { WORKSPACE_PORTS_PUBLIC_URL_RUNTIME_CAPABILITY } from '../../../../../shared/remote-runtime/protocol/workspace-ports-runtime-capabilities'
import { useRuntimeEnvironmentCapability } from '@/runtime/rpc/compatibility/use-runtime-environment-capability'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { SettingsRow } from '../form-controls/SettingsFormControls'
import type { SettingsHostScope } from '../host-scope/settings-host-scope'
import {
  getHostSettingUpdateFailedMessage,
  useHostSetting,
  useSettingsHostLabel
} from '../host-scope/use-host-setting'

function modeLabel(mode: ChePortExposureMode, t: Translate): string {
  switch (mode) {
    case 'auto':
      return t('components.settings.chePortExposure.auto', 'Automatic')
    case 'path':
      return t('components.settings.chePortExposure.path', 'Path on the Che host')
    case 'slots':
      return t('components.settings.chePortExposure.slots', 'Own subdomain (slots)')
    case 'off':
      return t('components.settings.chePortExposure.off', 'Off')
  }
}

/** Shown only for an Eclipse Che server: how it publishes workspace ports to browsers. */
export function ChePortExposureSetting({
  settings,
  updateSettings,
  hostScope
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  hostScope: SettingsHostScope
}): React.JSX.Element | null {
  const t = useTranslate()
  const labelId = useId()
  const hostLabel = useSettingsHostLabel(hostScope.target)
  const isChe = useRuntimeEnvironmentCapability(
    hostScope.target.kind === 'environment' ? hostScope.target.environmentId : null,
    WORKSPACE_PORTS_PUBLIC_URL_RUNTIME_CAPABILITY
  )
  const { setting, update } = useHostSetting({
    owner: hostScope.target,
    settingKey: 'chePortExposure',
    localSettings: settings,
    updateLocalSettings: updateSettings,
    updateFailedMessage: getHostSettingUpdateFailedMessage(hostLabel, t)
  })
  if (!isChe || setting.state !== 'ready') {
    return null
  }
  return (
    <SettingsRow
      label={t('components.settings.chePortExposure.title', 'Public port URLs')}
      description={t(
        'components.settings.chePortExposure.description',
        'How this Che workspace opens its ports in a browser. Subdomain slots need endpoints in the editor definition; path routes need apps that use relative URLs.'
      )}
      labelId={labelId}
      control={
        <Select
          value={setting.value}
          disabled={!hostScope.available}
          onValueChange={(value) => {
            const mode = CHE_PORT_EXPOSURE_MODES.find((candidate) => candidate === value)
            if (mode) {
              void update(mode)
            }
          }}
        >
          <SelectTrigger size="sm" className="min-w-32" aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHE_PORT_EXPOSURE_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {modeLabel(mode, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}
