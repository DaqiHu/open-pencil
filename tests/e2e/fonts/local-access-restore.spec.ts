import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

// Regression: the browser persists the local-fonts permission across reloads,
// but the app used to reset its in-memory access state to 'prompt' on every
// load, so installed local fonts substituted until "Retry fonts" was clicked.
// Startup now restores persisted access and face demands resolve locally.
test('restores granted local font access at startup and resolves local faces', async ({
  context,
  page
}) => {
  await context.grantPermissions(['local-fonts'])
  await page.addInitScript(() => {
    window.queryLocalFonts = async () => [
      {
        family: 'Local Restore Serif',
        fullName: 'Local Restore Serif',
        postscriptName: 'LocalRestoreSerif-Regular',
        style: 'Regular',
        blob: async () => (await fetch('/Inter-Regular.ttf')).blob()
      }
    ]
  })
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    ;(window as { __fontEvents?: string[] }).__fontEvents = []
    store.onEditorEvent(
      'font:resolution-changed',
      (event: string, snapshot: { key: string; state: string }) => {
        ;(window as { __fontEvents?: string[] }).__fontEvents?.push(
          `${event}:${snapshot.key}:${snapshot.state}`
        )
      }
    )
    const id = store.createShape('TEXT', 120, 120, 240, 40)
    store.updateNode(id, { text: 'Local restore smoke', fontFamily: 'Local Restore Serif' })
  })

  // The face demand must settle as loaded through the mocked local font query,
  // not exhaust into a substitution.
  await expect
    .poll(async () =>
      page.evaluate(() => (window as { __fontEvents?: string[] }).__fontEvents ?? [])
    )
    .toContain('settled:face:local restore serif:regular:loaded')

  await expect(page.getByTestId('font-status-banner')).toHaveCount(0)
})
