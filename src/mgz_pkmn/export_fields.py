"""Canonical field keys for the configurable-export toggle (#262).

Each export format renders a different subset of card data — the constants
below are the single source of truth the API route and the writers both
consult, so a field the web UI offers always matches a field a writer
actually knows how to hide."""

from __future__ import annotations

THUMBNAIL = "thumbnail"
NAME = "name"
SET = "set"
NUMBER = "number"
RARITY = "rarity"
VARIANT = "variant"
MARKET = "market"
COMP_80 = "comp_80"
COMP_85 = "comp_85"
COMP_90 = "comp_90"
COMP_95 = "comp_95"
SOURCE = "source"
SOURCE_URL = "source_url"

XLSX_FIELDS = (
    THUMBNAIL,
    NAME,
    SET,
    NUMBER,
    RARITY,
    VARIANT,
    MARKET,
    COMP_80,
    COMP_85,
    COMP_90,
    COMP_95,
    SOURCE,
    SOURCE_URL,
)

# The binder PDFs (standard + condensed share this renderer) don't lay out
# rarity, variant, price source, or the source URL at all today — the
# caption block is a fixed 8-line stack (name, #/total, set, market, four
# comps). Adding those fields is a caption-geometry change, not a toggle;
# until that lands they're simply not in the set the web UI can offer for
# `pdf` / `condensed-pdf`.
BINDER_FIELDS = (THUMBNAIL, NAME, SET, NUMBER, MARKET, COMP_80, COMP_85, COMP_90, COMP_95)

CHECKLIST_FIELDS = (NAME, SET, NUMBER, RARITY, MARKET)

SUPPORTED_FIELDS: dict[str, tuple[str, ...]] = {
    "xlsx": XLSX_FIELDS,
    "pdf": BINDER_FIELDS,
    "condensed-pdf": BINDER_FIELDS,
    "checklist": CHECKLIST_FIELDS,
}


def resolve_fields(export_format: str, fields: list[str] | None) -> frozenset[str]:
    """Return the enabled field-key set for `export_format`.

    `None` — the CLI's default, and any web request that omits the param —
    means "everything this format supports", i.e. today's unfiltered
    output. Unknown or unsupported keys are dropped rather than raising, so
    a stale web client's cached field list can't break a request."""
    supported = SUPPORTED_FIELDS[export_format]
    if fields is None:
        return frozenset(supported)
    return frozenset(f for f in fields if f in supported)
