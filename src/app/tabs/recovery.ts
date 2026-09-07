import { promiseTimeout } from '@vueuse/core'

import { recordRecoveryOperation } from '@/app/diagnostics'
import type { EditorStore } from '@/app/editor/session'
import { readRecentBrowserFileHandle } from '@/app/recent-files'
import type { Tab } from '@/app/tabs'

export const RECOVERY_CLOSE_TIMEOUT_MS = 10_000

let closeTimeoutMs = RECOVERY_CLOSE_TIMEOUT_MS

export function setRecoveryCloseTimeoutForTests(timeoutMs: number): () => void {
  const previous = closeTimeoutMs
  closeTimeoutMs = timeoutMs
  return () => {
    closeTimeoutMs = previous
  }
}

/**
 * Closing a tab must never be blocked by recovery bookkeeping: a stalled
 * snapshot write (renderer busy mid-import, wedged IndexedDB queue) would
 * otherwise make the close button silently do nothing. The close always
 * proceeds; the outcome — including late settlements after a timeout — is
 * recorded so stalls are diagnosable after the fact.
 */
export async function finalizeClosedTabRecovery(tab: Tab): Promise<void> {
  const documentName = tab.store.state.documentName
  const marking = tab.store.markRecoveryClosed()
  const settled = marking.then(
    () => 'ok' as const,
    (error: unknown) => error
  )
  const outcome = await Promise.race([
    settled,
    promiseTimeout(closeTimeoutMs).then(() => 'timeout' as const)
  ])
  if (outcome === 'ok') {
    recordRecoveryOperation({ operation: 'close-tab', outcome: 'ok', documentName })
    return
  }
  if (outcome === 'timeout') {
    console.warn(
      `[Recovery] Marking "${documentName}" closed did not settle within ${closeTimeoutMs}ms; closing the tab anyway`
    )
    recordRecoveryOperation({ operation: 'close-tab', outcome: 'timeout', documentName })
    void settled.then((late) => {
      recordRecoveryOperation({
        operation: 'close-tab',
        outcome: late === 'ok' ? 'ok' : 'failed',
        documentName,
        detail: 'settled-after-timeout',
        errorName: late instanceof Error ? late.name : null
      })
    })
    return
  }
  console.warn('[Recovery] Failed to mark the tab closed:', outcome)
  recordRecoveryOperation({
    operation: 'close-tab',
    outcome: 'failed',
    documentName,
    errorName: outcome instanceof Error ? outcome.name : null
  })
}

// A tab that already adopted a restored snapshot must never be reused for the
// next restore: its content would be clobbered and the adopted snapshot
// orphaned as a ghost that reappears on the next browser start.
const restoreReusedStores = new WeakSet<EditorStore>()

export function markStoreRestoreReused(store: EditorStore): void {
  restoreReusedStores.add(store)
}

/**
 * The browser start page always opens one blank document tab. Restoring the
 * first recovery snapshot reuses it instead of stacking a restored tab next to
 * a redundant Untitled one. Only a genuinely pristine tab qualifies: untouched,
 * unsourced, not loading, and never used for an earlier restore.
 */
export function isPristineBlankDocumentTab(tab: Tab): boolean {
  if (tab.kind !== 'document') return false
  if (restoreReusedStores.has(tab.store)) return false
  const { state } = tab.store
  if (state.documentName !== 'Untitled' || tab.store.undo.canUndo) return false
  if (state.preparation) return false
  const identity = tab.store.getSourceIdentity()
  return !identity.handle && !identity.path && !tab.store.getStorageBinding()
}

/**
 * Re-links a restored tab to the file it was opened from, so saving keeps
 * writing back instead of demanding a new download. Only attaches when the
 * stored permission survived the browser restart — requesting it would need a
 * user gesture, which a startup restore does not have.
 */
export async function reattachRestoredFileHandle(
  store: EditorStore,
  documentName: string
): Promise<void> {
  const fileName = `${documentName}.fig`
  try {
    const handle = await readRecentBrowserFileHandle(`file:${fileName}`)
    if (!handle?.queryPermission) return
    if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      recordRecoveryOperation({
        operation: 'restore-handle',
        outcome: 'skipped',
        documentName,
        detail: 'permission-not-granted'
      })
      return
    }
    store.attachRecoveredFileHandle(handle, fileName)
    recordRecoveryOperation({ operation: 'restore-handle', outcome: 'ok', documentName })
  } catch (error) {
    console.warn('[Recovery] Failed to reattach the file handle:', error)
    recordRecoveryOperation({
      operation: 'restore-handle',
      outcome: 'failed',
      documentName,
      errorName: error instanceof Error ? error.name : null
    })
  }
}
