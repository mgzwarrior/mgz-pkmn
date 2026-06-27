import { expect, test } from '@playwright/test'

/**
 * Search → look up → export (#811, under #757).
 *
 * Search mode is the original spine: paste a want-list, look up the cards, and
 * export the matched rows. It's the most data-heavy journey — SPA → the lookup
 * SSE pipeline → the matched-rows table → the export endpoint — and the one a
 * returning user hits first. Card data comes from the committed cassette: the
 * set-pinned look-up issues name + set-name queries, a different cache key than
 * the browse `set.id:"mcd19"` path, so the cassette was extended with those two
 * structural slices (see web/e2e/fixtures/README). The run stays network-free;
 * prices are never asserted (cache_only degrades a pricing miss to empty, and
 * they drift regardless).
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

  // Paste two cassette-backed lines in the canonical `Name | Set` grammar, so
  // each pins to its McDonald's printing (a plain `Name mcd19` line parses
  // `mcd19` as a card *number*, not a set hint). The exact line text drives the
  // cache key, so it must match what generated the committed slices.
  await page
    .getByRole('textbox', { name: 'Card list — one card per line' })
    .fill("Pikachu | McDonald's Collection 2019\nEevee | McDonald's Collection 2019")
  await page.getByRole('button', { name: /Look up/i }).click()

  // The lookup streams matched rows back over SSE. Matched rows expose a "View
  // details for <name>" row label; the set-pinned query resolves to exactly the
  // McDonald's printings (#6 Pikachu, #12 Eevee), so asserting the numbers
  // proves the look-up hit the intended cards, not just any Pikachu / Eevee.
  await expect(page.getByRole('row', { name: 'View details for Pikachu' })).toContainText('#6')
  await expect(page.getByRole('row', { name: 'View details for Eevee' })).toContainText('#12')

  // Export the matched rows. The button enables once rows land; picking
  // Download .xlsx posts the rows to /export and triggers a real browser
  // download (an anchor click), which Playwright captures as a download event.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: /Download \.xlsx/i }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('cards.xlsx')
})
