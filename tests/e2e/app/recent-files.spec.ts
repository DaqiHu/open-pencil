import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test('lists unsaved documents on the home page and switches to or restores them', async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto('/?recent-files')
  await expect(page.getByTestId('recent-files-home')).toBeVisible()

  await page.getByTestId('home-new-document').click()
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.state.documentName = 'Recent files design'
    const id = store.createShape('RECTANGLE', 120, 120, 240, 140)
    store.updateNode(id, { name: 'Recent files rectangle' })
    await store.persistRecoveryNow()
  })

  // The unsaved document shows up with its embedded thumbnail and an Unsaved badge.
  await page.keyboard.press('ControlOrMeta+t')
  const card = page.getByTestId('recent-file-card').filter({ hasText: 'Recent files design' })
  await expect(card).toBeVisible()
  await expect(card.getByText('Unsaved')).toBeVisible()
  await expect(card.locator('img')).toBeVisible()

  // Clicking the card switches to the still-open tab instead of duplicating it.
  await card.click()
  await expect(page.getByTestId('recent-files-home')).toBeHidden()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await expect(page.getByText('Recent files rectangle')).toBeVisible()

  // Closing the tab keeps the entry as a closed snapshot listed on the home page.
  await page.getByTestId('tabbar-tab').first().hover()
  await page.getByTestId('tabbar-tab').first().getByTestId('tabbar-close').click()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(1)
  await expect(page.getByTestId('recent-files-home')).toBeVisible()
  await expect(card).toBeVisible()

  // Clicking again restores the snapshot into the reused home tab.
  await card.click()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(1)
  await expect(page.getByTestId('recent-files-home')).toBeHidden()
  await expect(page.getByText('Recent files rectangle')).toBeVisible()

  await context.close()
})

test('keeps the New tab layout usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?recent-files')

  const search = page.getByLabel('Search files…')
  await expect(search).toBeVisible()
  await expect(search).not.toBeFocused()
  await expect(search).toHaveAttribute('placeholder', 'Search files…')
  await expect(page.getByTestId('home-open-file')).toBeVisible()
  await expect(page.getByTestId('home-new-document')).toBeVisible()
  await expect(page.getByTestId('recent-files-home')).toHaveJSProperty(
    'scrollWidth',
    await page.getByTestId('recent-files-home').evaluate((element) => element.clientWidth)
  )
})

test('opens to the recent-files home and starts a new document', async ({ page }) => {
  await page.goto('/?recent-files')

  await expect(page.getByTestId('recent-files-home')).toBeVisible()
  await expect(page.getByText('No recent files yet')).toBeVisible()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(1)

  await page.getByTestId('home-new-document').click()

  await expect(page.getByTestId('recent-files-home')).toBeHidden()
  const tab = page.getByTestId('tabbar-tab')
  await expect(tab).toHaveCount(1)
  await expect(tab).toContainText('Untitled')
  await expect(page.getByTestId('tabbar-close')).toHaveCount(1)

  await page.getByTestId('tabbar-new').click()

  await expect(page.getByTestId('recent-files-home')).toBeVisible()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await expect(page.getByTestId('tabbar-tab').last()).toContainText('New tab')
  await expect(page.getByLabel('Search files…')).toBeFocused()
  await expect(page.getByTestId('tabbar-close')).toHaveCount(2)

  await page.getByTestId('tabbar-tab').first().click()
  await page.getByTestId('tabbar-tab').first().hover()
  await page.getByTestId('tabbar-tab').first().getByTestId('tabbar-close').click()

  await expect(page.getByTestId('recent-files-home')).toBeVisible()
})
