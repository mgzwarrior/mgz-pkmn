"""Extract promoted product-identity columns from a ``product_json`` payload.

The sealed-item tables (#882) follow the same pattern as the card side:
``product_json`` stays the verbatim source of truth, and a small set of
identity columns are promoted into typed SQL so set-level lookups and the
insights dashboard are indexed queries instead of JSON scans.

Unlike cards there is no single upstream schema — a payload may come from
a PriceCharting scrape or from manual entry — so the extractor accepts
both flat keys (``set_id``, ``product_type``, ``image_url``) and the
nested card-style shape (``set.id``, ``images.small``). It mirrors
:mod:`api.db.card_payload`'s contract: intentionally forgiving, every
field optional and defaulting to ``None``, never raises. Vocabulary
validation (``product_type`` against ``PRODUCT_TYPES``) is the API
layer's job at write time, not the extractor's.
"""

from __future__ import annotations

from typing import Any


def extract_product_identity(product: dict[str, Any] | None) -> dict[str, Any]:
    """Return a dict of promoted column values for the given product payload.

    Keys: ``product_set_id``, ``product_name``, ``product_type``,
    ``product_language``, ``product_image_url``. All values nullable."""
    if not isinstance(product, dict):
        return {
            "product_set_id": None,
            "product_name": None,
            "product_type": None,
            "product_language": None,
            "product_image_url": None,
        }

    set_id = product.get("set_id")
    if not set_id:
        set_obj = product.get("set")
        if isinstance(set_obj, dict):
            set_id = set_obj.get("id")

    product_type = product.get("product_type")
    if not product_type:
        product_type = product.get("type")

    image_url = product.get("image_url")
    if not image_url:
        images = product.get("images")
        if isinstance(images, dict):
            for key in ("small", "large"):
                v = images.get(key)
                if isinstance(v, str) and v:
                    image_url = v
                    break

    return {
        "product_set_id": _as_str(set_id),
        "product_name": _as_str(product.get("name")),
        "product_type": _as_str(product_type),
        "product_language": _as_str(product.get("language")),
        "product_image_url": _as_str(image_url) if isinstance(image_url, str) else None,
    }


def _as_str(v: Any) -> str | None:
    """Coerce a value to a non-empty trimmed string, or ``None``."""
    if v is None or isinstance(v, dict | list):
        return None
    s = str(v).strip()
    return s or None
