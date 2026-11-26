/**
 * Gives the web client its own local storage when a host serves several Orca servers
 * from one origin. Without it they share one saved server and one set of settings.
 *
 * The page names the namespace with <meta name="orca-storage-namespace" content="...">.
 * Every key is then stored as "<namespace>:<key>", so a page script that runs before
 * the client can read and write the client's keys with that same prefix.
 */

export const STORAGE_NAMESPACE_META_NAME = 'orca-storage-namespace'

// Why: a saved server belongs to the namespace that paired with it, never to the others.
const RUNTIME_ENVIRONMENT_STORAGE_KEY = 'orca.web.runtimeEnvironment.v1'

export function readStorageNamespace(doc: Document): string | null {
  const content = doc
    .querySelector(`meta[name="${STORAGE_NAMESPACE_META_NAME}"]`)
    ?.getAttribute('content')
    ?.trim()
  return content ? content : null
}

export function createNamespacedStorage(real: Storage, namespace: string): Storage {
  const prefix = `${namespace}:`
  const names = (): string[] => {
    const found: string[] = []
    for (let i = 0; i < real.length; i++) {
      const name = real.key(i)
      if (name?.startsWith(prefix)) {
        found.push(name.slice(prefix.length))
      }
    }
    return found
  }
  const scoped = {
    getItem: (name: string): string | null => real.getItem(prefix + name),
    setItem: (name: string, value: string): void => real.setItem(prefix + name, String(value)),
    removeItem: (name: string): void => real.removeItem(prefix + name),
    clear: (): void => names().forEach((name) => real.removeItem(prefix + name)),
    key: (index: number): string | null => names()[index] ?? null,
    get length(): number {
      return names().length
    }
  }
  // Why: some callers read and write keys as properties, as a Storage allows.
  return new Proxy(scoped, {
    get: (target, name) =>
      name in target || typeof name !== 'string'
        ? Reflect.get(target, name)
        : (target.getItem(name) ?? undefined),
    set: (target, name, value) => {
      if (typeof name === 'string') {
        target.setItem(name, String(value))
      }
      return true
    },
    deleteProperty: (target, name) => {
      if (typeof name === 'string') {
        target.removeItem(name)
      }
      return true
    },
    has: (target, name) =>
      name in target || (typeof name === 'string' && target.getItem(name) !== null),
    ownKeys: () => names(),
    getOwnPropertyDescriptor: (target, name) => {
      const value = typeof name === 'string' ? target.getItem(name) : null
      return value === null
        ? undefined
        : { value, writable: true, enumerable: true, configurable: true }
    }
  }) as unknown as Storage
}

/**
 * A namespace that holds nothing yet besides its saved server starts from the shared
 * storage, so settings made before namespaces existed carry over. A namespace such as
 * "host:workspace-id" belongs to the family "host": keys of the family's other
 * namespaces and its own bookkeeping, which all start with "host", stay where they are.
 */
export function seedNamespacedStorage(real: Storage, namespace: string): void {
  const prefix = `${namespace}:`
  const separator = namespace.lastIndexOf(':')
  const family = separator > 0 ? namespace.slice(0, separator) : prefix
  const shared: string[] = []
  for (let i = 0; i < real.length; i++) {
    const name = real.key(i)
    if (name === null) {
      continue
    }
    if (name.startsWith(prefix)) {
      if (name !== prefix + RUNTIME_ENVIRONMENT_STORAGE_KEY) {
        return
      }
      continue
    }
    if (!name.startsWith(family) && name !== RUNTIME_ENVIRONMENT_STORAGE_KEY) {
      shared.push(name)
    }
  }
  for (const name of shared) {
    const value = real.getItem(name)
    if (value !== null) {
      real.setItem(prefix + name, value)
    }
  }
}

/** Storage events for this namespace arrive without the prefix; others are dropped. */
function forwardNamespacedStorageEvents(win: Window, real: Storage, namespace: string): void {
  const prefix = `${namespace}:`
  win.addEventListener(
    'storage',
    (event) => {
      if (event.storageArea !== real || event.key === null) {
        return
      }
      event.stopImmediatePropagation()
      if (event.key.startsWith(prefix)) {
        const { oldValue, newValue, url } = event
        win.dispatchEvent(
          new StorageEvent('storage', {
            key: event.key.slice(prefix.length),
            oldValue,
            newValue,
            url
          })
        )
      }
    },
    true
  )
}

/** Returns the namespace in use, or null when the page names none or it cannot be applied. */
export function installWebStorageNamespace(win: Window = window): string | null {
  const namespace = readStorageNamespace(win.document)
  if (!namespace) {
    return null
  }
  let real: Storage
  try {
    real = win.localStorage
  } catch {
    // Why: storage that is blocked stays blocked; the client already copes with that.
    return null
  }
  const scoped = createNamespacedStorage(real, namespace)
  try {
    Object.defineProperty(win, 'localStorage', { configurable: true, get: () => scoped })
  } catch {
    return null
  }
  forwardNamespacedStorageEvents(win, real, namespace)
  try {
    seedNamespacedStorage(real, namespace)
  } catch {
    // Why: a full storage only costs the carried-over settings, not the namespace.
  }
  return namespace
}
