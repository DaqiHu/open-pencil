import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  registerFigPopulationWorker,
  registerOriginalArchiveRequest,
  releaseFigPopulationWorker,
  requestOriginalArchive
} from '#core/kiwi/fig/population/client'

describe('FIG session ownership', () => {
  test('discards an archive response when the graph changes while it is pending', async () => {
    const graph = new SceneGraph()
    let resolveArchive: ((bytes: Uint8Array) => void) | null = null
    registerOriginalArchiveRequest(
      graph,
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveArchive = resolve
        })
    )
    const request = requestOriginalArchive(graph)

    graph.updateNode(graph.rootId, { name: 'Edited' })
    resolveArchive?.(new Uint8Array([1, 2, 3]))

    await expect(request).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('archive replies still resolve when the population client shares the session port', async () => {
    const graph = new SceneGraph()
    const channel = new MessageChannel()
    const pendingArchives = new Map<string, (bytes: Uint8Array) => void>()
    // Mirrors read.ts: the archive channel installs its onmessage handler first
    // and only then hands the same port to registerFigPopulationWorker, whose
    // message handling must not clobber it.
    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; requestId: string; bytes: Uint8Array }
      if (data.type !== 'original-archive-result') return
      pendingArchives.get(data.requestId)?.(data.bytes)
      pendingArchives.delete(data.requestId)
    }
    registerOriginalArchiveRequest(
      graph,
      () =>
        new Promise<Uint8Array>((resolveArchive) => {
          const requestId = 'archive-1'
          pendingArchives.set(requestId, resolveArchive)
          channel.port1.postMessage({ type: 'original-archive', requestId })
        })
    )
    const worker = { terminate: () => undefined } as unknown as Worker
    registerFigPopulationWorker(graph, worker, channel.port1)

    // Worker side, mirroring session/worker.ts: answer archive requests.
    channel.port2.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; requestId: string }
      if (data.type !== 'original-archive') return
      channel.port2.postMessage({
        type: 'original-archive-result',
        requestId: data.requestId,
        bytes: new Uint8Array([4, 5, 6])
      })
    }
    channel.port2.start()

    const archive = await requestOriginalArchive(graph)
    expect(archive ? [...archive] : null).toEqual([4, 5, 6])

    releaseFigPopulationWorker(graph)
    channel.port1.close()
    channel.port2.close()
  })

  test('retains and releases oversized session workers', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    for (let index = 0; index < 200_001; index++) {
      graph.nodes.set(`oversized-${index}`, {
        ...page,
        id: `oversized-${index}`,
        childIds: []
      })
    }
    let workerTerminated = false
    let portClosed = false
    const worker = { terminate: () => (workerTerminated = true) } as Worker
    const port = {
      postMessage: () => undefined,
      close: () => (portClosed = true)
    } as MessagePort

    registerFigPopulationWorker(graph, worker, port)
    releaseFigPopulationWorker(graph)

    expect(workerTerminated).toBe(true)
    expect(portClosed).toBe(true)
  })

  test.serial('rejects session worker construction outside Worker runtimes', async () => {
    const originalWorker = globalThis.Worker
    Reflect.deleteProperty(globalThis, 'Worker')
    try {
      const { createFigSessionWorker } = await import('#core/kiwi/fig/session/client')
      expect(() => createFigSessionWorker()).toThrow('unavailable')
    } finally {
      globalThis.Worker = originalWorker
    }
  })
})
