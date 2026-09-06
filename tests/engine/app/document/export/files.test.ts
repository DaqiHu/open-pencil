import { afterEach, describe, expect, test } from 'bun:test'

import { saveExportedFile } from '@/app/document/export/files'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('web export download', () => {
  test('downloads directly even when the File System Access save picker exists', async () => {
    let pickerCalls = 0
    Reflect.set(globalThis, 'window', {
      showSaveFilePicker: () => {
        pickerCalls++
        throw new Error('save picker must not open on web export')
      }
    })

    const downloads: Array<{ data: Uint8Array; fileName: string; mime: string }> = []
    await saveExportedFile(
      new Uint8Array([1, 2, 3]),
      'Export@1x.png',
      'PNG',
      '.png',
      'image/png',
      (data, fileName, mime) => downloads.push({ data, fileName, mime })
    )

    expect(pickerCalls).toBe(0)
    expect(downloads).toEqual([
      { data: new Uint8Array([1, 2, 3]), fileName: 'Export@1x.png', mime: 'image/png' }
    ])
  })

  test('downloads directly when the save picker is unavailable', async () => {
    const downloads: string[] = []
    await saveExportedFile(
      new Uint8Array([4, 5]),
      'export.svg',
      'SVG',
      '.svg',
      'image/svg+xml',
      (_data, fileName) => downloads.push(fileName)
    )

    expect(downloads).toEqual(['export.svg'])
  })
})
