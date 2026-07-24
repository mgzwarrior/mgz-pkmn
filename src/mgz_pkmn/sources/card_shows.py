"""Card-show discovery: a swappable provider interface + a seed-data
implementation.

No live vendor integration exists yet — #972 tracks outreach to Treasure
for a real data-sharing pilot. `SeedCardShowProvider` is the interim data
source backing the discovery surface (#970) until a vendor-backed provider
is ready to swap in; callers only ever depend on `CardShowProvider`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_MI = 3958.8

# Approximate lat/lon centroids for the ZIP codes referenced by SEED_SHOWS.
# A real provider will geocode properly; this only needs to be accurate
# enough to exercise real radius math against the seed data instead of a
# stub that always returns everything.
_ZIP_CENTROIDS: dict[str, tuple[float, float]] = {
    "10001": (40.7506, -73.9972),  # New York, NY
    "07030": (40.7440, -74.0324),  # Hoboken, NJ (~5mi from 10001)
    "90001": (33.9731, -118.2479),  # Los Angeles, CA
    "60601": (41.8853, -87.6216),  # Chicago, IL
}


@dataclass(frozen=True)
class CardShow:
    name: str
    venue: str
    date: date
    url: str
    source: str
    zip_code: str


class CardShowProvider(ABC):
    """Interface a card-show data source must implement.

    The discovery surface (#970) depends only on this interface, never on
    where the data actually comes from — swapping in a vendor-backed
    provider later shouldn't touch any caller.
    """

    @abstractmethod
    def shows_near(self, zip_code: str, radius_mi: int) -> list[CardShow]:
        """Return shows within `radius_mi` of `zip_code`, soonest first."""


SEED_SHOWS: tuple[CardShow, ...] = (
    CardShow(
        name="Empire State Card Show",
        venue="NY Sheraton",
        date=date(2026, 9, 12),
        url="https://example.com/empire-state-card-show",
        source="seed",
        zip_code="10001",
    ),
    CardShow(
        name="SoCal Card Expo",
        venue="LA Convention Center",
        date=date(2026, 8, 22),
        url="https://example.com/socal-card-expo",
        source="seed",
        zip_code="90001",
    ),
    CardShow(
        name="Windy City Card Con",
        venue="McCormick Place",
        date=date(2026, 10, 3),
        url="https://example.com/windy-city-card-con",
        source="seed",
        zip_code="60601",
    ),
)


def _haversine_mi(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = radians(a[0]), radians(a[1])
    lat2, lon2 = radians(b[0]), radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MI * asin(sqrt(h))


class SeedCardShowProvider(CardShowProvider):
    """Manually curated show list. Interim data source until a vendor-backed
    provider (Treasure or otherwise, see #972) replaces it."""

    def __init__(self, shows: tuple[CardShow, ...] = SEED_SHOWS) -> None:
        self._shows = shows

    def shows_near(self, zip_code: str, radius_mi: int) -> list[CardShow]:
        origin = _ZIP_CENTROIDS.get(zip_code)
        if origin is None:
            return []
        matches = [
            show
            for show in self._shows
            if (centroid := _ZIP_CENTROIDS.get(show.zip_code)) is not None
            and _haversine_mi(origin, centroid) <= radius_mi
        ]
        return sorted(matches, key=lambda s: s.date)
