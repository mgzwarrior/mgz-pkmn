"""Shared lookup primitives: MatchResult, scoring, set-overlap, name clause."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..parser import CardQuery


@dataclass
class MatchResult:
    card: dict[str, Any] | None
    # Core reasons emitted by the lookup module:
    #   "matched" | "no_candidates" | "set_mismatch" | "scrape_failed" |
    #   "price_mismatch"
    # Higher layers (API routes) may synthesize their own values
    # (e.g. "error", "unparseable") when surfacing results to clients, so the
    # set is non-exhaustive.
    reason: str
    # Set when reason="scrape_failed" so callers can name the URL in error
    # messages. Left None for the other reasons.
    url: str | None = None
    # Split-cache freshness signal (#372). One of "HIT" / "STALE" / "MISS" /
    # "MISS-CACHE-ONLY". Threaded up from `TCGClient._fetch_page` so route
    # handlers can attach an `X-Cache` response header (#310). Default "MISS"
    # covers paths that bypass the disk-cache layer entirely (PriceCharting
    # scrape, TCGdex — neither has disk persistence today).
    cache_status: str = "MISS"
    # Other plausible matches, ranked highest-scoring first (`card` is always
    # `candidates[0]` when set). Populated only when the candidate pool that
    # produced `card` had more than one entry after set/number filtering —
    # an ambiguous name-only query like "Charizard" — so callers can offer a
    # picklist instead of silently committing to one printing (#948). `None`
    # for unambiguous matches and every non-"matched" reason.
    candidates: list[dict[str, Any]] | None = None


def worse_cache_status(*statuses: str) -> str:
    """Aggregate cache statuses across multiple reads.

    MISS-CACHE-ONLY > MISS > STALE > HIT.

    Used when a single response combines several cache lookups (e.g. paged
    `search_all` results, or multi-query lookup fallback chains)."""
    priority = {"MISS-CACHE-ONLY": 3, "MISS": 2, "STALE": 1, "HIT": 0}
    return max(statuses, key=lambda s: priority.get(s, 2))


def set_overlap(card: dict[str, Any], hint: str) -> bool:
    """True if the card's set or series shares text with the user's hint."""
    s = card.get("set") or {}
    name = (s.get("name") or "").lower()
    series = (s.get("series") or "").lower()
    h = hint.lower().strip()
    if not h:
        return True
    if h in name or name in h:
        return True
    return h in series


def name_clause(name: str) -> str:
    """Build a Lucene name clause that's tolerant of small variations."""
    cleaned = name.strip()
    if not cleaned:
        return "name:*"
    if " " in cleaned:
        return f'name:"{cleaned}"'
    return f"name:{cleaned}"


def rank_candidates(
    cards: list[dict[str, Any]], q: CardQuery, *, cap: int = 10
) -> list[dict[str, Any]]:
    """Dedup `cards` by id and sort by `score_card` descending, capped at `cap`.

    Used to build `MatchResult.candidates` — the winner is always
    `rank_candidates(...)[0]`, matching the `max(..., key=score_card)` pick
    each source already made before this helper existed."""
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for c in cards:
        cid = c.get("id")
        if cid is not None:
            if cid in seen:
                continue
            seen.add(cid)
        deduped.append(c)
    return sorted(deduped, key=lambda c: score_card(c, q), reverse=True)[:cap]


def score_card(card: dict[str, Any], q: CardQuery) -> float:
    """Rank candidate cards against the user's CardQuery."""
    score = 0.0
    name = (card.get("name") or "").lower()
    qname = q.name.lower()
    if name == qname:
        score += 10
    elif qname in name or name in qname:
        score += 5

    if q.number:
        num_clean = q.number.split("/")[0]
        if (card.get("number") or "").lower() == num_clean.lower():
            score += 8

    if q.set_hint:
        set_name = (card.get("set", {}).get("name") or "").lower()
        set_series = (card.get("set", {}).get("series") or "").lower()
        hint = q.set_hint.lower()
        if set_name == hint:
            score += 9  # exact set name beats any substring match
        elif hint in set_name or set_name in hint:
            score += 3
        elif set_series == hint:
            score += 4
        elif hint in set_series:
            score += 2

    # Mild preference for cards with pricing data — they're more useful.
    if card.get("tcgplayer", {}).get("prices"):
        score += 0.5
    return score
