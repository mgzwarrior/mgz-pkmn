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
