import { watchDebounced } from '@vueuse/core'
import { watch, type WatchHandle } from 'vue'

import type { EditorState } from '@open-pencil/core/editor'

import { recordRecoveryOperation } from '@/app/diagnostics'
import { getRecoveryStore } from '@/app/document/recovery/store'
import type { RecoveryStore } from '@/app/document/recovery/types'
import { createCanvasId } from '@/app/storage/id'

type RecoveryState = EditorState & { documentName: string }

interface DocumentRecoveryOptions {
  state: RecoveryState
  buildFigFile: () => Promise<Uint8Array> | Uint8Array
  hasWritableSource: () => boolean
  isEnabled?: () => boolean
  store?: RecoveryStore
  recoveryId?: string
}

export interface DocumentRecoveryController {
  getRecoveryId(): string
  adoptRecoverySnapshot(id: string, sceneVersion: number): Promise<void>
  persistNow(): Promise<void>
  markClosed(): Promise<void>
  markProtectedVersion(version: number): Promise<void>
  resetForSource(): Promise<void>
  discardRecovery(): Promise<void>
  disposeRecovery(): void
}

export function createDocumentRecovery({
  state,
  buildFigFile,
  hasWritableSource,
  isEnabled = () => true,
  store = getRecoveryStore(),
  recoveryId = createCanvasId()
}: DocumentRecoveryOptions): DocumentRecoveryController {
  let id = recoveryId
  // null means nothing is protected, so the next persistNow writes a snapshot even
  // without further edits — used right after a browser file becomes the source,
  // where the snapshot is the only restart persistence the tab has.
  let protectedVersion: number | null = state.sceneVersion
  let requestedVersion: number = state.sceneVersion
  let lifecycleGeneration = 0
  let writing: Promise<void> | null = null
  let cleanup: Promise<void> = Promise.resolve()
  let disposed = false

  async function runWrites(generation: number): Promise<void> {
    if (disposed || generation !== lifecycleGeneration || !isEnabled()) return
    if (hasWritableSource() || requestedVersion === protectedVersion) return
    const version = requestedVersion
    const bytes = await buildFigFile()
    if (generation !== lifecycleGeneration || hasWritableSource() || !isEnabled()) return
    await store.write({
      id,
      documentName: state.documentName,
      sceneVersion: version,
      figBytes: bytes,
      closed: false
    })
    if (generation !== lifecycleGeneration) return
    protectedVersion = version
    recordRecoveryOperation({
      operation: 'persist',
      outcome: 'ok',
      documentName: state.documentName,
      detail: `v${version}`
    })
    if (requestedVersion !== version) await runWrites(generation)
  }

  async function persistNow(): Promise<void> {
    await cleanup
    if (disposed || hasWritableSource() || !isEnabled()) return
    requestedVersion = state.sceneVersion
    if (requestedVersion === protectedVersion) return
    if (!writing) {
      const generation = lifecycleGeneration
      writing = runWrites(generation).finally(() => {
        writing = null
      })
    }
    await writing
  }

  const stopVersionWatch: WatchHandle = watchDebounced(
    () => state.sceneVersion,
    () => {
      void persistNow().catch((error) => {
        console.warn('[Recovery] Snapshot failed:', error)
        recordRecoveryOperation({
          operation: 'persist',
          outcome: 'failed',
          documentName: state.documentName,
          errorName: error instanceof Error ? error.name : null
        })
      })
    },
    { debounce: 3000, maxWait: 10000 }
  )

  const stopEnabledWatch: WatchHandle = watch(
    isEnabled,
    (enabled) => {
      if (enabled) {
        protectedVersion = state.sceneVersion
        requestedVersion = state.sceneVersion
        return
      }
      lifecycleGeneration++
      const snapshotId = id
      requestedVersion = state.sceneVersion
      protectedVersion = state.sceneVersion
      const activeWrite = writing
      cleanup = cleanup
        .then(async () => {
          await activeWrite
          await store.remove(snapshotId)
          return undefined
        })
        .catch((error) => {
          console.warn('[Recovery] Failed to disable recovery:', error)
          recordRecoveryOperation({
            operation: 'persist',
            outcome: 'failed',
            documentName: state.documentName,
            detail: 'disable-cleanup',
            errorName: error instanceof Error ? error.name : null
          })
        })
    },
    { flush: 'sync' }
  )

  async function invalidateActiveWrite(): Promise<void> {
    lifecycleGeneration++
    await Promise.all([writing, cleanup])
  }

  return {
    getRecoveryId: () => id,
    async adoptRecoverySnapshot(nextId, sceneVersion) {
      const previousId = id
      await invalidateActiveWrite()
      id = nextId
      protectedVersion = sceneVersion
      requestedVersion = sceneVersion
      disposed = false
      if (previousId !== nextId) await store.remove(previousId)
      await store.setClosed(nextId, false)
    },
    persistNow,
    async markClosed() {
      stopVersionWatch()
      stopEnabledWatch()
      await persistNow()
      await store.setClosed(id, true)
    },
    async markProtectedVersion(version) {
      await invalidateActiveWrite()
      protectedVersion = version
      requestedVersion = state.sceneVersion
      // Sources that only exist in this browser session (file handles) keep their
      // snapshot: tab restore is the only way their content survives a restart.
      if (!hasWritableSource()) return
      await store.remove(id)
    },
    async resetForSource() {
      await invalidateActiveWrite()
      // The stored snapshot belonged to the previous document in this tab and
      // version numbers do not compare across documents, so drop it outright —
      // keeping it would resurrect the old document as a ghost tab on restart.
      await store.remove(id)
      const suppressed = hasWritableSource()
      protectedVersion = suppressed ? state.sceneVersion : null
      requestedVersion = state.sceneVersion
      recordRecoveryOperation({
        operation: 'reset-source',
        outcome: 'ok',
        documentName: state.documentName,
        suppressed
      })
      if (suppressed) return
      // Unsuppressing alone schedules nothing: the version watcher only fires on
      // future edits, so a document that is opened and left untouched (the exact
      // "open a .fig, close the browser" case) would never be snapshotted.
      try {
        await persistNow()
      } catch (error) {
        recordRecoveryOperation({
          operation: 'persist',
          outcome: 'failed',
          documentName: state.documentName,
          detail: 'reset-source',
          errorName: error instanceof Error ? error.name : null
        })
        throw error
      }
    },
    async discardRecovery() {
      await invalidateActiveWrite()
      protectedVersion = state.sceneVersion
      requestedVersion = state.sceneVersion
      await store.remove(id)
    },
    disposeRecovery() {
      disposed = true
      lifecycleGeneration++
      stopVersionWatch()
      stopEnabledWatch()
    }
  }
}
