import type { ChatTransport, UIMessage } from 'ai'

import type { CollabReturn } from '@/app/collab/context'
import type { RecoverySnapshotMeta } from '@/app/document/recovery/types'
import type { EditorStore } from '@/app/editor/session/create'
import { createNavigationBenchmarkHooks } from '@/app/performance/navigation/hooks'
import type { NavigationBenchmarkHooks } from '@/app/performance/navigation/hooks'
import { appRuntimeConfig } from '@/app/runtime/config'
import { IS_BROWSER } from '@/constants'

export interface OpenPencilTestHooks {
  writeCount?: () => number
  mockHandle?: FileSystemFileHandle
  savedOpen?: Window['open']
  navigation?: NavigationBenchmarkHooks
  collab?: Pick<
    CollabReturn,
    'connect' | 'disconnect' | 'updateCursor' | 'updateSelection' | 'setLocalName'
  > & {
    peerCount: () => number
    peerSelections: () => Array<string[] | undefined>
  }
}

export interface OpenPencilDebugTabInfo {
  id: string
  name: string
  kind: TabKind
  active: boolean
  recoveryId: string
  source: 'handle' | 'path' | 'storage' | 'none'
  sceneVersion: number
}

type TabKind = 'home' | 'document'

/**
 * Console-facing introspection for tab/recovery state, so silent restore or
 * close problems can be diagnosed from the running app without attaching a
 * debugger: `window.openPencil.debug.tabs()`, `.recoverySnapshots()`,
 * `.exportDiagnostics()`.
 */
export interface OpenPencilDebugHooks {
  tabs(): OpenPencilDebugTabInfo[]
  recoverySnapshots(): Promise<RecoverySnapshotMeta[]>
  exportDiagnostics(): Promise<string>
}

export interface OpenPencilWindowAPI {
  getStore?: () => EditorStore
  setChatTransport?: (factory: () => ChatTransport<UIMessage>) => void
  openFile?: (path: string) => Promise<void>
  test?: OpenPencilTestHooks
  debug?: OpenPencilDebugHooks
}

declare global {
  interface Window {
    openPencil?: OpenPencilWindowAPI
  }
}

let activeStore: EditorStore | null = null

function windowAPI(): OpenPencilWindowAPI {
  window.openPencil ??= {}
  window.openPencil.getStore ??= () => {
    if (!activeStore) throw new Error('OpenPencil store not initialized')
    return activeStore
  }
  return window.openPencil
}

export function setOpenPencilStore(store: EditorStore) {
  activeStore = store
  if (!IS_BROWSER) return
  const api = windowAPI()
  if (appRuntimeConfig.navigationBenchmark) {
    const testHooks = (api.test ??= {})
    testHooks.navigation = createNavigationBenchmarkHooks(store)
  }
}

export function exposeCollaborationActions(collab: CollabReturn) {
  if (!IS_BROWSER || !import.meta.env.DEV) return
  if (!appRuntimeConfig.test) return
  const testHooks = (windowAPI().test ??= {})
  testHooks.collab = {
    connect: collab.connect,
    disconnect: collab.disconnect,
    updateCursor: collab.updateCursor,
    updateSelection: collab.updateSelection,
    setLocalName: collab.setLocalName,
    peerCount: () => collab.remotePeers.value.length,
    peerSelections: () => collab.remotePeers.value.map((peer) => peer.selection)
  }
}

export function exposeChatTransportOverride(
  setChatTransport: (factory: () => ChatTransport<UIMessage>) => void
) {
  windowAPI().setChatTransport = setChatTransport
}

export function setOpenPencilOpenFileHandler(openFile: (path: string) => Promise<void>) {
  windowAPI().openFile = openFile
}

export function exposeDebugHooks(hooks: OpenPencilDebugHooks) {
  if (!IS_BROWSER) return
  windowAPI().debug = hooks
}
