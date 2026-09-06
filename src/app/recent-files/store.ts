import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

import type { StorageProviderID } from '@/app/integrations/storage'

import { getRecentHandleStore } from './handles'
import { clearRecentFileThumbnails } from './thumbnails'

const MAX_RECENT_DOCUMENTS = 10
const RECENT_DOCUMENTS_STORAGE_KEY = 'open-pencil:recent-documents'

export interface RecentLocalDocument {
  id: string
  kind: 'local'
  path: string
  name: string
  updatedAt: string
}

export interface RecentStorageDocument {
  id: string
  kind: 'storage'
  providerId: StorageProviderID
  documentId: string
  name: string
  updatedAt: string
}

/** A `.fig` opened or saved through the browser File System Access API. */
export interface RecentBrowserFileDocument {
  id: string
  kind: 'file'
  name: string
  updatedAt: string
}

/** An unsaved document snapshot; projected from the recovery store, never persisted here. */
export interface RecentRecoveryDocument {
  id: string
  kind: 'recovery'
  snapshotId: string
  name: string
  updatedAt: string
}

export type RecentDocument = RecentLocalDocument | RecentStorageDocument | RecentBrowserFileDocument

export type RecentHomeDocument = RecentDocument | RecentRecoveryDocument

export const recentDocuments = useLocalStorage<RecentDocument[]>(RECENT_DOCUMENTS_STORAGE_KEY, [])

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function localDocumentId(path: string): string {
  return `local:${path}`
}

function storageDocumentId(providerId: StorageProviderID, documentId: string): string {
  return `storage:${providerId}:${documentId}`
}

function browserFileDocumentId(name: string): string {
  return `file:${name}`
}

function normalizedRecentDocuments(): RecentDocument[] {
  return recentDocuments.value.slice(0, MAX_RECENT_DOCUMENTS)
}

export const recentFiles = computed<RecentDocument[]>(normalizedRecentDocuments)

export const recentLocalFilePaths = computed<string[]>(() =>
  normalizedRecentDocuments().flatMap((document) =>
    document.kind === 'local' ? [document.path] : []
  )
)

function remember(document: RecentDocument): void {
  recentDocuments.value = [
    document,
    ...normalizedRecentDocuments().filter((recent) => recent.id !== document.id)
  ].slice(0, MAX_RECENT_DOCUMENTS)
}

export function rememberRecentFile(path: string): void {
  remember({
    id: localDocumentId(path),
    kind: 'local',
    path,
    name: fileName(path),
    updatedAt: new Date().toISOString()
  })
}

export function rememberRecentStorageDocument(
  providerId: StorageProviderID,
  documentId: string,
  name: string
): void {
  remember({
    id: storageDocumentId(providerId, documentId),
    kind: 'storage',
    providerId,
    documentId,
    name,
    updatedAt: new Date().toISOString()
  })
}

/**
 * Records a browser-picked `.fig` and persists its handle so the home page can
 * reopen it later. The entry is only recorded once the handle is stored.
 */
export async function rememberRecentBrowserFile(handle: FileSystemFileHandle): Promise<void> {
  const id = browserFileDocumentId(handle.name)
  try {
    await getRecentHandleStore().save(id, handle)
  } catch (error) {
    console.warn('[Recent files] Could not persist the file handle; skipping entry', error)
    return
  }
  remember({
    id,
    kind: 'file',
    name: handle.name,
    updatedAt: new Date().toISOString()
  })
}

export function readRecentBrowserFileHandle(id: string): Promise<FileSystemFileHandle | null> {
  return getRecentHandleStore().read(id)
}

export function forgetRecentDocument(id: string): void {
  const document = normalizedRecentDocuments().find((recent) => recent.id === id)
  recentDocuments.value = normalizedRecentDocuments().filter((recent) => recent.id !== id)
  if (document?.kind === 'file') {
    void getRecentHandleStore()
      .remove(id)
      .catch((error) => console.warn('[Recent files] Failed to remove the file handle', error))
  }
}

export function forgetRecentFile(path: string): void {
  forgetRecentDocument(localDocumentId(path))
}

export async function clearRecentFiles(): Promise<void> {
  recentDocuments.value = []
  await clearRecentFileThumbnails()
  await getRecentHandleStore()
    .clear()
    .catch((error) => console.warn('[Recent files] Failed to clear file handles', error))
}

export function recentLocalFileAt(index: number): string | null {
  return recentLocalFilePaths.value[index] ?? null
}
