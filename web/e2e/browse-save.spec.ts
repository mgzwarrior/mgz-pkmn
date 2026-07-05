import { expect, test } from '@playwright/test'

/**
 * First card-dependent end-to-end flow (#807, under #757).
 *
 * Walks the canonical journey the mocked component suite can't cover: browse a
 * real set, save a card with the one-tap Want action, and see it land in the
 * Backpack library — all the way across the SPA↔FastAPI↔SQLite seam. Card data
 * comes from the committed cache cassette (web/e2e/fixtures/cassette, seeded by
 * boot-api.sh), so the set list and the set's cards resolve from a disk-cache
 * HIT and the run makes zero outbound pokemontcg.io calls. The set is `mcd19`
 * (McDonald's Collection 2019, 12 cards); Pikachu is its unique, recognizable
 * card. Prices are never asserted — they drift, and the cassette short-circuits
 * the only thing that would refresh them.
 */
test('browse a set, save a card, and see it in the Backpack', async ({ page }) => {
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
  // through the real /api/sets/mcd19/cards path). Pikachu proves the grid rendered.
  const pikachu = browse.getByRole('listitem').filter({ hasText: 'Pikachu' })
  await expect(pikachu).toBeVisible()

  // One-tap Want. The button is disabled until the batched ownership lookup
  // resolves, and its accessible name flips to "Remove from want" once active.
  const chasing = pikachu.getByText('chasing')
  const wantButton = pikachu.getByRole('button', { name: 'Want', exact: true })

  // A CI retry reuses the same DB, so Pikachu may already be saved from the
  // prior attempt. Wait for the ownership lookup to settle — the button enables
  // (not yet saved) or the chasing badge is already showing — then save only
  // when it isn't already chasing, so a retry doesn't hang on a button whose
  // name has flipped away from "Want".
  await expect
    .poll(
      async () =>
        (await chasing.isVisible()) ||
        ((await wantButton.count()) > 0 && (await wantButton.isEnabled())),
    )
    .toBe(true)
  if (!(await chasing.isVisible())) {
    await wantButton.click()
  }

  // The write round-trips: the card re-reads as chasing across the seam.
  await expect(chasing).toBeVisible()

  // It surfaces in the library: the first Want lazily provisions the default
  // "My wishlist", which now shows as a binder row in the Backpack.
  const backpack = page.getByRole('complementary', { name: 'Backpack', exact: true })
  await expect(backpack).toBeVisible()
  await expect(backpack.getByText('My wishlist')).toBeVisible()
})
