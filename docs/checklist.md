# Checklist PDF

Pass `--checklist checklist.pdf` to also produce a printable checklist
— designed to live in the front of the binder so you can mark off cards
by hand as you sort, verify, or acquire them at the show.

## Layout

One section per input file (Source tag). Each section is a 3-column
layout with one row per matched card: empty checkbox · `#N/Total` ·
card name · market price (right-aligned, in green when present). The
header shows the tag name, total card count, and page number (`p.1`,
`p.2`, …).

## Ordering

Row order follows whatever you pass to `--sort` — by default that's
card number grouped by set, which mirrors how a printed set checklist
reads. Pass `--sort price-desc` to fall back to the old "highest price
first" ordering. See the [`--sort` flag](cli.md#options) for every
mode.

## What ends up in it

Content is whatever lookup produced — if the input has `top 18 Surging
Sparks cards` you get those 18; if it has `All Charizard cards` you get
every Charizard variant returned. Sections with zero matched cards are
skipped, and if every tag is empty no file is written.
