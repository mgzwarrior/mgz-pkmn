/**
 * Build-time release-notes helper for the marketing site.
 *
 * Fetches structured release notes from the API's `GET /api/v1/changelog`
 * endpoint — the single source of truth shared with the demo SPA — and
 * bakes them into the static HTML at build time, so the site stays
 * client-side-free.
 *
 * The endpoint parses the repo's `CHANGELOG.md`; see
 * `api/routes/changelog.py`. We deliberately consume the API rather than
 * re-parsing the Markdown here so there's exactly one parser.
 *
 * Failure handling mirrors `github.ts`: if the API is unreachable (the
 * demo runs on Render's free tier, which cold-starts), the helper returns
 * `[]` and the caller renders nothing for the "What's new" surface. The
 * build still succeeds.
 *
 * Configuration: `MGZ_PKMN_API_BASE` overrides the API origin (default is
 * the public demo). Useful for building against a local API during
 * development.
 */
const API_BASE =
  process.env.MGZ_PKMN_API_BASE?.replace(/\/$/, "") ||
  "https://mgz-pkmn.onrender.com";

// Render free-tier cold starts can take the better part of a minute; give
// the build-time fetch room rather than dropping the section on a slow spin-up.
const FETCH_TIMEOUT_MS = 60_000;

export interface ChangelogSection {
  name: string;
  entries: string[];
}

export interface ChangelogRelease {
  version: string;
  /** ISO date (YYYY-MM-DD), or null for the in-flight Unreleased section. */
  date: string | null;
  sections: ChangelogSection[];
}

interface ChangelogResponse {
  releases: ChangelogRelease[];
}

/**
 * Fetch the most recent `limit` shipped releases (newest first). The
 * in-flight Unreleased section is excluded by the endpoint default.
 * Returns `[]` on any failure so the build never breaks on a cold or
 * unreachable API.
 */
export async function fetchReleases(limit = 3): Promise<ChangelogRelease[]> {
  const url = `${API_BASE}/api/v1/changelog?limit=${limit}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(
        `[changelog] ${url} -> ${res.status} ${res.statusText} (skipping)`,
      );
      return [];
    }
    const data = (await res.json()) as ChangelogResponse;
    return data.releases ?? [];
  } catch (err) {
    console.warn(`[changelog] ${url} threw ${(err as Error).message} (skipping)`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convenience: the latest shipped version string (e.g. "1.1.1"), or null
 * if the changelog couldn't be fetched. Used to drive the hero's
 * "Now shipping" pill so it's never hard-coded.
 */
export async function fetchLatestVersion(): Promise<string | null> {
  const releases = await fetchReleases(1);
  return releases[0]?.version ?? null;
}

/**
 * Render a CHANGELOG bullet's inline Markdown to safe HTML: `[text](url)`
 * links, `` `code` `` spans, and `**bold**` emphasis, with everything else
 * HTML-escaped. Kept deliberately minimal — the bullets only ever use those
 * three constructs, and a full Markdown dependency would be overkill for a
 * few inline spans. Matches the web app's renderer (web/src/utils/
 * inlineMarkdown.tsx) so the same bullet renders the same way on both
 * surfaces.
 */
export function renderInlineMarkdown(text: string): string {
  const escape = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // Tokenize on links, code spans, and bold runs, escaping the gaps between
  // matches so raw user text can never inject markup. Alternation order
  // matters: code spans before bold so a `**` inside backticks isn't
  // re-tokenized as emphasis.
  const pattern =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let html = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    html += escape(text.slice(lastIndex, match.index));
    if (match[1] !== undefined && match[2] !== undefined) {
      // Link: [text](url). Only http(s) URLs match the pattern.
      html += `<a href="${escape(match[2])}" class="underline decoration-coconut-300 hover:decoration-palm-500 dark:decoration-sand-400 dark:hover:decoration-sun-300" target="_blank" rel="noopener noreferrer">${escape(match[1])}</a>`;
    } else if (match[3] !== undefined) {
      // Code span: `code`. Cream-on-coconut in light, husk-on-sand in dark
      // so the chip sits on the surface rather than punching through it.
      html += `<code class="rounded bg-sand-200 px-1 py-0.5 text-[0.85em] text-coconut-700 dark:bg-husk-100 dark:text-sand-200">${escape(match[3])}</code>`;
    } else if (match[4] !== undefined) {
      // Bold: **emphasis**.
      html += `<strong class="font-semibold text-coconut-700 dark:text-sand-50">${escape(match[4])}</strong>`;
    }
    lastIndex = pattern.lastIndex;
  }
  html += escape(text.slice(lastIndex));
  return html;
}
