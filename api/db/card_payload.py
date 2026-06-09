"""Extract promoted card-identity columns from a verbatim ``card_json`` payload.

The persistence layer keeps ``card_json`` as the source of truth for the
long tail of source-side fields, but a small set of identity columns are
promoted into typed SQL so cross-collection lookup, set-completion
queries, and the insights dashboard can be real indexed queries instead
of JSON scans.

This module is the single place that knows how to pull those fields out
of a pokemontcg.io-shaped payload. It's used both by the insert routes
(at write time) and by the migration backfill (one-shot pass over the
existing rows). Keeping the extractor in one module means a payload-shape
drift is a single-file change with one set of tests.

The extractor is intentionally forgiving — every field is optional and
defaults to ``None``. A missing or malformed payload yields a row with
nulls in the promoted columns and the original ``card_json`` intact; the
SPA falls back to reading from ``card_json`` for any nulls.
"""

from __future__ import annotations

from typing import Any


def extract_card_identity(card: dict[str, Any] | None) -> dict[str, Any]:
    """Return a dict of promoted column values for the given card payload.

    Keys: ``card_set_id``, ``card_number``, ``card_name``, ``card_rarity``,
    ``card_types_json``, ``card_image_url``. All values nullable.

    Price snapshot is handled separately by :func:`extract_price_snapshot`
    because it needs a clock to set ``priced_at`` and the migration
    backfill deliberately skips it (we don't know historical prices)."""
    if not isinstance(card, dict):
        return {
            "card_set_id": None,
            "card_number": None,
            "card_name": None,
            "card_rarity": None,
            "card_types_json": None,
            "card_image_url": None,
        }

    set_obj = card.get("set")
    set_id: str | None = None
    if isinstance(set_obj, dict):
        raw = set_obj.get("id")
        set_id = str(raw) if raw else None
    if not set_id:
        # Fall back to splitting card.id on '-'. pokemontcg.io ids are
        # ``<set_id>-<number>`` (e.g. ``base1-4``); the leading segment
        # is the set id.
        raw_id = card.get("id")
        if isinstance(raw_id, str) and "-" in raw_id:
            set_id = raw_id.rsplit("-", 1)[0] or None

    number = card.get("number")
    name = card.get("name")
    rarity = card.get("rarity")

    types = card.get("types")
    types_json: list[str] | None = None
    if isinstance(types, list):
        # Keep order; coerce to str so a stray int doesn't poison the JSON column.
        types_json = [str(t) for t in types if t]

    images = card.get("images")
    image_url: str | None = None
    if isinstance(images, dict):
        # Prefer small (faster in the grid); fall back to large.
        for key in ("small", "large"):
            v = images.get(key)
            if isinstance(v, str) and v:
                image_url = v
                break

    return {
        "card_set_id": _as_str(set_id),
        "card_number": _as_str(number),
        "card_name": _as_str(name),
        "card_rarity": _as_str(rarity),
        "card_types_json": types_json,
        "card_image_url": image_url,
    }


def extract_price_snapshot(card: dict[str, Any] | None) -> float | None:
    """Best-effort market-price extraction from a card payload.

    Tries the most common shapes pokemontcg.io / our pricing pipeline
    emit, in priority order. Returns ``None`` if no recognizable price
    is found — the column stays null and the dashboard renders "no
    snapshot yet."

    Kept conservative: we'd rather emit ``None`` than a wrong number,
    since this value lands in the value-over-time chart unmodified."""
    if not isinstance(card, dict):
        return None

    # Our own pipeline often attaches a flattened ``market_price`` for
    # speed. Honor it first.
    direct = card.get("market_price")
    if isinstance(direct, int | float) and direct > 0:
        return float(direct)

    tcgp = card.get("tcgplayer")
    if isinstance(tcgp, dict):
        prices = tcgp.get("prices")
        if isinstance(prices, dict):
            # Variant keys (normal, holofoil, reverseHolofoil, …) carry
            # the actual market value. Take the highest market across
            # variants — that's the chase printing the user is most
            # likely tracking.
            best: float | None = None
            for variant in prices.values():
                if not isinstance(variant, dict):
                    continue
                m = variant.get("market")
                if isinstance(m, int | float) and m > 0 and (best is None or m > best):
                    best = float(m)
            if best is not None:
                return best

    cm = card.get("cardmarket")
    if isinstance(cm, dict):
        prices = cm.get("prices")
        if isinstance(prices, dict):
            for key in ("averageSellPrice", "trendPrice", "avg30"):
                v = prices.get(key)
                if isinstance(v, int | float) and v > 0:
                    return float(v)

    return None


def _as_str(v: Any) -> str | None:
    """Coerce a value to a non-empty trimmed string, or ``None``."""
    if v is None:
        return None
    s = str(v).strip()
    return s or None
