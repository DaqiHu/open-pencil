import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createIdbRecoveryStore } from '@/app/document/recovery/idb'
import { createMemoryRecoveryStore } from '@/app/document/recovery/memory'
import { getRecoveryStore, resetRecoveryStoreForTests } from '@/app/document/recovery/store'

const bytes = new Uint8Array([1, 2, 3, 4])

describe('document recovery store', () => {
  beforeEach(async () => {
    // Clearing through the store keeps isolation without deleteDatabase, which stays
    // permanently blocked in fake-indexeddb while earlier test connections are open.
    await createIdbRecoveryStore().clear()
    resetRecoveryStoreForTests()
  })

  afterEach(() => resetRecoveryStoreForTests())

  test('stores metadata and FIG bytes atomically in IndexedDB', async () => {
    const store = createIdbRecoveryStore()
    const metadata = await store.write({
      id: 'recovery-1',
      documentName: 'Agent draft',
      sceneVersion: 12,
      figBytes: bytes,
      closed: false
    })

    expect(metadata).toMatchObject({
      id: 'recovery-1',
      documentName: 'Agent draft',
      sceneVersion: 12,
      byteLength: 4,
      formatVersion: 1
    })
    expect(await store.list()).toEqual([metadata])
    expect(await store.read('recovery-1')).toEqual({ ...metadata, figBytes: bytes })

    await store.remove('recovery-1')
    expect(await store.list()).toEqual([])
    expect(await store.read('recovery-1')).toBeNull()
  })

  test('memory store owns input and output bytes', async () => {
    const store = createMemoryRecoveryStore()
    const input = new Uint8Array(bytes)
    await store.write({
      id: 'one',
      documentName: 'Draft',
      sceneVersion: 1,
      figBytes: input,
      closed: false
    })
    input[0] = 99

    const first = await store.read('one')
    expect(first?.figBytes[0]).toBe(1)
    if (first) first.figBytes[0] = 88
    expect((await store.read('one'))?.figBytes[0]).toBe(1)
  })

  test('memory store flags snapshots closed without rewriting bytes', async () => {
    const store = createMemoryRecoveryStore()
    await store.write({
      id: 'recovery-1',
      documentName: 'Agent draft',
      sceneVersion: 12,
      figBytes: bytes,
      closed: false
    })

    await store.setClosed('recovery-1', true)
    const flagged = await store.read('recovery-1')
    expect(flagged?.closed).toBe(true)
    expect(flagged?.figBytes).toEqual(bytes)

    await store.setClosed('recovery-1', false)
    expect((await store.read('recovery-1'))?.closed).toBe(false)

    await store.setClosed('missing', true)
    expect(await store.list()).toHaveLength(1)
  })

  test('IndexedDB store flags snapshots closed without rewriting bytes', async () => {
    const store = createIdbRecoveryStore()
    await store.write({
      id: 'recovery-1',
      documentName: 'Agent draft',
      sceneVersion: 12,
      figBytes: bytes,
      closed: false
    })

    await store.setClosed('recovery-1', true)
    const flagged = await store.read('recovery-1')
    expect(flagged?.closed).toBe(true)
    expect(flagged?.figBytes).toEqual(bytes)

    await store.setClosed('recovery-1', false)
    expect((await store.read('recovery-1'))?.closed).toBe(false)

    await store.setClosed('missing', true)
    expect(await store.list()).toHaveLength(1)
  })

  test('resilient store notifies subscribers after each settled mutation', async () => {
    const store = getRecoveryStore()
    let notifications = 0
    const unsubscribe = store.subscribe?.(() => {
      notifications += 1
    })
    expect(unsubscribe).toBeTypeOf('function')

    await store.write({
      id: 'recovery-1',
      documentName: 'Agent draft',
      sceneVersion: 1,
      figBytes: bytes,
      closed: false
    })
    expect(notifications).toBe(1)
    // Notifications fire after the mutation settles, so the snapshot is already listed.
    expect((await store.list()).map((snapshot) => snapshot.id)).toEqual(['recovery-1'])

    await store.setClosed('recovery-1', true)
    await store.remove('recovery-1')
    expect(notifications).toBe(3)

    unsubscribe?.()
    await store.write({
      id: 'recovery-2',
      documentName: 'Other draft',
      sceneVersion: 1,
      figBytes: bytes,
      closed: false
    })
    expect(notifications).toBe(3)
  })
})
