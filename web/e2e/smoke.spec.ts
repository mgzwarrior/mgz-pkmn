import { expect, test } from '@playwright/test'

/**
 * First end-to-end smoke flow (#758).
 *
 * Proves the harness end to end across the SPA↔FastAPI↔SQLite seam without
 * any external pricing source in the loop: land on the app, create a
 * want-list by name through the Backpack's New ▾ menu, and confirm the new
 * binder row persists and renders. Card-dependent journeys (browse a set →
 * save a card) follow one-per-PR once a cache cassette lands — see #757 and
 * docs/e2e.md for the fixture strategy.
 */
test('create a want-list and see it in the Backpack', async ({ page }) => {
  await page.goto('/')

  // Fresh-user first-run gate: dismiss the favorite-Pokémon onboarding if it
  // shows. Tolerant of absence so a retry (which reuses the server's DB, where
  // onboarding is already done) sails past instead of hanging.
  const onboarding = page.getByRole('dialog', { name: 'Pick your favorite Pokémon' })
  await onboarding.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (await onboarding.isVisible()) {
    await onboarding.getByRole('button', { name: 'Skip for now' }).click()
    await expect(onboarding).toBeHidden()
  }

  // The Backpack sidebar is the user-scoped library surface. Scope every
  // query to it so the responsive accordion copy in the DOM can't double-match.
  const backpack = page.getByRole('complementary', { name: 'Backpack', exact: true })
  await expect(backpack).toBeVisible()

  await backpack.getByRole('tab', { name: 'Binders' }).click()

  await backpack.getByRole('button', { name: 'New' }).click()
  await page.getByRole('menuitem', { name: 'Want-list' }).click()

  const dialog = page.getByRole('dialog', { name: 'New want-list' })
  await expect(dialog).toBeVisible()

  // Unique per run so re-runs (and retries) never collide on the assertion.
  const name = `E2E want-list ${Date.now()}`
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(dialog).toBeHidden()
  await expect(backpack.getByText(name)).toBeVisible()
})
