import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'bun:test'

import {
  clearRecentFiles,
  forgetRecentDocument,
  forgetRecentFile,
  readRecentBrowserFileHandle,
  recentDocuments,
  recentFiles,
  recentLocalFileAt,
  rememberRecentBrowserFile,
  rememberRecentFile,
  rememberRecentStorageDocument
} from '@/app/recent-files'
import { resetRecentHandleStoreForTests } from '@/app/recent-files/handles'

afterEach(async () => {
  await clearRecentFiles()
  resetRecentHandleStoreForTests()
})

function fakeFileHandle(name: string): FileSystemFileHandle {
  // Plain object: fake-indexeddb structured-clones it, real handles are cloneable per spec.
  return { kind: 'file', name } as FileSystemFileHandle
}

describe('recent documents', () => {
  test('keeps the latest local file first without duplicates', () => {
    recentDocuments.value = []

    rememberRecentFile('/tmp/first.fig')
    rememberRecentFile('/tmp/second.fig')
    rememberRecentFile('/tmp/first.fig')

    expect(recentFiles.value.map(({ kind, name }) => ({ kind, name }))).toEqual([
      { kind: 'local', name: 'first.fig' },
      { kind: 'local', name: 'second.fig' }
    ])
    expect(recentLocalFileAt(0)).toBe('/tmp/first.fig')
  })

  test('tracks storage documents alongside local files', () => {
    rememberRecentFile('/tmp/local.fig')
    rememberRecentStorageDocument('s3-compatible', 'remote-1', 'Remote design')

    expect(recentFiles.value.map(({ id, kind, name }) => ({ id, kind, name }))).toEqual([
      {
        id: 'storage:s3-compatible:remote-1',
        kind: 'storage',
        name: 'Remote design'
      },
      { id: 'local:/tmp/local.fig', kind: 'local', name: 'local.fig' }
    ])
    expect(recentLocalFileAt(0)).toBe('/tmp/local.fig')
  })

  test('forgets missing local files and clears the list', () => {
    rememberRecentFile('/tmp/first.fig')
    rememberRecentFile('/tmp/second.fig')

    forgetRecentFile('/tmp/first.fig')
    expect(recentFiles.value.map((document) => document.name)).toEqual(['second.fig'])

    clearRecentFiles()
    expect(recentFiles.value).toEqual([])
    expect(recentLocalFileAt(0)).toBeNull()
  })
})

describe('browser file documents', () => {
  test('records a browser-picked file and persists its handle', async () => {
    const handle = fakeFileHandle('design.fig')

    await rememberRecentBrowserFile(handle)

    expect(recentFiles.value.map(({ id, kind, name }) => ({ id, kind, name }))).toEqual([
      { id: 'file:design.fig', kind: 'file', name: 'design.fig' }
    ])
    expect(await readRecentBrowserFileHandle('file:design.fig')).toEqual({
      kind: 'file',
      name: 'design.fig'
    })
  })

  test('re-recording the same file name replaces the entry without duplicating it', async () => {
    await rememberRecentBrowserFile(fakeFileHandle('design.fig'))
    await rememberRecentBrowserFile(fakeFileHandle('other.fig'))
    await rememberRecentBrowserFile(fakeFileHandle('design.fig'))

    expect(recentFiles.value.map((document) => document.name)).toEqual(['design.fig', 'other.fig'])
  })

  test('skips the entry when the handle cannot be persisted', async () => {
    resetRecentHandleStoreForTests({
      save: () => Promise.reject(new Error('Blocked by the browser')),
      read: () => Promise.resolve(null),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve()
    })

    await rememberRecentBrowserFile(fakeFileHandle('design.fig'))

    expect(recentFiles.value).toEqual([])
  })

  test('forgetting a browser file removes its persisted handle', async () => {
    await rememberRecentBrowserFile(fakeFileHandle('design.fig'))

    forgetRecentDocument('file:design.fig')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(recentFiles.value).toEqual([])
    expect(await readRecentBrowserFileHandle('file:design.fig')).toBeNull()
  })

  test('clearing the list also clears persisted handles', async () => {
    await rememberRecentBrowserFile(fakeFileHandle('design.fig'))
    rememberRecentFile('/tmp/local.fig')

    await clearRecentFiles()

    expect(recentFiles.value).toEqual([])
    expect(await readRecentBrowserFileHandle('file:design.fig')).toBeNull()
  })
})
