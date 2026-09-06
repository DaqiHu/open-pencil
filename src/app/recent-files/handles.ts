import type { DBSchema } from 'idb'

import { APP_DATABASE_NAMES, defineAppDatabase, openAppDatabase } from '@/app/storage/idb'

/**
 * Persists browser File System Access handles for recent-file entries so the
 * home page can reopen files picked in earlier sessions (permission is
 * re-requested by the browser on first access).
 */

interface RecentHandleDatabase extends DBSchema {
  handles: {
    key: string
    value: FileSystemFileHandle
  }
}

export interface RecentHandleStore {
  save(id: string, handle: FileSystemFileHandle): Promise<void>
  read(id: string): Promise<FileSystemFileHandle | null>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

const recentHandleDatabase = defineAppDatabase<RecentHandleDatabase>({
  name: APP_DATABASE_NAMES.recentHandles,
  version: 1,
  callbacks: {
    upgrade(database) {
      if (!database.objectStoreNames.contains('handles')) database.createObjectStore('handles')
    }
  }
})

function createIdbRecentHandleStore(): RecentHandleStore {
  const database = openAppDatabase(recentHandleDatabase)
  return {
    async save(id, handle) {
      await (await database).put('handles', handle, id)
    },
    async read(id) {
      return (await (await database).get('handles', id)) ?? null
    },
    async remove(id) {
      await (await database).delete('handles', id)
    },
    async clear() {
      await (await database).clear('handles')
    }
  }
}

function createMemoryRecentHandleStore(): RecentHandleStore {
  const handles = new Map<string, FileSystemFileHandle>()
  return {
    async save(id, handle) {
      handles.set(id, handle)
    },
    async read(id) {
      return handles.get(id) ?? null
    },
    async remove(id) {
      handles.delete(id)
    },
    async clear() {
      handles.clear()
    }
  }
}

let singleton: RecentHandleStore | null = null
let memoryFallback = false

/** Process-wide recent-handle store; falls back to memory when IDB is unavailable. */
export function getRecentHandleStore(): RecentHandleStore {
  if (singleton) return singleton
  if (typeof indexedDB !== 'undefined') {
    singleton = createIdbRecentHandleStore()
    return singleton
  }
  if (!memoryFallback) {
    console.warn(
      '[Recent files] IndexedDB unavailable; browser file handles last this session only'
    )
    memoryFallback = true
  }
  singleton = createMemoryRecentHandleStore()
  return singleton
}

/** Reset singleton (tests). */
export function resetRecentHandleStoreForTests(store?: RecentHandleStore): void {
  singleton = store ?? null
  memoryFallback = false
}
