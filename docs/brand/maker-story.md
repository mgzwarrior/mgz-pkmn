# Maker story & voice brief

Reference for anyone (human or agent) writing first-person "maker" copy for mgz-pkmn — the homepage "Why" section, the about/maker voice in emails, and the personal register the project speaks in. Captured from a 2026-06-29 interview with the maintainer. Pair this with the voice guide in [`design/DESIGN_SYSTEM.md`](../../design/DESIGN_SYSTEM.md).

## Origin

There was no single lightning-bolt moment — mgz-pkmn is a slow, steady project built by a hobbyist who also happens to be a software engineer, in the spare hours. The motivation came from real collecting friction:

- Mapping a desired collection into a physical binder by hand — always getting the order wrong, miscounting, or missing a card entirely.
- No good way to see the *gaps* — the breaks in a collection you're trying to complete.
- Wanting a clean, easy format to bring a chase list to shows and show vendors, with current market prices in hand.

It started as a tool for one person solving their own problem, and grew from there.

## The maker

A senior software engineer by day who builds this on the side. Becoming a parent deepened the connection to the hobby and to the community of people who love collecting — that's a real part of why the project exists.

> **Privacy is paramount.** Do not name, picture, or give identifying details about the maintainer's child anywhere — public site, internal docs, commit messages, anywhere. Keep parenthood as a feeling, never a fact-sheet. When in doubt, leave it out.

## Who it's for, and the feeling

Real collectors. The copy should land as *authentic* — a collector talking to collectors, not a company talking to a market. The reader should feel a quiet, maybe unspoken frustration get validated: the hobby's market has been pulled around by speculation and big money, and that's pushed a lot of regular collectors out. The reaction we want is **"this person gets it."**

The mission underneath it all: make Pokémon **accessible to everyone** — regardless of age, interest, or income level.

## Personality

Lean into the project's Exeggutor affection, but tastefully — it's already present (the `exeggutor` CLI easter egg, the "wall of eggs," the 🌴 motif, an Exeggcute card in the hero binder). A wink, not a costume. Don't overdo it.

## Voice & tone

The maintainer reads as **more crisp than warm** — and that's the target. Practical guidance for writing in that register:

- **Short, declarative sentences.** State the thing. Trust it to land without a windup.
- **Concrete nouns over adjectives.** "A binder with the cards in order and a price next to each" beats "a powerful, seamless experience."
- **Let one honest detail carry the warmth** — the hand-mapped binder, the show floor — instead of warm *words*. Earned, not announced.
- **Cut throat-clearing.** No "I just wanted to," "at the end of the day," "honestly." Start at the point.
- **First person, plainspoken, contractions.** Sentence case. This is a person, not a brand.

Crisp does not mean cold: the *content* is personal and human; the *delivery* is economical.

## Locked phrases

**Use:**
- "Collector-first"
- "Built by real collectors, for real collectors"

**Never use:**
- "Return on investment" / "ROI" — this is not an investment vehicle.
- "Scalpers" — convey the market-frustration sentiment without the loaded word.

(Plus the standard design-system never-ships list: unlock, supercharge, powerful, seamless, revolutionary, effortless, game-changing, next-gen. And "wishlist," not "want-list.")

## Imagery

Exeggutor / Exeggcute imagery is welcome and on-brand. Reference set: [Bulbagarden Exeggutor archive](https://archives.bulbagarden.net/wiki/Category:Exeggutor). Note on sourcing: prefer real TCG card scans pulled through the same public pipeline the hero already uses for cards (an Exeggutor card alongside the existing Exeggcute), rather than committing fan-wiki art of uncertain license. Confirm any specific asset before shipping it.

## Positioning & integration landscape

The maintainer's ambition: rather than living as a closed silo, mgz-pkmn should aim to be a **leader in interoperability** — offering dedicated, documented integration endpoints (pull *and* push) so collectors can move their data between mgz-pkmn and other services for the best possible experience.

This is a real gap in the market. A 2026-06-29 scan of the major consumer apps:

- **TCGplayer** — public developer API applications have been effectively closed since the eBay acquisition (2022); access is limited to existing partners and large sellers. Data is kept in-ecosystem.
- **Collectr** — has a developer API, but it's a gated, read-only product-info API (application keys, personal-use/promo restrictions), not an open two-way "move your collection" integration.
- **TCG Collector** — offers an official OpenAPI surface (read-oriented).
- **Dragon Shield Poké Manager, Ludex, ManaBox, etc.** — interop is mostly manual CSV/text export-import, not live API integration. pkmn.gg integrates with PTCG Live for decks specifically.
- **Open data sources** for card/price data that a tool like this can build on: pokemontcg.io, TCGdex, PriceCharting (already used), plus newer entrants (Scrydex, JustTCG).

Takeaway: no incumbent offers a clean, open, two-way collection-interchange API. Near-term interop is realistically CSV/JSON file exchange (mgz-pkmn already exports xlsx / binder PDF / checklist / JSON); the differentiated bet is publishing first-class pull/push endpoints and documenting them as an open interchange format others can adopt.
