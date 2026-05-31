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
  // Match any positive `z-N` (ignore `-z-N`) up to 3 digits — Tailwind ships
  // 0, 10, 20, 30, 40, 50 by default, plus arbitrary `z-[N]` overrides.
  const matches = Array.from(source.matchAll(/(?<![-:])\bz-(\d{1,3})\b/g));
  return matches.map((m) => Number(m[1]));
}

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
