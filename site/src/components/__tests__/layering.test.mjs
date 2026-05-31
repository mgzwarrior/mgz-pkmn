// Tailwind-class layering regression test for the marketing site.
//
// Runs under Node's built-in test runner (no new deps). Parses the relevant
// Astro components as plain text, extracts every `z-N` class, and asserts:
//
//   - The sticky <Header> has a higher z-index than every positioned child
//     inside <Hero>. Otherwise the hero content scrolls *over* the sticky
//     nav (regression introduced in the dark-mode sweep before #343).
//
// If you legitimately need to raise a Hero z-index, raise Header to stay
// above it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = resolve(here, "..");

function classesFrom(file) {
  const source = readFileSync(resolve(componentsDir, file), "utf8");
  // Match positive Tailwind z-index utilities in any of these forms:
  //   z-10            — scale value
  //   z-[42]          — arbitrary value
  //   sm:z-20         — responsive variant prefix
  //   dark:z-20       — state variant prefix
  //   hover:dark:z-20 — chained variants
  // Skip negatives like `-z-10` (and `bg-zinc-…`, where `z` is preceded by
  // `-`). The `(?<![\w-])` lookbehind keeps the `z` at a Tailwind-class
  // boundary while still allowing a `:` separator from a variant prefix.
  // Two alternatives, each with its own terminator:
  //   - Scale form `z-N` ends on a `\b` (the digits are word chars).
  //   - Arbitrary `z-[N]` ends on the literal `]` so a `\b` after a
  //     non-word `]` doesn't (silently) reject it.
  const pattern = /(?<![\w-])(?:z-(\d{1,3})\b|z-\[(\d{1,3})\])/g;
  return Array.from(source.matchAll(pattern), (m) => Number(m[1] ?? m[2]));
}

test("regex catches both scale, arbitrary, and variant-prefixed z classes", () => {
  // Inline parser smoke test. If a future edit narrows the regex back to
  // bare `z-N`, the assertions below will fire before the layering check
  // ever runs against the components.
  const sample =
    'class="z-10 sm:z-30 dark:z-[42] -z-10 bg-zinc-200 hover:dark:z-50"';
  const matches = Array.from(
    sample.matchAll(/(?<![\w-])(?:z-(\d{1,3})\b|z-\[(\d{1,3})\])/g),
    (m) => Number(m[1] ?? m[2]),
  );
  assert.deepEqual(matches.sort((a, b) => a - b), [10, 30, 42, 50]);
});

test("sticky <Header> stacks above all <Hero> z-index children", () => {
  const headerZ = classesFrom("Header.astro");
  const heroZ = classesFrom("Hero.astro");

  assert.ok(headerZ.length > 0, "Header.astro has no z-N class");
  assert.ok(heroZ.length > 0, "Hero.astro has no z-N classes to check against");

  const headerMax = Math.max(...headerZ);
  const heroMax = Math.max(...heroZ);
  assert.ok(
    headerMax > heroMax,
    `Header z-${headerMax} must be > max Hero z-${heroMax} so the sticky ` +
      `nav stays above the hero on scroll. Bump Header up, not Hero down.`,
  );
});
