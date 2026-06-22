// Footer disclosure regression test for marketplace affiliate copy.
//
// The marketing site renders static Astro components, so this lightweight
// Node test reads the component source and locks the public copy/brand cues
// without adding a DOM renderer just for the footer.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const footerSource = readFileSync(resolve(here, "../Footer.astro"), "utf8");

test("footer includes marketplace affiliate disclosure", () => {
  assert.match(
    footerSource,
    /Affiliate disclosure: mgz-pkmn may earn from qualifying purchases through eBay and\s+TCGplayer links\./,
  );
});

test("footer includes eBay and TCGplayer brand cues", () => {
  assert.match(footerSource, /marketplaces\/ebay\.svg\?url/);
  assert.match(footerSource, /marketplaces\/tcgplayer\.svg\?url/);
});
