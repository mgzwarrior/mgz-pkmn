import { expect, test } from '@playwright/test'

/**
 * Search → look up → export (#811, under #757).
 *
 * Search mode is the original spine: paste a want-list, look up the cards, and
 * export the matched rows. It's the most data-heavy journey — SPA → the lookup
 * SSE pipeline → the matched-rows table → the export endpoint — and the one a
 * returning user hits first. Card data comes from the committed cassette: the
 * look-up issues name-based queries (`name:"pikachu"`, `name:"eevee"`), a
 * different cache key than the browse `set.id:"mcd19"` path, so the cassette
 * was extended with those two structural slices (see web/e2e/fixtures/README).
 * The run stays network-free; prices are never asserted (cache_only degrades a
 * pricing miss to empty, and they drift regardless).
 */
test('search a want-list, see the matched rows, and export', async ({ page }) => {
  await page.goto('/')

  // Fresh-user first-run gate: dismiss the favorite-Pokémon onboarding if it
  // shows. Tolerant of absence so a retry (reusing the server's DB, where
  // onboarding is already done) sails past instead of hanging.
  const onboarding = page.getByRole('dialog', { name: 'Pick your favorite Pokémon' })
  await onboarding.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (await onboarding.isVisible()) {
    await onboarding.getByRole('button', { name: 'Skip for now' }).click()
    await expect(onboarding).toBeHidden()
  }

  // The app opens on Swipe (#814); switch to Search to reach the look-up.
  await page.getByRole('tablist', { name: 'Discovery mode' }).getByRole('tab', { name: 'Search' }).click()

  // Paste two cassette-backed lines, pinned to the set so each resolves to its
  // McDonald's printing. The exact line text drives the cache key, so it must
  // match what generated the committed slices.
  await page
    .getByRole('textbox', { name: 'Card list — one card per line' })
    .fill('Pikachu mcd19\nEevee mcd19')
  await page.getByRole('button', { name: /Look up/i }).click()

  // The lookup streams matched rows back over SSE. Each matched row exposes a
  // "Select <name>" checkbox — unambiguous proof the row resolved (vs. the
  // textarea value or parse preview, which also echo the names).
  await expect(page.getByRole('checkbox', { name: 'Select Pikachu' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Select Eevee' })).toBeVisible()

  // Export the matched rows. The button enables once rows land; picking
  // Download .xlsx posts the rows to /export and triggers a real browser
  // download (an anchor click), which Playwright captures as a download event.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: /Download \.xlsx/i }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('cards.xlsx')
})
