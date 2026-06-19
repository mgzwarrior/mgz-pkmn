# Sources & coverage

The tool draws on four data sources. Three of them — [pokemontcg.io], [TCGdex], and [PriceCharting] — resolve the card itself: each line is tried against them in order, and the first source that produces a usable match wins. The fourth, [eBay], never resolves cards — listing titles are too unreliable for structural data — and instead contributes sold- and active-listing comps to the pricing ensemble (see [ADR-0020](adr/0020-ebay-pricing-source.md) and [ADR-0023](adr/0023-source-ensemble-pricing.md)).

[pokemontcg.io]: https://pokemontcg.io
[TCGdex]: https://tcgdex.dev
[PriceCharting]: https://www.pricecharting.com
[eBay]: https://www.ebay.com

## pokemontcg.io (default)

Searched first for every line. Best for English / international English
releases. Prices in USD (TCGPlayer) with EUR (Cardmarket) fallback. ~1000
requests/day without a key (30/min); free key at <https://dev.pokemontcg.io>
raises that to 20k/day.

## TCGdex (automatic fallback)

Engaged automatically when [pokemontcg.io] has no match. The tool detects
language hints in your input (`Chinese`, `Japanese`, `Korean`, …) and
queries the matching [TCGdex] locale, then falls back to TCGdex `en`.
Useful for some Japanese promos and a subset of regional Chinese / Korean
releases. See [Languages](languages.md) for how detection chains work.

## PriceCharting URL (manual override)

When neither database has a card — typically the Chinese **Gem Pack** /
**寶石包** lineup, certain Japanese collector products, etc. — paste the
[PriceCharting] product URL onto the line. The scraper extracts:

- Image (`og:image`)
- "Loose" / used price (USD) → used as the market price for comps
- "New" and "Graded" prices retained internally

Why opt-in (URL) rather than auto-search? PriceCharting's search is
ambiguous for similarly-named cards across regional variants; the URL
guarantees you've picked the right product page.

## eBay (pricing comps — application token)

eBay contributes sold- and active-listing comps to the pricing ensemble (see [ADR-0020](adr/0020-ebay-pricing-source.md)). It is **not** used for card-object resolution — listing titles are too unreliable for structural data. Authentication uses the eBay Developer **OAuth client-credentials** grant: an application-level access token that reads public listing data, with no per-user eBay account involved.

Configure one of two ways:

- **Client credentials** — set `MGZ_PKMN_EBAY_CLIENT_ID` and `MGZ_PKMN_EBAY_CLIENT_SECRET` (from the eBay Developer portal). The auth client mints an application token and refreshes it automatically as it nears expiry.
- **Pre-supplied token** — set `MGZ_PKMN_EBAY_TOKEN` to an already-minted application token. It's used verbatim with no refresh — handy for a quick test, but you'll have to rotate it yourself.

`MGZ_PKMN_EBAY_ENV` selects the host: unset (or anything other than `sandbox`) targets production (`api.ebay.com`); set it to `sandbox` to target `api.sandbox.ebay.com`.

### Active vs sold comps

`EbayClient.fetch_comps(query)` returns two flavors of comp, both filtered to raw singles (graded slabs, lots, and bundles are dropped) and deduped on item id:

- **Active** (`source="ebay_active"`) — what's listed right now, from the **Browse API**. Available with the application token above, so this tier is always on.
- **Sold** (`source="ebay_sold"`) — recent sales, from the **Marketplace Insights API**. That API is limited-release (it needs separate eBay business approval; the legacy `findCompletedItems` Finding API was retired in early 2025), so the sold path is gated behind `MGZ_PKMN_EBAY_SOLD_ENABLED` (default off) and fails soft on a 403. Leave it off until eBay grants Insights access to your app, then set it to `1` / `true`.

### Sandbox credentials

Develop against the sandbox first. In the eBay Developer portal your keyset exposes both a **Production** and a **Sandbox** set of App ID (client id) / Cert ID (client secret). For local sandbox work:

```bash
export MGZ_PKMN_EBAY_ENV=sandbox
export MGZ_PKMN_EBAY_CLIENT_ID=<sandbox App ID>
export MGZ_PKMN_EBAY_CLIENT_SECRET=<sandbox Cert ID>
```

The token endpoint, scope, and request shape are identical between environments — only the host differs — so the same `EbayAuthClient` covers both.

### Account-deletion notification endpoint

eBay requires every production app to host a [marketplace account-deletion webhook](https://developer.ebay.com/develop/guides-v2/marketplace-user-account-deletion) before it will grant production keys. mgz-pkmn exposes it at `/api/v1/ebay/account-deletion`:

- **`GET ?challenge_code=...`** — eBay's one-time verification handshake. Returns the hex SHA-256 of `challengeCode + verificationToken + endpoint` (that exact order) as `{"challengeResponse": "<hash>"}`.
- **`POST`** — an account-closure notification. mgz-pkmn stores no eBay user data (it only reads public listings via the application token), so there's nothing to erase — the handler logs receipt and acknowledges with `200`.

Two env vars drive it, both matched to the eBay Developer **Alerts & Notifications** portal:

- `MGZ_PKMN_EBAY_VERIFICATION_TOKEN` — a 32–80 character `[A-Za-z0-9_-]` token you choose.
- `MGZ_PKMN_EBAY_DELETION_ENDPOINT` — the exact public URL eBay has registered (e.g. `https://mgz-pkmn.onrender.com/api/v1/ebay/account-deletion`). It's read from env rather than derived from the request because the hosted demo terminates TLS upstream and the hash must use the byte-exact registered URL.

## Failure messages

When pokemontcg.io and TCGdex both have hits for the name but none in
your hinted set, you get:

```text
- card name has hits but none in set 'Gem Pack Vol 3' (set may not be indexed
  by pokemontcg.io or TCGdex — try adding a PriceCharting URL on the line)
```

The row is still written so you can fill it in manually.

Region / rarity descriptors (`Chinese`, `Japanese`, `SIR`, `SAR`, `FA`,
…) are stripped from the database query but kept in the **Input** column
verbatim.
