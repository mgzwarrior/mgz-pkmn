import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Browser-level axe-core scans (#222).
 *
 * The vitest-axe layer (web/src/components/a11y.test.tsx) runs in JSDOM,
 * which doesn't compute color — axe's `color-contrast` rule is effectively
 * disabled there. This suite re-runs axe in the real browser against the
 * major UI states so contrast (and other rendered-only) regressions fail CI
 * instead of waiting for a human to run the manual scan in
 * docs/accessibility.md. The bar matches the documented policy: no critical
 * or serious violations.
 *
 * Card data comes from the committed cassette (see web/e2e/fixtures/README),
 * same as the other journeys — no page.route() mocking, the SPA↔API seam
 * stays real.
 */

async function expectNoSeriousViolations(page: Page) {
  // Freeze CSS animations before scanning. The row fade-in and the tour
  // hint's pulse are opacity keyframes, and axe samples whatever frame it
  // lands on — a mid-fade row reads as a contrast failure that no user
  // steady-state ever shows. Static colors are unaffected.
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; }' })
  const { violations } = await new AxeBuilder({ page }).analyze()
  const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  expect(
    blocking.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.map((n) => n.target.join(' ')),
    })),
  ).toEqual([])
}

/** Land on the app and dismiss the first-run onboarding if it shows. */
async function gotoApp(page: Page) {
  await page.goto('/')
  // Tolerant of absence so a retry (which reuses the server's DB, where
  // onboarding is already done) sails past instead of hanging.
  const onboarding = page.getByRole('dialog', { name: 'Pick your favorite Pokémon' })
  await onboarding.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (await onboarding.isVisible()) {
    await onboarding.getByRole('button', { name: 'Skip for now' }).click()
    await expect(onboarding).toBeHidden()
  }
}

test('idle page has no critical or serious axe violations', async ({ page }) => {
  await gotoApp(page)
  // The app opens on Swipe; wait for a dealt card so the scan sees the loaded
  // surface, not the LoadingCard placeholder. Same convergence as
  // swipe-triage.spec.ts: the deck walks random sets and cache_only empties
  // every non-cassette one, so it settles on an mcd19 card — eventually.
  const swipe = page.getByRole('region', { name: 'Swipe mode' })
  await expect(swipe).toBeVisible()
  await expect(swipe.getByRole('button', { name: /^View details for / })).toBeVisible({
    timeout: 30_000,
  })
  await expectNoSeriousViolations(page)
})

test('open Help modal has no critical or serious axe violations', async ({ page }) => {
  await gotoApp(page)
  await page.getByRole('button', { name: /^Help/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectNoSeriousViolations(page)
})

test('open Settings drawer has no critical or serious axe violations', async ({ page }) => {
  await gotoApp(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectNoSeriousViolations(page)
})

test('populated results table with filters expanded has no critical or serious axe violations', async ({
  page,
}) => {
  await gotoApp(page)
  await page
    .getByRole('tablist', { name: 'Discovery mode' })
    .getByRole('tab', { name: 'Search' })
    .click()

  // Cassette-backed look-up, same lines as search-export.spec.ts — the exact
  // line text drives the cache key, so it must match the committed slices.
  await page
    .getByRole('textbox', { name: 'Card list — one card per line' })
    .fill("Pikachu | McDonald's Collection 2019\nEevee | McDonald's Collection 2019")
  await page.getByRole('button', { name: /Look up/i }).click()
  await expect(page.getByRole('row', { name: 'View details for Pikachu' })).toBeVisible()

  // Expand the per-column filter row so its inputs are in the scan.
  await page.getByRole('button', { name: /^filter$/i }).click()
  await expectNoSeriousViolations(page)
})
