export interface RecoverySnapshotMeta {
  id: string
  documentName: string
  updatedAt: string
  sceneVersion: number
  byteLength: number
  formatVersion: 1
  /** True once the owning tab was closed deliberately; closed snapshots wait for manual restore. */
  closed?: boolean
}

export interface RecoverySnapshot extends RecoverySnapshotMeta {
  figBytes: Uint8Array
}

export interface RecoverySnapshotInput {
  id: string
  documentName: string
  sceneVersion: number
  figBytes: Uint8Array
  closed: boolean
}

export interface RecoveryStore {
  list(): Promise<RecoverySnapshotMeta[]>
  read(id: string): Promise<RecoverySnapshot | null>
  write(input: RecoverySnapshotInput): Promise<RecoverySnapshotMeta>
  setClosed(id: string, closed: boolean): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
  /** Notifies after a mutation completes; used by surfaces listing snapshots live. */
  subscribe?(listener: () => void): () => void
}
