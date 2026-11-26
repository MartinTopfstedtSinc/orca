import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../../shared/orca-profiles/constants'
import type { PersistedState } from '../../../../shared/orca-profiles/persisted-state-types'
import { prepareLoadedProfileSettings } from './prepare-loaded-profile-settings'

function load(settings: Partial<PersistedState['settings']>) {
  const defaults = getDefaultPersistedState('/home/user')
  let saves = 0
  const prepared = prepareLoadedProfileSettings(
    { ...defaults, settings: { ...defaults.settings, ...settings } },
    defaults,
    () => saves++
  )
  return { visible: prepared.taskProviderSettings.visibleTaskProviders, saves }
}

describe('visible task providers on load', () => {
  it('shows Azure DevOps once to a profile that saved its list before it existed', () => {
    const { visible, saves } = load({
      visibleTaskProviders: ['github', 'linear'],
      visibleTaskProvidersDefaultedForJira: true,
      visibleTaskProvidersDefaultedForAzureDevOps: undefined as never
    })
    expect(visible).toEqual(['github', 'linear', 'azure-devops'])
    expect(saves).toBeGreaterThan(0)
  })

  it('keeps a later opt-out', () => {
    const { visible } = load({
      visibleTaskProviders: ['github', 'linear'],
      visibleTaskProvidersDefaultedForJira: true,
      visibleTaskProvidersDefaultedForAzureDevOps: true
    })
    expect(visible).toEqual(['github', 'linear'])
  })
})
