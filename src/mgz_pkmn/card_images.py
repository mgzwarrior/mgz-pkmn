"""Warm per-card image bytes onto the unified disk image cache.

Phase 2 of the pre-Scrydex catalog-warm epic (#368). For every card the
warmer can reach (via the same set-walk that `warm_cards` and
`warm_set_cards` already do), this pulls the `images.large` and
`images.small` URLs and persists the bytes under the existing image-cache
layout — `cache/images/cards/large/<card_id>.<ext>` and
`cache/images/cards/small/<card_id>.<ext>`. The serving route at
`/api/v1/cards/{id}/image/{size}` then streams those files instead of
proxying upstream, and the API boundary rewrites `images.small/large` on
lookup responses so the SPA's `<img>` tags hit our disk for free.

The warmer is gated by a hard `--max-bytes` budget so a runaway pass
can't fill the persistent disk. Once cumulative downloaded bytes cross
the cap, the pass exits cleanly with `budget_reached=True` on the
result; the manifest reflects exactly how far it got so a future
incremental pass can pick up where this one stopped (the existing
`skip_existing` short-circuit makes the incremental re-run cheap)."""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

import requests

from . import cache as disk_cache
from .lookup import fetch_set_ids
from .sources import TCGClient

# `large` and `small` are the only two image variants pokemontcg.io
# exposes. We keep them as parallel categories under the unified image
# cache so each size gets its own URL and the serving route can pick
# the right one without sniffing extensions.
LARGE_CATEGORY = "cards/large"
SMALL_CATEGORY = "cards/small"
_CATEGORY_BY_SIZE: dict[str, str] = {
    "large": LARGE_CATEGORY,
    "small": SMALL_CATEGORY,
}

# Order matters: matches the order the issue lists in `--sizes
# large,small` and gives a deterministic walk for tests / progress
# reporting.
SIZE_LARGE = "large"
SIZE_SMALL = "small"
DEFAULT_SIZES: tuple[str, ...] = (SIZE_LARGE, SIZE_SMALL)


@dataclass(frozen=True)
class WarmCardImagesResult:
    """Outcome of a `warm_card_images` run.

    `sets_attempted` / `sets_failed` mirror `warm_cards` — sets whose
    search returned no results are recorded so an operator can spot a
    stale id without trawling logs.

    `images_warmed` counts size-image pairs that exist on disk after the
    pass (newly fetched + already present when `skip_existing=True`).
    `images_failed` is the number of fetch attempts where the writer
    returned no path (network error, write failure, etc.).

    `bytes_written` is cumulative downloaded bytes for *this* pass —
    skipped-existing entries don't add to it. Used to drive the
    `--max-bytes` budget cap.

    `budget_reached` is True when the pass exited early because
    `bytes_written + next download` would exceed `max_bytes`. The
    manifest persists this so subsequent passes don't have to recompute
    the budget state from scratch."""

    sets_attempted: int
    images_warmed: int
    images_failed: int
    bytes_written: int
    budget_reached: bool = False
    sets_failed: list[str] = field(default_factory=list)


