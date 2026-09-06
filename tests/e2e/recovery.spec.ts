import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test('keeps an unsaved document recoverable after its tab closes', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('RECTANGLE', 120, 120, 240, 140)
    await store.persistRecoveryNow()
    store.updateNode(id, { name: 'Retained recovery rectangle' })
  })

  await page.keyboard.press('ControlOrMeta+t')
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await page.getByTestId('tabbar-tab').first().getByTestId('tabbar-close').click()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open('open-pencil-recovery')
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const transaction = database.transaction('meta')
        const countRequest = transaction.objectStore('meta').count()
        return new Promise<number>((resolve, reject) => {
          countRequest.onsuccess = () => resolve(countRequest.result)
          countRequest.onerror = () => reject(countRequest.error)
        })
      })
    )
    .toBe(1)

  await page.reload()
  await expect(page.getByRole('alertdialog', { name: 'Recover unsaved work' })).toBeVisible()
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText('Retained recovery rectangle')).toBeVisible()

  await context.close()
})

test('restores an unsaved document automatically when its tab was still open at reload', async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('RECTANGLE', 120, 120, 240, 140)
    store.updateNode(id, { name: 'Auto-restored rectangle' })
    await store.persistRecoveryNow()
  })

  await page.reload()
  const reloadedCanvas = new CanvasHelper(page)
  await reloadedCanvas.waitForInit()

  await expect(page.getByRole('alertdialog', { name: 'Recover unsaved work' })).toBeHidden()
  await expect(page.getByText('Auto-restored rectangle')).toBeVisible()

  await context.close()
})
