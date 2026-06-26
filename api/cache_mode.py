"""Global cache-only switch for the FastAPI surface.

``MGZ_PKMN_CACHE_ONLY`` forces every card-data route into the same
``cache_only`` posture the lookup pipeline already supports
(``src/mgz_pkmn/sources/pokemontcg.py``): a disk-cache miss degrades to an
empty ``MISS-CACHE-ONLY`` result instead of fetching pokemontcg.io.

The load-bearing caller is the end-to-end suite. Now that the SPA opens on
Swipe and the deck samples a random set from the bundled catalog, a set that
isn't in the committed cassette would otherwise trigger a live upstream fetch
(``api/routes/sets.py:_fetch_set_cards``), breaking the "network-free"
guarantee. ``web/e2e/boot-api.sh`` sets this flag so a run can never reach
the network regardless of which set the deck picks. Off-default, so
production/self-host behaviour is unchanged."""

from __future__ import annotations

import os

#: Env var that pins the API to cache-only resolution. Off-default.
CACHE_ONLY_ENV = "MGZ_PKMN_CACHE_ONLY"


def cache_only_enabled() -> bool:
    """True when ``MGZ_PKMN_CACHE_ONLY`` is a truthy string.

    Same parse rules as the other API gates (``auth_enabled``, the
    warm-on-startup flags): accepts ``1`` / ``true`` / ``True``; anything
    else (including unset) reads as off."""
    return os.environ.get(CACHE_ONLY_ENV, "").strip() in ("1", "true", "True")
