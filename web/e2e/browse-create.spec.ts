import { expect, test } from '@playwright/test'

/**
 * Browse "New ▾" create flow (#810, under #757).
 *
 * The Browse header's New ▾ menu (#737) spins up one of the three canonical
 * binder kinds — owned Collection, chasing Want-list, or Smart collection —
 * seeded from the active set. This walks the Want-list journey end to end: it
 * crosses the SPA↔API seam by seeding the set's cards, creating the resource,
 * and refreshing the library so the row lands in the Backpack — the kind of
 * break the mocked component suite can't catch. Card data comes from the
 * committed cassette (set `mcd19`), so the run makes zero outbound calls. The
 * want-list is named uniquely per run so re-runs and retries never collide.
 */
test('browse a set, create a want-list seeded from it, and see it in the Backpack', async ({
  page,
}) => {
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

  // Browse → walk the set list → drill into the cassette set.
  await page.getByRole('tablist', { name: 'Discovery mode' }).getByRole('tab', { name: 'Browse' }).click()
  const browse = page.getByRole('region', { name: 'Browse cards by set' })
  await browse.getByRole('button', { name: /McDonald.s Collection 2019/ }).click()

  // Wait for the set's cards to land — the New ▾ create is seeded from the
  // loaded cards, and the menu's seeded kinds stay disabled until they're in.
  await expect(browse.getByRole('listitem').filter({ hasText: 'Pikachu' })).toBeVisible()

  // Open the header New ▾ menu and create a Want-list seeded from the set. The
  // menu and dialog render in a portal at the document root, so they're queried
  // off `page` rather than the browse region.
  await browse.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: /Want-list/i }).click()

  const dialog = page.getByRole('dialog', { name: 'New want-list' })
  await expect(dialog).toBeVisible()

  // Replace the set-derived prefill with a unique per-run name so the Backpack
  // assertion can't match a leftover row from an earlier run.
  const name = `E2E set want-list ${Date.now()}`
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).toBeHidden()

  // It lands in the library seeded with the whole set: the new row shows under
  // the Backpack Binders tab and reports the set's 12-card count, proving the
  // seed round-tripped across the seam.
  const backpack = page.getByRole('complementary', { name: 'Backpack', exact: true })
  await expect(backpack).toBeVisible()
  await backpack.getByRole('tab', { name: 'Binders' }).click()
  const row = backpack.getByRole('listitem').filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(row).toContainText('12 cards')

  // Clean up so the seed doesn't leak into the rest of the serial suite: every
  // seeded card reads as "chasing" while this want-list exists, which would
  // suppress the default-list provisioning the quick-action specs assert (e.g.
  // browse-save's first Want on a card this list already chases). The two-step
  // delete cascades the seeded cards back out, leaving the shared DB as found.
  await row.getByRole('button', { name: `Delete want-list "${name}"` }).click()
  await row.getByRole('button', { name: `Confirm delete want-list "${name}"` }).click()
  await expect(row).toBeHidden()
})
