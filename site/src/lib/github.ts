/**
 * Build-time GitHub API helpers for the marketing site.
 *
 * Called from Astro frontmatter (top-level `await`) so the SPA stays
 * client-side-free — the fetched data is baked into the static HTML at
 * build time. Every helper handles failure (network, rate limit, auth)
 * by returning an empty result; the caller's template renders nothing
 * for that bucket and the build still succeeds.
 *
 * Authentication: if `GITHUB_TOKEN` is set in the build environment, the
 * helpers send a `Bearer` token (5000 req/hour). Without it we fall back
 * to anonymous requests (60 req/hour per IP), which is fine for a single
 * deploy but will rate-limit aggressive rebuild loops on Render.
 */
const OWNER = "mgzwarrior";
const REPO = "mgz-pkmn";
const API = "https://api.github.com";

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": `${OWNER}-${REPO}-site-build`,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function safeFetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      // Anonymous rate-limited (403) or network/server issue — log to the
      // build console and move on. The caller renders an empty section.
      console.warn(
        `[github] ${url} -> ${res.status} ${res.statusText} (skipping)`,
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[github] ${url} threw ${(err as Error).message} (skipping)`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Good-first-issues — open issues labeled `good first issue`.
// ---------------------------------------------------------------------------

export interface GoodFirstIssue {
  number: number;
  title: string;
  url: string;
  /** Display label for the issue's `area:*` tag, or null when none. */
  area: string | null;
  /** ISO timestamp of when the issue was opened. */
  createdAt: string;
}

interface GhIssue {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  pull_request?: unknown;
  labels: { name: string }[];
}

export async function fetchGoodFirstIssues(
  limit = 6,
): Promise<GoodFirstIssue[]> {
  const url = `${API}/repos/${OWNER}/${REPO}/issues?labels=good%20first%20issue&state=open&per_page=${limit}`;
  const data = await safeFetchJson<GhIssue[]>(url);
  if (!data) return [];
  return data
    // The /issues endpoint returns PRs too; filter them out.
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      area:
        i.labels
          .map((l) => l.name)
          .find((n) => n.startsWith("area:"))
          ?.replace("area:", "") ?? null,
      createdAt: i.created_at,
    }));
}

// ---------------------------------------------------------------------------
// Recently merged PRs.
// ---------------------------------------------------------------------------

export interface RecentPR {
  number: number;
  title: string;
  url: string;
  authorLogin: string;
  authorUrl: string;
  authorAvatarUrl: string;
  mergedAt: string;
}

interface GhPull {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  user: {
    login: string;
    html_url: string;
    avatar_url: string;
  } | null;
}

export async function fetchRecentMergedPRs(limit = 5): Promise<RecentPR[]> {
  // Pull a wider window than `limit` because the closed-PR list mixes merged
  // and just-closed; we filter to merged ones below.
  const url = `${API}/repos/${OWNER}/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=${limit * 2}`;
  const data = await safeFetchJson<GhPull[]>(url);
  if (!data) return [];
  return data
    .filter((p) => p.merged_at != null && p.user != null)
    .slice(0, limit)
    .map((p) => ({
      number: p.number,
      title: p.title,
      url: p.html_url,
      authorLogin: p.user!.login,
      authorUrl: p.user!.html_url,
      authorAvatarUrl: p.user!.avatar_url,
      mergedAt: p.merged_at!,
    }));
}

// ---------------------------------------------------------------------------
// Contributor avatars.
// ---------------------------------------------------------------------------

export interface Contributor {
  login: string;
  url: string;
  avatarUrl: string;
  contributions: number;
}

interface GhContributor {
  login: string;
  html_url: string;
  avatar_url: string;
  contributions: number;
  type: string;
}

export async function fetchContributors(limit = 12): Promise<Contributor[]> {
  const url = `${API}/repos/${OWNER}/${REPO}/contributors?per_page=${limit}`;
  const data = await safeFetchJson<GhContributor[]>(url);
  if (!data) return [];
  return data
    // Skip bots (dependabot, github-actions, etc.) — they're not what the
    // "contributors" surface is celebrating.
    .filter((c) => c.type === "User")
    .slice(0, limit)
    .map((c) => ({
      login: c.login,
      url: c.html_url,
      avatarUrl: c.avatar_url,
      contributions: c.contributions,
    }));
}

// ---------------------------------------------------------------------------
// Roadmap milestones — drives the "Where it's going." teaser on the
// landing page. We pull `state=all` so the most-recently-closed milestone
// shows as the "done" card alongside the active/planned open ones.
// ---------------------------------------------------------------------------

export type RoadmapState = "done" | "active" | "planned";

export interface RoadmapMilestone {
  state: RoadmapState;
  /** Milestone title with the leading `v` stripped (e.g. `1.2`). */
  title: string;
  /** Milestone description, or `null` when empty. */
  body: string | null;
  url: string;
}

interface GhMilestone {
  number: number;
  title: string;
  description: string | null;
  state: "open" | "closed";
  due_on: string | null;
  closed_at: string | null;
  html_url: string;
}

function stripVPrefix(title: string): string {
  return title.replace(/^v/i, "");
}

/**
 * Tuple key for ordering semver-shaped milestone titles (`v1.4`, `v2.0`,
 * `v1.10`) by version rather than string or GitHub milestone number.
 * Non-numeric segments fall through to lexical compare so unusual titles
 * still sort deterministically.
 */
function versionKey(title: string): number[] {
  return stripVPrefix(title)
    .split(".")
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
    });
}

function compareVersions(a: string, b: string): number {
  const ak = versionKey(a);
  const bk = versionKey(b);
  const len = Math.max(ak.length, bk.length);
  for (let i = 0; i < len; i++) {
    const diff = (ak[i] ?? 0) - (bk[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

/**
 * Pick the three milestones that drive the roadmap teaser:
 *   - `done`: the most recently closed milestone
 *   - `active`: the open milestone with the soonest due date, ties broken
 *     by semver-ordered title then by GitHub milestone number for stability;
 *     falls back to the lowest semver-ordered open milestone when none are
 *     dated
 *   - `planned`: the open milestone whose version is the smallest greater
 *     than `active`'s — i.e. the next version after the active one, never
 *     a lower version even when `active` was picked by due-date
 *
 * Returns `null` when any of the three slots can't be filled or the
 * GitHub call fails; the caller renders the hard-coded fallback in that
 * case.
 */
export async function fetchRoadmapMilestones(): Promise<RoadmapMilestone[] | null> {
  const url = `${API}/repos/${OWNER}/${REPO}/milestones?state=all&per_page=100`;
  const data = await safeFetchJson<GhMilestone[]>(url);
  if (!data) return null;

  const closed = data
    .filter((m) => m.state === "closed" && m.closed_at)
    .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""));
  const open = data
    .filter((m) => m.state === "open")
    .sort((a, b) => {
      // Dated milestones first, soonest due wins; ties on due_on (and
      // any two undated milestones) fall back to semver-ordered title
      // so `v1.4` lands before `v2.0`, with milestone number as a final
      // stable tie-break.
      if (a.due_on && b.due_on) {
        const dueDiff = a.due_on.localeCompare(b.due_on);
        if (dueDiff !== 0) return dueDiff;
      } else if (a.due_on) return -1;
      else if (b.due_on) return 1;
      const semverDiff = compareVersions(a.title, b.title);
      if (semverDiff !== 0) return semverDiff;
      return a.number - b.number;
    });

  const done = closed[0];
  const active = open[0];
  // "Next open milestone after active" is the smallest open version
  // strictly greater than active's — never a lower version even when
  // active was picked by due-date (e.g. an actively-dated `v2.0` should
  // not produce a `v1.4` planned card).
  const planned = active
    ? open
        .filter((m) => m !== active && compareVersions(m.title, active.title) > 0)
        .sort((a, b) => compareVersions(a.title, b.title))[0]
    : undefined;
  if (!done || !active || !planned) return null;

  const toCard = (m: GhMilestone, state: RoadmapState): RoadmapMilestone => ({
    state,
    title: stripVPrefix(m.title),
    body: m.description?.trim() ? m.description.trim() : null,
    url: m.html_url,
  });
  return [toCard(done, "done"), toCard(active, "active"), toCard(planned, "planned")];
}

// ---------------------------------------------------------------------------
// Relative-time formatter shared across the three surfaces.
// ---------------------------------------------------------------------------

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffSec = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return `${m}m ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return `${h}h ago`;
  }
  const d = Math.floor(diffSec / 86400);
  if (d < 30) return `${d}d ago`;
  if (d < 365) {
    const mo = Math.floor(d / 30);
    return `${mo}mo ago`;
  }
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}
