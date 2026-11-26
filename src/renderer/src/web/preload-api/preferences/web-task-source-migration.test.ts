import { describe, expect, it } from 'vitest'
import { migrateStoredWebSettings } from './web-preference-normalization'

describe('browser-saved task sources', () => {
  it('shows Azure DevOps once to a browser that saved its list before it existed', () => {
    const migrated = migrateStoredWebSettings({ visibleTaskProviders: ['github', 'linear'] })
    expect(migrated.visibleTaskProviders).toEqual(['github', 'linear', 'azure-devops'])
    expect(migrated.visibleTaskProvidersDefaultedForAzureDevOps).toBe(true)
  })

  it('keeps a later opt-out', () => {
    const migrated = migrateStoredWebSettings({
      visibleTaskProviders: ['github'],
      visibleTaskProvidersDefaultedForAzureDevOps: true
    })
    expect(migrated.visibleTaskProviders).toEqual(['github'])
  })

  it('leaves a browser without a saved list on the defaults', () => {
    expect(migrateStoredWebSettings({}).visibleTaskProviders).toBeUndefined()
  })
})
