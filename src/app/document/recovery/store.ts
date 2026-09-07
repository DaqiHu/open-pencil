import { recordRecoveryOperation } from '@/app/diagnostics'
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

const DEFAULT_OPERATION_TIMEOUT_MS = 10_000

export class RecoveryStoreOperationTimeout extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number
  ) {
    super(`Recovery store operation "${label}" did not settle within ${timeoutMs}ms`)
    this.name = 'RecoveryStoreOperationTimeout'
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  // Promise.race keeps handlers attached to the loser, so a late rejection of a
  // timed-out operation never surfaces as an unhandled rejection.
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new RecoveryStoreOperationTimeout(label, timeoutMs)), timeoutMs)
    })
  ])
}

function warnMemoryFallback(error?: unknown): void {
  if (memoryFallback) return
  console.warn('[Recovery] IndexedDB unavailable; crash recovery is limited to this session', error)
  memoryFallback = true
}

function recordStoreProblem(
  outcome: 'timeout' | 'failed' | 'fallback',
  label: string,
  error: unknown
): void {
  recordRecoveryOperation({
    operation: 'store',
    outcome,
    detail: label,
    errorName: error instanceof Error ? error.name : null
  })
}

export function createResilientRecoveryStore(
  primary: RecoveryStore,
  operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS
): RecoveryStore {
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
    recordStoreProblem('fallback', 'indexeddb', error)
    const memory = createMemoryRecoveryStore()
    try {
      const snapshots = await withTimeout(primary.list(), operationTimeoutMs, 'list')
      for (const metadata of snapshots) {
        const snapshot = await withTimeout(primary.read(metadata.id), operationTimeoutMs, 'read')
        if (snapshot) await memory.write({ ...snapshot, closed: snapshot.closed ?? false })
      }
    } catch (migrationError) {
      console.warn('[Recovery] Failed to migrate IndexedDB snapshots to memory:', migrationError)
    }
    current = memory
    return memory
  }

  function run<T>(label: string, operation: (store: RecoveryStore) => Promise<T>): Promise<T> {
    return serialized(async () => {
      try {
        return await withTimeout(operation(current), operationTimeoutMs, label)
      } catch (error) {
        if (current !== primary) {
          recordStoreProblem('failed', label, error)
          throw error
        }
        if (error instanceof RecoveryStoreOperationTimeout) {
          recordStoreProblem('timeout', label, error)
        }
        const fallback = await switchToMemory(error)
        return withTimeout(operation(fallback), operationTimeoutMs, label)
      }
    })
  }

  // Mutations must also reach the primary store when it is healthy so snapshots
  // do not resurrect from IndexedDB on the next session after a fallback.
  function runMutation(
    label: string,
    mutation: (store: RecoveryStore) => Promise<void>
  ): Promise<void> {
    return serialized(async () => {
      try {
        await withTimeout(mutation(primary), operationTimeoutMs, label)
      } catch (error) {
        if (error instanceof RecoveryStoreOperationTimeout) {
          recordStoreProblem('timeout', label, error)
        }
        await switchToMemory(error)
      }
      if (current !== primary) {
        await withTimeout(mutation(current), operationTimeoutMs, label)
      }
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
    list: () => run('list', (store) => store.list()),
    read: (id: string): Promise<RecoverySnapshot | null> => run('read', (store) => store.read(id)),
    write: (input: RecoverySnapshotInput): Promise<RecoverySnapshotMeta> =>
      notified(run('write', (store) => store.write(input))),
    setClosed: (id, closed) =>
      notified(runMutation('setClosed', (store) => store.setClosed(id, closed))),
    remove: (id) => notified(runMutation('remove', (store) => store.remove(id))),
    clear: () => notified(runMutation('clear', (store) => store.clear())),
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
