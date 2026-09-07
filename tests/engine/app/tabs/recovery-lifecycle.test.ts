import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import * as figModule from '@open-pencil/core/io/formats/fig'
import * as layoutModule from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createMemoryRecoveryStore } from '@/app/document/recovery/memory'
import { resetRecoveryStoreForTests } from '@/app/document/recovery/store'
import type { RecoveryStore } from '@/app/document/recovery/types'
import {
  closeTab,
  createTab,
  getActiveStore,
  getTabsSnapshot,
  resetTabsForTests,
  restoreRecoverySnapshot,
  tabCount
} from '@/app/tabs'
import { setRecoveryCloseTimeoutForTests } from '@/app/tabs/recovery'

const figBytes = new Uint8Array([1, 2, 3])

function setupGlobals() {
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    },
    cancelAnimationFrame: vi.fn(),
    openPencil: {},
    location: { href: 'http://localhost/' } as Location,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  } as Window & typeof globalThis
  globalThis.document = {
    fonts: { add: vi.fn(), ready: Promise.resolve() }
  } as Document
  globalThis.requestAnimationFrame = window.requestAnimationFrame
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame
}

function acknowledgePendingPresentation(): void {
  for (const tab of getTabsSnapshot()) {
    if (tab.store.state.preparation?.phase !== 'preparing-render') continue
    tab.store.preparationController.acknowledgePresentation(tab.store.state.sceneVersion)
  }
}

async function settleRestore(restore: Promise<void>): Promise<void> {
  const outcome = restore.then(
    () => ({ status: 'fulfilled' as const }),
    (reason: unknown) => ({ status: 'rejected' as const, reason })
  )
  const awaitOutcome = async (): Promise<
    { status: 'fulfilled' } | { status: 'rejected'; reason: unknown }
  > => {
    acknowledgePendingPresentation()
    const result = await Promise.race([
      outcome,
      new Promise<null>((resolve) => {
        setTimeout(resolve, 0)
      })
    ])
    return result ?? (await awaitOutcome())
  }
  const result = await awaitOutcome()
  if (result.status === 'rejected') throw result.reason
}

function useMemoryRecoveryStore(): RecoveryStore {
  const store = createMemoryRecoveryStore()
  resetRecoveryStoreForTests(store)
  return store
}

function seedSnapshot(
  store: RecoveryStore,
  id: string,
  documentName: string,
  closed = false
): Promise<unknown> {
  return store.write({ id, documentName, sceneVersion: 3, figBytes, closed })
}

describe('tab recovery lifecycle', () => {
  beforeEach(() => {
    setupGlobals()
    resetTabsForTests()
    vi.spyOn(layoutModule, 'computeAllLayouts').mockReturnValue(undefined)
    vi.spyOn(figModule, 'readFigFile').mockResolvedValue(new SceneGraph())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetTabsForTests()
    resetRecoveryStoreForTests()
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  })

  test('restores an open snapshot into the pristine startup tab', async () => {
    const store = useMemoryRecoveryStore()
    // What WorkspaceView creates on web startup.
    const startup = createTab()
    await seedSnapshot(store, 'snap-1', 'Recovered doc')

    await settleRestore(restoreRecoverySnapshot('snap-1'))

    expect(tabCount()).toBe(1)
    expect(getTabsSnapshot()[0]?.id).toBe(startup.id)
    expect(getActiveStore().state.documentName).toBe('Recovered doc')
    expect(getActiveStore().getRecoveryId()).toBe('snap-1')
  })

  test('never reuses a tab that already adopted a restore, even an Untitled one', async () => {
    const store = useMemoryRecoveryStore()
    createTab()
    await seedSnapshot(store, 'snap-1', 'Untitled')
    await seedSnapshot(store, 'snap-2', 'Second')

    await settleRestore(restoreRecoverySnapshot('snap-1'))
    await settleRestore(restoreRecoverySnapshot('snap-2'))

    expect(tabCount()).toBe(2)
    const [first, second] = getTabsSnapshot()
    expect(first?.store.getRecoveryId()).toBe('snap-1')
    expect(first?.store.state.documentName).toBe('Untitled')
    expect(second?.store.state.documentName).toBe('Second')
  })

  test('closeTab removes the tab when recovery bookkeeping fails', async () => {
    useMemoryRecoveryStore()
    const closing = createTab()
    const other = createTab()
    closing.store.markRecoveryClosed = () => Promise.reject(new Error('IndexedDB is blocked'))

    await closeTab(closing.id)

    expect(getTabsSnapshot().map((tab) => tab.id)).toEqual([other.id])
  })

  test('closeTab does not wait for stalled recovery bookkeeping', async () => {
    useMemoryRecoveryStore()
    const restoreTimeout = setRecoveryCloseTimeoutForTests(25)
    try {
      const closing = createTab()
      createTab()
      closing.store.markRecoveryClosed = () => new Promise<void>(() => undefined)

      await closeTab(closing.id)

      expect(getTabsSnapshot().some((tab) => tab.id === closing.id)).toBe(false)
    } finally {
      restoreTimeout()
    }
  })
})
