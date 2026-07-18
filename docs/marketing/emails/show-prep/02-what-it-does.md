---
track: show-prep
reason: show
sequence: 2
when: signup + 3 days
subject: From wishlist to printable binder, before you leave the house
preheader: A 60-second tour of the prep tools.
---

![mgz-pkmn](https://raw.githubusercontent.com/mgzwarrior/mgz-pkmn/main/assets/logo.svg)

A quick tour of the prep flow.

Drop a wishlist into **Search** — plain English works alongside the `name | set | number` form:

```
top 5 Mew cards <= $50
All Charizard cards
top 10 Surging Sparks cards
Charizard | Base | 4/102
```

Hit **Look up** and the rows stream in. Then export whatever you'll actually carry:

- **A printable binder PDF** — thumbnail, set, number, market price, and comp tiers at 80/85/90/95% for every card. Fold it up, slip it in a backpack pocket, walk the booths.
- **A condensed binder PDF** — 24 cards per page instead of the standard 9, for when carrying less paper matters more than card size.
- **A checklist PDF** — one tick box per card, in set order, grouped by list. Mark cards off by hand as you find them.
- **A spreadsheet** — same data, sortable, comps included.

Those comp tiers are the point: when a dealer names a number, you already know what 85% of market looks like.

Prices come from two open sources checked automatically — pokemontcg.io, then TCGdex — and you can paste a PriceCharting link on any row to override it directly, which is the only way to price region-exclusive prints neither of the other two indexes. Walking a set at a booth? **Browse** lets you page through a whole set on your phone, prices attached. And if your prep is already scripted into a laptop workflow, the same pipeline runs as a CLI (`./pkmn lookup`) — same exports, no browser needed, plus `./pkmn set-cards` for printable set-ID tab cutouts.

[**Try it with my sample list →**](https://mgz-pkmn.onrender.com)

Got a show coming up? Give it a real list and tell me what's missing.

— Matt
