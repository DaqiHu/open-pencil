import { createIdbRecoveryStore } from '@/app/document/recovery/idb'
import { createMemoryRecoveryStore } from '@/app/document/recovery/memory'
import type {
  RecoverySnapshot,
  RecoverySnapshotInput,
  RecoverySnapshotMeta,
  RecoveryStore
} from '@/app/document/recovery/types'

let singleton: RecoveryStore | null = null
let memoryFallback = false

function warnMemoryFallback(error?: unknown): void {
  if (memoryFallback) return
  console.warn('[Recovery] IndexedDB unavailable; crash recovery is limited to this session', error)
  memoryFallback = true
}

function createResilientRecoveryStore(primary: RecoveryStore): RecoveryStore {
  let current = primary
  let queue = Promise.resolve()

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation)
    queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async function switchToMemory(error: unknown): Promise<RecoveryStore> {
    if (current !== primary) return current
    warnMemoryFallback(error)
    const memory = createMemoryRecoveryStore()
    try {
      const snapshots = await primary.list()
      for (const metadata of snapshots) {
        const snapshot = await primary.read(metadata.id)
        if (snapshot) await memory.write({ ...snapshot, closed: snapshot.closed ?? false })
      }
    } catch (migrationError) {
      console.warn('[Recovery] Failed to migrate IndexedDB snapshots to memory:', migrationError)
    }
    current = memory
    return memory
  }

  function run<T>(operation: (store: RecoveryStore) => Promise<T>): Promise<T> {
    return serialized(async () => {
      try {
        return await operation(current)
      } catch (error) {
        if (current !== primary) throw error
        return operation(await switchToMemory(error))
      }
    })
  }

  function removeFromAll(id: string): Promise<void> {
    return serialized(async () => {
      await primary.remove(id)
      if (current !== primary) await current.remove(id)
    })
  }

  function setClosedInAll(id: string, closed: boolean): Promise<void> {
    return serialized(async () => {
      await primary.setClosed(id, closed)
      if (current !== primary) await current.setClosed(id, closed)
    })
  }

  function clearAll(): Promise<void> {
    return serialized(async () => {
      await primary.clear()
      if (current !== primary) await current.clear()
    })
  }

  const listeners = new Set<() => void>()

  function notified<T>(operation: Promise<T>): Promise<T> {
    return operation.then((result) => {
      for (const listener of listeners) listener()
      return result
    })
  }

  return {
    list: () => run((store) => store.list()),
    read: (id: string): Promise<RecoverySnapshot | null> => run((store) => store.read(id)),
    write: (input: RecoverySnapshotInput): Promise<RecoverySnapshotMeta> =>
      notified(run((store) => store.write(input))),
    setClosed: (id, closed) => notified(setClosedInAll(id, closed)),
    remove: (id) => notified(removeFromAll(id)),
    clear: () => notified(clearAll()),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export function getRecoveryStore(): RecoveryStore {
  if (singleton) return singleton
  if (typeof indexedDB === 'undefined') {
    warnMemoryFallback()
    singleton = createMemoryRecoveryStore()
    return singleton
  }
  memoryFallback = false
  singleton = createResilientRecoveryStore(createIdbRecoveryStore())
  return singleton
}

export function isRecoveryStoreMemoryFallback(): boolean {
  return memoryFallback
}

export function resetRecoveryStoreForTests(store?: RecoveryStore): void {
  singleton = store ?? null
  memoryFallback = false
}
