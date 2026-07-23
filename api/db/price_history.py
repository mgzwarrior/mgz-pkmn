"""Write + read helpers for the 30-day price-trend sparkline (#269).

Backed by `PriceSnapshot` (`price_snapshots`) — see that model's docstring
for why writes are per-lookup rather than deduplicated. The downsampling
that keeps the trend clean happens entirely on the read side, in
`fetch_price_history`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import PriceSnapshot

#: Window the sparkline covers, per the issue (#269).
HISTORY_WINDOW_DAYS = 30
#: Minimum distinct days of history before a trend is worth drawing — a
#: single point is just today's price, not a trend.
_MIN_POINTS = 2


def record_price_snapshot(
    session: Session,
    *,
    card_set_id: str | None,
    card_number: str | None,
    source: str | None,
    price: float | None,
    currency: str | None,
) -> None:
    """Insert one observation, or no-op if the card/price isn't resolvable.

    Doesn't commit — callers batch several snapshots (one per matched row
    in a lookup/bulk request) into a single commit."""
    if not card_set_id or not card_number or price is None:
        return
    session.add(
        PriceSnapshot(
            card_set_id=card_set_id,
            card_number=card_number,
            source=source,
            price=price,
            currency=currency or "USD",
        )
    )


def fetch_price_history(
    session: Session,
    *,
    card_set_id: str,
    card_number: str,
    currency: str,
    now: datetime | None = None,
) -> list[dict[str, Any]] | None:
    """Up to `HISTORY_WINDOW_DAYS` of history for one card, downsampled to
    one point per calendar day (the latest snapshot that day wins).

    Scoped to `currency` — the same card can carry snapshots from sources
    in different currencies (USD from TCGPlayer/PriceCharting, EUR from
    Cardmarket per `mgz_pkmn.pricing`), and mixing raw amounts across
    currencies would make the returned series' min/max/delta meaningless
    against the row's own currency. Callers pass the currency of the row
    the history is for.

    Returns `None` when fewer than two distinct days of history exist —
    the API/SPA treat that as "no trend yet" rather than a one-point line.
    Points are `{"ts": "YYYY-MM-DD", "price": float}`, oldest first."""
    since = (now or datetime.now(UTC)) - timedelta(days=HISTORY_WINDOW_DAYS)
    rows = session.execute(
        select(PriceSnapshot.captured_at, PriceSnapshot.price)
        .where(
            PriceSnapshot.card_set_id == card_set_id,
            PriceSnapshot.card_number == card_number,
            PriceSnapshot.currency == currency,
            PriceSnapshot.captured_at >= since,
        )
        .order_by(PriceSnapshot.captured_at.asc())
    ).all()

    # Ascending order means later rows overwrite earlier ones for the same
    # day, so `by_day` ends up holding each day's most recent price.
    by_day: dict[str, float] = {}
    for captured_at, price in rows:
        by_day[captured_at.date().isoformat()] = float(price)

    if len(by_day) < _MIN_POINTS:
        return None
    return [{"ts": day, "price": by_day[day]} for day in sorted(by_day)]
