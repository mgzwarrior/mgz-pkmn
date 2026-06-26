# End-to-end tests

The Vitest component suite mocks the API, so it can't catch breaks where the SPA and the FastAPI service disagree — exactly the integration seams that bite users. The end-to-end suite ([Playwright](https://playwright.dev/)) drives a real browser through the production-shaped single unit: the FastAPI service serving the built SPA at `/`, against the real API. It's the durable safety net under the primary user journeys, tracked under [#757](https://github.com/mgzwarrior/mgz-pkmn/issues/757).

## Running it

```bash
make e2e
```

That builds the SPA, downloads the browser on first run, boots the API, and drives the suite headless. To iterate on a spec with Playwright's UI runner:

```bash
cd web && npm run e2e:ui
```

The specs live in [`web/e2e/`](../web/e2e); config is [`web/playwright.config.ts`](../web/playwright.config.ts).

## How a run is wired

[`web/e2e/boot-api.sh`](../web/e2e/boot-api.sh) is what Playwright's `webServer` launches, and it's deterministic by construction:

- **Auth off.** `MGZ_PKMN_AUTH_ENABLED` stays unset, so every request resolves to the sentinel `default` user (see [deployment.md](deployment.md)) — no sign-in dance, no cookies, no provider secrets.
- **Throwaway state.** A fresh `mktemp -d` holds the SQLite DB (`MGZ_PKMN_DATABASE_URL`) and the cache root (`XDG_CACHE_HOME`), both torn down when the server exits. A run never touches your real `~/.cache/mgz-pkmn` or DB.
- **Single origin.** The API serves the built SPA from `web/dist`, so the browser drives one base URL (`http://localhost:8123` by default — a dedicated port that stays clear of `make dev-api`/`make dev` on `:8000`, override with `E2E_PORT`) and `/api` calls are same-origin — no Vite proxy in the loop. Playwright never reuses an already-running server, so a stray dev instance can't pull the suite onto your real DB.
- **Cache-only.** `MGZ_PKMN_CACHE_ONLY=1` pins the API offline: a disk-cache miss degrades to a `MISS-CACHE-ONLY` result instead of fetching pokemontcg.io, and `/api/v1/sets/{id}/cards` returns it as an empty `200` (not a `404`) so a client like the Swipe deck retires that set and samples the next rather than erroring. This is the belt to the cassette's braces. The cassette covers the cards the specs touch, but the Swipe deck (the default surface) samples a *random* set from the bundled catalog on load, and one outside the cassette would otherwise fetch live in the background. The flag guarantees zero outbound calls regardless of which set the deck picks. It's off-default, so it changes nothing for production or self-host — see [`api/cache_mode.py`](../api/cache_mode.py).

Migrations seed the `default` user, so the app boots straight into a usable, empty library.

## Fixture / seed strategy

The first smoke flow ([#758](https://github.com/mgzwarrior/mgz-pkmn/issues/758)) is deliberately **external-data-free**: it creates a want-list by name and confirms it persists, exercising the full SPA↔FastAPI↔SQLite seam without any pricing source in the loop. That keeps the foundation fast and flake-proof.

Card-dependent journeys (browse a set → save a card → see it in the library) need card data, which the lookup pipeline fetches from external sources (pokemontcg.io et al.). Hitting those live in CI would be slow and flaky, so card data comes from a **cache cassette**: a committed slice of the API disk cache for one small set, [`web/e2e/fixtures/cassette/`](../web/e2e/fixtures). [`boot-api.sh`](../web/e2e/boot-api.sh) copies it into the run's throwaway cache root and `touch`es the files so every read is a HIT — the set list, the set's cards, and their pricing all resolve from disk, so the SPA↔API seam stays real while the external call is short-circuited and a run makes zero outbound fetches. See [`web/e2e/fixtures/README.md`](../web/e2e/fixtures/README.md) for what's in it, why the structural slice has no TTL, and how to regenerate. The remaining flows land one per PR per [#757](https://github.com/mgzwarrior/mgz-pkmn/issues/757).

## Adding a flow

Add a spec to `web/e2e/`. Prefer user-facing locators (`getByRole`, `getByText`) over CSS — the app leans on accessible roles and labels, which double as durable selectors. Keep each spec to one journey, and make any created data unique per run (e.g. a timestamp suffix) so retries never collide. [`smoke.spec.ts`](../web/e2e/smoke.spec.ts) is the data-free template; [`browse-save.spec.ts`](../web/e2e/browse-save.spec.ts) is the template for a card-dependent flow built on the cassette. For card data, drill into the cassette set (`mcd19`) — never assert on prices, which drift.
