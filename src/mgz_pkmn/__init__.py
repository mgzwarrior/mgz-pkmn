"""Pokemon card list -> spreadsheet for card shows."""

__version__ = "1.6.1"  # x-release-please-version

from mgz_pkmn.parser import CardQuery, parse_lines

__all__ = ["CardQuery", "parse_lines"]
