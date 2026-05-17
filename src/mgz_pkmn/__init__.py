"""Pokemon card list -> spreadsheet for card shows."""

__version__ = "1.0.2rc1"

from mgz_pkmn.parser import CardQuery, parse_lines

__all__ = ["CardQuery", "parse_lines"]
