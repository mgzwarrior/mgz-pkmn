---
sequence: welcome-2
when: 2 days after welcome-1
audience: new newsletter subscriber
subject: "What mgz-pkmn actually does (90-second tour)"
preheader: "Paste a list, get a binder. Here's the demo link and what to try first."
---

![mgz-pkmn](https://raw.githubusercontent.com/mgzwarrior/mgz-pkmn/main/assets/logo.svg)

Hi again —

Quick 90-second tour, then a demo link and the one thing I'd try
first.

## The loop

1. **You paste a list.** One card per line. Anything from a precise
   `Charizard | Base Set | 4/102` to a fuzzy `Mew ex`, or a bulk
   request like `top:5 Charizard cards`.
2. **It looks them up.** Three open data sources stacked in priority
   order (pokemontcg.io → TCGdex → TCGPlayer comps). Results stream
   in as each line resolves.
3. **You walk away with a binder.** A printable PDF with
   thumbnails, market prices, negotiation floors (80% / 85% / 90% /
   95%), and a tag column that tells you which binder page each
   card lives on. Also `.xlsx` if you'd rather pivot it later, and
   a quarter-letter `checklist.pdf` for the floor.

## Try this first

Open the live demo: **<https://mgz-pkmn.onrender.com>**

(Free Render tier — first request takes ~30 seconds to wake the
server. After that it's snappy.)

Paste this:

```
Charizard | Base Set | 4/102
Pikachu | Jungle
top:5 Charizard cards
Mew ex | Scarlet & Violet
```

Hit **Look up**. Watch the progress chips light up by stage
(parsed → looking up → resolved). Then click **Export** → **PDF
binder** to see the actual artifact you'd walk into a show with.

## The thing I'm proud of

The **Browse** button (the icon top-left). Pick any Pokémon TCG
set, see every card with its market price, click to add to your
list. Useful for the "which Charizards from Surging Sparks are
under $20" question. The set-card data is pre-warmed on the server
so even niche sets respond instantly.

## What's coming

A persistence layer is landing in v1.2 — saved runs you can pull
up later without re-fetching, and the start of collection +
wishlist tracking. The roadmap lives at
<https://github.com/mgzwarrior/mgz-pkmn/blob/main/docs/roadmap.md>
if you want the full picture.

Reply with what works (or doesn't) — that's how this gets better.

— Matt

---

*Subscribe link: [mgz-pkmn.com](https://mgz-pkmn.com).
Unsubscribe is below.*
