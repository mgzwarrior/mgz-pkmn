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
- **Single origin.** The API serves the built SPA from `web/dist`, so the browser drives one base URL (`http://localhost:8000`) and `/api` calls are same-origin — no Vite proxy in the loop.

Migrations seed the `default` user, so the app boots straight into a usable, empty library.

## Fixture / seed strategy

The first smoke flow ([#758](https://github.com/mgzwarrior/mgz-pkmn/issues/758)) is deliberately **external-data-free**: it creates a want-list by name and confirms it persists, exercising the full SPA↔FastAPI↔SQLite seam without any pricing source in the loop. That keeps the foundation fast and flake-proof.

Card-dependent journeys (browse a set → save a card → see it in the library) need card data, which the lookup pipeline fetches from external sources (pokemontcg.io et al.). Hitting those live in CI would be slow and flaky, so the plan is a **cache cassette**: warm one small set once (`pkmn cache warm-set-cards <set-id>`), commit the resulting `cache/` slice under a fixture, and point `XDG_CACHE_HOME` at a copy of it in `boot-api.sh`. The API then resolves that set's cards from a cache hit — the SPA↔API seam stays real, only the external call is short-circuited. Those flows land one per PR per [#757](https://github.com/mgzwarrior/mgz-pkmn/issues/757) once the cassette exists.

## Adding a flow

Add a spec to `web/e2e/`. Prefer user-facing locators (`getByRole`, `getByText`) over CSS — the app leans on accessible roles and labels, which double as durable selectors. Keep each spec to one journey, and make any created data unique per run (e.g. a timestamp suffix) so retries never collide.
