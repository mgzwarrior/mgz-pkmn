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
