"""POST /api/v1/parse — parse a single card-list line into a CardQuery."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from mgz_pkmn.parser import CardQuery, parse_line

router = APIRouter()


class ParseRequest(BaseModel):
    line: str


class CardQueryOut(BaseModel):
    raw: str
    name: str
    set_hint: str | None = None
    number: str | None = None
    variant_hint: str | None = None
    url_hint: str | None = None
    bulk_top: int | None = None
    bulk_all: bool = False
    price_min: float | None = None
    price_max: float | None = None


def _query_to_dict(q: CardQuery) -> dict:
    return {
        "raw": q.raw,
        "name": q.name,
        "set_hint": q.set_hint,
        "number": q.number,
        "variant_hint": q.variant_hint,
        "url_hint": q.url_hint,
        "bulk_top": q.bulk_top,
        "bulk_all": q.bulk_all,
        "price_min": q.price_min,
        "price_max": q.price_max,
    }


@router.post("/parse")
def parse(req: ParseRequest) -> dict:
    """Parse a single input line and return the extracted CardQuery fields.

    Returns `{"query": null}` for blank lines, comment lines, or lines that
    produce no parseable card name. Returns `{"query": {...}}` otherwise.
    """
    q = parse_line(req.line)
    if q is None:
        return {"query": None}
    return {"query": _query_to_dict(q)}