def warm_card_images(
    pkmn: TCGClient,
    *,
    set_ids: list[str] | None = None,
    sizes: Iterable[str] = DEFAULT_SIZES,
    max_bytes: int | None = None,
    skip_existing: bool = True,
    throttle_ms: int = 0,
    on_progress: Callable[[int, int, str], None] | None = None,
) -> WarmCardImagesResult:
    """Walk every set's card list and warm each card's image bytes.

    `set_ids`, when provided, restricts the walk to that subset (handy
    for `--sets` in the CLI and for tests). When None, walks the full
    Pokémon TCG catalog via `fetch_set_ids` — same source as the other
    warmers, so a cached set list is shared.

    `sizes` picks which image variants to warm. Order is preserved so
    callers can prioritise (e.g. `("small",)` for a tight-disk warm,
    `("large",)` to skip ahead to the modal-quality variant). Unknown
    size names are skipped silently — the CLI guards against typos at
    parse time, and warming functions are best-effort by design.

    `max_bytes`, when set, is a hard cap on cumulative *downloaded*
    bytes for this pass. Already-cached images don't count toward it
    (they were paid for in a prior pass). The check is "would the next
    write push us over?" — we never partially write past the cap.

    `skip_existing` (default True) short-circuits the per-image fetch
    when `read_image` already returns a path. Mirrors `warm_cards` and
    makes incremental re-runs effectively free.

    `throttle_ms`, when > 0, sleeps for that many milliseconds between
    *set* fetches. Per-card image downloads themselves aren't throttled
    individually — the upstream image CDN is on cloudfront/cloudflare,
    not the rate-limited pokemontcg.io API surface, so the per-set
    sleep is sufficient to stay polite. (If we later see image-CDN
    throttling, we can add a per-image sleep here.)

    `on_progress`, when provided, is invoked once per set with
    `(index, total, set_id)`.
    """
    requested_sizes: list[str] = [s for s in sizes if s in _CATEGORY_BY_SIZE]

    ids = set_ids if set_ids is not None else fetch_set_ids(pkmn)
    total = len(ids)
    images_warmed = 0
    images_failed = 0
    bytes_written = 0
    sets_failed: list[str] = []

    for index, set_id in enumerate(ids, start=1):
        if on_progress is not None:
            on_progress(index, total, set_id)

        # Same query shape as warm_cards / warm_set_cards. The disk-cache
        # hit on `set.id:"X"` keeps this pass free of extra API calls on
        # a freshly-warmed `card_warm.json` / `set_cards_warm.json`
        # neighbour slice.
        query = f'set.id:"{set_id}"'
        cards = pkmn.search_all(query)
        if not cards:
            sets_failed.append(set_id)
            if throttle_ms > 0:
                time.sleep(throttle_ms / 1000.0)
            continue

        for card in cards:
            card_id = card.get("id")
            if not card_id:
                continue
            images = card.get("images") or {}
            for size in requested_sizes:
                url = images.get(size)
                if not url:
                    continue
                category = _CATEGORY_BY_SIZE[size]
                if skip_existing and disk_cache.read_image(category, card_id) is not None:
                    images_warmed += 1
                    continue

                if max_bytes is not None and bytes_written >= max_bytes:
                    return WarmCardImagesResult(
                        sets_attempted=index,
                        images_warmed=images_warmed,
                        images_failed=images_failed,
                        bytes_written=bytes_written,
                        budget_reached=True,
                        sets_failed=sets_failed,
                    )

                content = _download_bytes(pkmn.session, url)
                if content is None:
                    images_failed += 1
                    continue

                # Post-download, pre-write budget check. The pre-check
                # above stops cleanly when we're already at the cap, but
                # it can't see *this* download's size — and a download
                # larger than the remaining budget would otherwise push
                # us past the hard cap. This second check enforces the
                # docstring's "would the next write push us over?"
                # contract exactly (caught in Copilot review of #371).
                if max_bytes is not None and bytes_written + len(content) > max_bytes:
                    return WarmCardImagesResult(
                        sets_attempted=index,
                        images_warmed=images_warmed,
                        images_failed=images_failed,
                        bytes_written=bytes_written,
                        budget_reached=True,
                        sets_failed=sets_failed,
                    )

                path = disk_cache.write_image(category, card_id, content, ext=url)
                if path is None:
                    images_failed += 1
                    continue
                images_warmed += 1
                bytes_written += len(content)

        if throttle_ms > 0:
            time.sleep(throttle_ms / 1000.0)

    return WarmCardImagesResult(
        sets_attempted=total,
        images_warmed=images_warmed,
        images_failed=images_failed,
        bytes_written=bytes_written,
        sets_failed=sets_failed,
    )


def _download_bytes(session: requests.Session, url: str, *, timeout: float = 30.0) -> bytes | None:
    """GET `url` and return its body, or None on any HTTP / network error.

    Mirrors `disk_cache.download_and_cache_image`'s error handling but
    returns the bytes directly so the warmer can measure download size
    *before* committing it to disk — the caller needs the length to
    drive the `--max-bytes` budget."""
    try:
        resp = session.get(url, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException:
        return None
    return resp.content


def parse_bytes_budget(raw: str) -> int:
    """Parse a human-friendly byte budget string (`"5GB"`, `"500MB"`,
    `"1024"`, etc.) into an integer byte count.

    Accepts an optional suffix in {`B`, `KB`, `MB`, `GB`, `TB`}, case
    insensitive, with or without intervening whitespace. Returns the
    raw integer when no suffix is present. Raises `ValueError` on
    anything else — the CLI translates that into a click parse error
    so the operator sees the bad value at submit time, not partway
    through a long warm pass."""
    s = raw.strip().upper().replace(" ", "")
    if not s:
        raise ValueError("empty byte budget")
    multipliers: dict[str, int] = {
        "B": 1,
        "KB": 1024,
        "MB": 1024**2,
        "GB": 1024**3,
        "TB": 1024**4,
    }
    for suffix in ("TB", "GB", "MB", "KB", "B"):
        if s.endswith(suffix):
            num_part = s[: -len(suffix)] or "0"
            try:
                value = float(num_part)
            except ValueError as exc:
                raise ValueError(f"invalid byte budget: {raw!r}") from exc
            if value < 0:
                raise ValueError(f"byte budget must be non-negative: {raw!r}")
            return int(value * multipliers[suffix])
    try:
        value = int(s)
    except ValueError as exc:
        raise ValueError(f"invalid byte budget: {raw!r}") from exc
    # The suffix branch above already rejects negative values; mirror
    # that here for the raw-int path so `--max-bytes -1` fails fast
    # instead of silently producing a negative budget that short-
    # circuits the warmer with budget_reached=True (caught in Copilot
    # review of #371).
    if value < 0:
        raise ValueError(f"byte budget must be non-negative: {raw!r}")
    return value


__all__ = [
    "DEFAULT_SIZES",
    "LARGE_CATEGORY",
    "SIZE_LARGE",
    "SIZE_SMALL",
    "SMALL_CATEGORY",
    "WarmCardImagesResult",
    "parse_bytes_budget",
    "warm_card_images",
]
