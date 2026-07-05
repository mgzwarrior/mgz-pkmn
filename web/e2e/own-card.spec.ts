import { expect, test } from '@playwright/test'

/**
 * The Own half of the one-tap quick-action pair (#809, under #757).
 *
 * Mirror of browse-save.spec.ts for the other ADR-0027 action: browse the
 * cassette set, save a card with the one-tap Own action, and see it land in the
 * Backpack library — all the way across the SPA↔FastAPI↔SQLite seam. Own writes
 * to the default "My collection" (vs. Want's "My wishlist") through a distinct
 * endpoint (`/cards/own` vs `/cards/want`) and surfaces an owned badge, so a
 * break in this path would slip past the Want coverage. Card data comes from the
 * committed cache cassette (web/e2e/fixtures/cassette, seeded by boot-api.sh), so
 * the run makes zero outbound pokemontcg.io calls. The set is `mcd19`; Eevee is
 * its card here — distinct from the Pikachu the Want spec saves, which shares
 * this run's DB, so the owned badge reads unambiguously. Prices are never
 * asserted — they drift, and the cassette short-circuits the only refresh.
 */
test('browse a set, own a card, and see it in the Backpack', async ({ page }) => {
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

  // Browse → walk the set list → drill into the cassette set. The set list
  // renders from the cassette's sets.json (cache HIT, no live catalog fetch).
  await page.getByRole('tablist', { name: 'Discovery mode' }).getByRole('tab', { name: 'Browse' }).click()
  const browse = page.getByRole('region', { name: 'Browse cards by set' })
  await browse.getByRole('button', { name: /McDonald.s Collection 2019/ }).click()

  // The set's cards resolve from the cassette's structural slice (cache HIT
  // through the real /api/sets/mcd19/cards path). Eevee proves the grid rendered.
  const eevee = browse.getByRole('listitem').filter({ hasText: 'Eevee' })
  await expect(eevee).toBeVisible()

  // One-tap Own. The button is disabled until the batched ownership lookup
  // resolves, and its accessible name flips to "Remove from own" once active.
  const owned = eevee.getByText('owned')
  const ownButton = eevee.getByRole('button', { name: 'Own', exact: true })

  // A CI retry reuses the same DB, so Eevee may already be saved from the prior
  // attempt. Wait for the ownership lookup to settle — the button enables (not
  // yet saved) or the owned badge is already showing — then save only when it
  // isn't already owned, so a retry doesn't hang on a button whose name has
  // flipped away from "Own".
  await expect
    .poll(
      async () =>
        (await owned.isVisible()) ||
        ((await ownButton.count()) > 0 && (await ownButton.isEnabled())),
    )
    .toBe(true)
  if (!(await owned.isVisible())) {
    await ownButton.click()
  }

  // The write round-trips: the card re-reads as owned across the seam.
  await expect(owned).toBeVisible()

  // It surfaces in the library: the first Own lazily provisions the default
  // "My collection", which now shows as a binder row in the Backpack.
  const backpack = page.getByRole('complementary', { name: 'Backpack', exact: true })
  await expect(backpack).toBeVisible()
  await expect(backpack.getByText('My collection')).toBeVisible()
})
