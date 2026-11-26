// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createNamespacedStorage,
  installWebStorageNamespace,
  readStorageNamespace,
  seedNamespacedStorage
} from './web-storage-namespace'

const ENVIRONMENT = 'orca.web.runtimeEnvironment.v1'
const SETTINGS = 'orca.web.settings.v1'

let real: Storage

beforeEach(() => {
  real = window.localStorage
  real.clear()
  document.head.innerHTML = ''
})

afterEach(() => {
  // Why: installWebStorageNamespace redefines window.localStorage on the shared window.
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => real })
  real.clear()
})

function nameNamespace(namespace: string): void {
  document.head.innerHTML = `<meta name="orca-storage-namespace" content="${namespace}">`
}

describe('readStorageNamespace', () => {
  it('reads the namespace the page names', () => {
    nameNamespace(' host:one ')
    expect(readStorageNamespace(document)).toBe('host:one')
  })

  it('returns null without a meta tag or with an empty one', () => {
    expect(readStorageNamespace(document)).toBeNull()
    nameNamespace('  ')
    expect(readStorageNamespace(document)).toBeNull()
  })
})

describe('createNamespacedStorage', () => {
  it('keeps keys under the namespace prefix', () => {
    const one = createNamespacedStorage(real, 'host:one')
    const two = createNamespacedStorage(real, 'host:two')
    one.setItem(SETTINGS, 'a')
    two.setItem(SETTINGS, 'b')
    expect(real.getItem(`host:one:${SETTINGS}`)).toBe('a')
    expect(one.getItem(SETTINGS)).toBe('a')
    expect(two.getItem(SETTINGS)).toBe('b')
    expect(real.getItem(SETTINGS)).toBeNull()
  })

  it('lists, counts and clears only its own keys', () => {
    real.setItem('shared', 'x')
    const one = createNamespacedStorage(real, 'host:one')
    one.setItem('a', '1')
    one.setItem('b', '2')
    expect(one.length).toBe(2)
    expect([one.key(0), one.key(1)].sort()).toEqual(['a', 'b'])
    expect(one.key(2)).toBeNull()
    expect(Object.keys(one).sort()).toEqual(['a', 'b'])
    one.clear()
    expect(one.length).toBe(0)
    expect(real.getItem('shared')).toBe('x')
  })

  it('supports property access like a Storage', () => {
    const one = createNamespacedStorage(real, 'host:one') as Storage & Record<string, unknown>
    one.flag = 'on'
    expect(real.getItem('host:one:flag')).toBe('on')
    expect(one.flag).toBe('on')
    expect('flag' in one).toBe(true)
    delete one.flag
    expect(one.getItem('flag')).toBeNull()
    expect(one.missing).toBeUndefined()
  })
})

describe('seedNamespacedStorage', () => {
  it('copies the shared storage into a new namespace, except the saved server', () => {
    real.setItem(SETTINGS, '{"theme":"dark"}')
    real.setItem('orca:pr-comment-presentation', 'compact')
    real.setItem(ENVIRONMENT, '{"server":"shared"}')
    seedNamespacedStorage(real, 'host:one')
    expect(real.getItem(`host:one:${SETTINGS}`)).toBe('{"theme":"dark"}')
    expect(real.getItem('host:one:orca:pr-comment-presentation')).toBe('compact')
    expect(real.getItem(`host:one:${ENVIRONMENT}`)).toBeNull()
  })

  it("leaves the family's other namespaces and bookkeeping alone", () => {
    real.setItem(`host:two:${SETTINGS}`, 'two')
    real.setItem('host.saved-servers', 'bookkeeping')
    real.setItem(SETTINGS, 'shared')
    seedNamespacedStorage(real, 'host:one')
    expect(real.getItem(`host:one:${SETTINGS}`)).toBe('shared')
    expect(real.getItem('host:one:host:two:orca.web.settings.v1')).toBeNull()
    expect(real.getItem('host:one:host.saved-servers')).toBeNull()
  })

  it('seeds a namespace that holds only its saved server', () => {
    real.setItem(`host:one:${ENVIRONMENT}`, 'mine')
    real.setItem(SETTINGS, 'shared')
    seedNamespacedStorage(real, 'host:one')
    expect(real.getItem(`host:one:${SETTINGS}`)).toBe('shared')
    expect(real.getItem(`host:one:${ENVIRONMENT}`)).toBe('mine')
  })

  it('never seeds a namespace that already holds other keys', () => {
    real.setItem(`host:one:${SETTINGS}`, 'mine')
    real.setItem(SETTINGS, 'shared')
    real.setItem('other', 'shared')
    seedNamespacedStorage(real, 'host:one')
    expect(real.getItem(`host:one:${SETTINGS}`)).toBe('mine')
    expect(real.getItem('host:one:other')).toBeNull()
  })

  it('copies every other key when the namespace has no family', () => {
    real.setItem('plain', 'shared')
    real.setItem('other:x', 'shared too')
    seedNamespacedStorage(real, 'solo')
    expect(real.getItem('solo:plain')).toBe('shared')
    expect(real.getItem('solo:other:x')).toBe('shared too')
  })
})

describe('installWebStorageNamespace', () => {
  it('leaves localStorage alone when the page names no namespace', () => {
    expect(installWebStorageNamespace(window)).toBeNull()
    window.localStorage.setItem(SETTINGS, 'plain')
    expect(real.getItem(SETTINGS)).toBe('plain')
  })

  it('scopes window.localStorage and seeds it', () => {
    real.setItem(SETTINGS, 'shared')
    nameNamespace('host:one')
    expect(installWebStorageNamespace(window)).toBe('host:one')
    expect(window.localStorage.getItem(SETTINGS)).toBe('shared')
    window.localStorage.setItem(SETTINGS, 'mine')
    expect(real.getItem(`host:one:${SETTINGS}`)).toBe('mine')
    expect(real.getItem(SETTINGS)).toBe('shared')
  })

  it("forwards this namespace's storage events without the prefix and drops others", () => {
    nameNamespace('host:one')
    installWebStorageNamespace(window)
    const seen = vi.fn()
    window.addEventListener('storage', (event) => seen(event.key, event.newValue))
    const fire = (key: string): void => {
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: 'v', storageArea: real })
      )
    }
    fire(`host:one:${SETTINGS}`)
    fire(`host:two:${SETTINGS}`)
    fire(SETTINGS)
    expect(seen.mock.calls).toEqual([[SETTINGS, 'v']])
  })
})
