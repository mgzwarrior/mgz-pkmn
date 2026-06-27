import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Swipe triage into owned / chasing (#812, under #757).
 *
 * Swipe mode is the collector-facing triage surface and the app's default
 * landing (#814): a deck of candidate cards, each carrying the same one-tap
 * Own / Want quick actions as the other surfaces. This walks the deck offline
 * and triages through that distinct UI: Own the top card (writes the default
 * collection), swipe it away to advance the deck (exercising the persisted
 * `swipe_seen` no-repeat), then Want the next card (writes the default
 * wishlist). Only `mcd19` is cached, and `cache_only` degrades every other
 * set's deal to empty, so the deck converges on the cassette set without a
 * single outbound call — no new fixture data is needed beyond the browse set
 * slice. State persists in the reused DB, so each quick action is retry-safe:
 * act only when the card isn't already in that state.
 */

const swipeRegion = (page: Page): Locator => page.getByRole('region', { name: 'Swipe mode' })

const card = (swipe: Locator): Locator =>
  swipe.getByRole('button', { name: /^View details for / })

test('swipe triages cards into owned and chasing', async ({ page }) => {
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

  // The app opens on Swipe. The deck walks the catalog at random; cache_only
  // empties every non-cassette set, so it converges on an mcd19 card.
  const swipe = swipeRegion(page)
  await expect(swipe).toBeVisible()
  await expect(card(swipe)).toBeVisible({ timeout: 30_000 })
  const firstCard = await card(swipe).getAttribute('aria-label')

  // Own the top card via its quick action — the same write path as Browse,
  // through the Swipe UI. The button enables once the batched ownership lookup
  // resolves, and its name flips to "Remove from own" once the card is owned.
  await ownCurrent(swipe, 'own')

  // Swipe the card away (→ saves it as a taste signal and records it seen) and
  // confirm the deck advances to a different card — the persisted swipe_seen
  // memory keeps the dealt card from immediately resurfacing.
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => card(swipe).getAttribute('aria-label'))
    .not.toBe(firstCard)

  // Want the next card — the chasing half of the pair.
  await ownCurrent(swipe, 'want')

  // Both writes land in the library: Own lazily provisions the default "My
  // collection", Want the default "My wishlist". Open the Backpack after both
  // writes so the freshly provisioned rows are in the fetched list.
  const backpack = page.getByRole('complementary', { name: 'Backpack', exact: true })
  await expect(backpack).toBeVisible()
  await backpack.getByRole('tab', { name: 'Binders' }).click()
  await expect(backpack.getByText('My collection')).toBeVisible()
  await expect(backpack.getByText('My wishlist')).toBeVisible()
})

/**
 * Toggle the current swipe card into owned / chasing, retry-safe against the
 * reused DB: skip when it's already in that state (the button name has flipped
 * to "Remove from <label>"), otherwise wait for the lookup to enable the button
 * and click. Asserts the toggled state afterwards.
 */
async function ownCurrent(swipe: Locator, label: 'own' | 'want') {
  const onName = label === 'own' ? 'Own' : 'Want'
  const offName = `Remove from ${label}`
  const toggle = swipe.getByRole('button', { name: onName, exact: true })
  const remove = swipe.getByRole('button', { name: offName, exact: true })

  await expect
    .poll(
      async () =>
        (await remove.count()) > 0 ||
        ((await toggle.count()) > 0 && (await toggle.isEnabled())),
    )
    .toBe(true)
  if ((await remove.count()) === 0) {
    await toggle.click()
  }
  await expect(remove).toBeVisible()
}
