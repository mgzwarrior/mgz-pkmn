"""Rule schema + lazy membership resolver for dynamic collections (#506).

A *dynamic* collection (``Collection.kind == 'dynamic'``) stores a
``rule_json`` predicate instead of owning ``collection_items`` rows. Its
membership is whatever the user already owns that matches the rule — "all
my Eevees", "all my Fire cards", "everything I have from Base Set". Per
[ADR-0025](../../docs/adr/0025-collections-data-model-rework.md), membership
is **never materialised**: it's recomputed on read by querying the promoted
identity columns (``card_name``, ``card_types_json``, ``card_set_id``,
``card_number``, ``card_rarity``) on ``collection_items``. Those columns are
indexed, so resolution is a cheap query rather than a JSON scan, and the
view stays live as the user's inventory grows.

The rule is a small AND-of-predicates dict — a deliberately narrow v1
vocabulary that maps one-to-one onto the promoted columns and is
forward-compatible with the query DSL (ADR-0022): when that grammar lands,
it compiles down to this same predicate shape rather than a new one.

    {
        "name":   "Eevee",       # case-insensitive substring of card_name
        "types":  ["Fire"],      # any overlap with card_types_json
        "set_id": "base1",        # exact card_set_id
        "number": "4",            # exact card_number
        "rarity": "Rare Holo",   # case-insensitive exact card_rarity
    }

Every key is optional, but a rule must carry at least one predicate — an
empty rule would silently mean "every card you own", which is a footgun,
not a feature.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import COLLECTION_KIND_DYNAMIC, Collection, CollectionItem

#: The predicate keys a ``rule_json`` may carry. Anything else is rejected
#: so a typo (``rarties``) surfaces as a 422 instead of silently matching
#: nothing.
RULE_KEYS = ("name", "types", "set_id", "number", "rarity")


class RuleValidationError(ValueError):
    """Raised when a ``rule_json`` is missing, malformed, or empty.

    Carries a human-readable message the route turns into a 422 detail."""


def normalize_rule(raw: Any) -> dict[str, Any]:
    """Validate and clean a caller-supplied rule into canonical form.

    Drops null / blank predicates, lower-bounds the result to at least one
    real predicate, and coerces ``types`` to a list of non-empty strings.
    Raises :class:`RuleValidationError` on anything that can't be a valid
    dynamic rule — the route maps that to a 422."""
    if not isinstance(raw, dict):
        raise RuleValidationError("rule must be an object")

    unknown = set(raw) - set(RULE_KEYS)
    if unknown:
        raise RuleValidationError(
            f"unknown rule key(s): {', '.join(sorted(unknown))}; allowed: {', '.join(RULE_KEYS)}"
        )

    cleaned: dict[str, Any] = {}

    for key in ("name", "set_id", "number", "rarity"):
        val = raw.get(key)
        if val is None:
            continue
        if not isinstance(val, str):
            raise RuleValidationError(f"rule.{key} must be a string")
        val = val.strip()
        if val:
            cleaned[key] = val

    types = raw.get("types")
    if types is not None:
        if not isinstance(types, list):
            raise RuleValidationError("rule.types must be a list of strings")
        coerced = [str(t).strip() for t in types if str(t).strip()]
        if coerced:
            cleaned["types"] = coerced

    if not cleaned:
        raise RuleValidationError("rule must carry at least one predicate")

    return cleaned


def _base_query(user_id: int):
    """Owned-items query scoped to the user, excluding dynamic collections.

    Dynamic collections never own rows, but joining on ``kind`` keeps the
    resolver honest if that invariant ever changes — a dynamic view should
    resolve over *real* inventory, never over another rule's projection."""
    return (
        select(CollectionItem)
        .join(Collection, CollectionItem.collection_id == Collection.id)
        .where(
            Collection.user_id == user_id,
            Collection.kind != COLLECTION_KIND_DYNAMIC,
        )
    )


def _apply_sql_predicates(stmt, rule: dict[str, Any]):
    """Push the column-indexed predicates down into SQL.

    ``types`` is deliberately left for :func:`_types_match` — JSON-array
    overlap isn't portably expressible across SQLite and Postgres, and the
    candidate set (one user's own cards) is small enough that a Python
    post-filter costs nothing."""
    if "name" in rule:
        stmt = stmt.where(func.lower(CollectionItem.card_name).contains(rule["name"].lower()))
    if "set_id" in rule:
        stmt = stmt.where(CollectionItem.card_set_id == rule["set_id"])
    if "number" in rule:
        stmt = stmt.where(CollectionItem.card_number == rule["number"])
    if "rarity" in rule:
        stmt = stmt.where(func.lower(CollectionItem.card_rarity) == rule["rarity"].lower())
    return stmt


def _types_match(item: CollectionItem, wanted: list[str]) -> bool:
    """True when the item's types overlap (case-insensitively) with any
    wanted type. Cards with no recorded types never match a type rule."""
    have = item.card_types_json or []
    have_lower = {str(t).lower() for t in have}
    return any(w.lower() in have_lower for w in wanted)


def resolve_dynamic_items(db: Session, user_id: int, rule: dict[str, Any]) -> list[CollectionItem]:
    """Return the user's owned items matching ``rule``, newest first.

    No deduplication: each owned copy is its own row, mirroring how a manual
    collection renders its items. Two binders holding the same Eevee surface
    as two rows — that's truthful inventory, not a bug."""
    stmt = _apply_sql_predicates(_base_query(user_id), rule).order_by(
        CollectionItem.added_at.desc(), CollectionItem.id.desc()
    )
    items = list(db.scalars(stmt).all())
    wanted_types = rule.get("types")
    if wanted_types:
        items = [it for it in items if _types_match(it, wanted_types)]
    return items


def rule_to_lucene(rule: dict[str, Any]) -> str:
    """Translate a rule into a pokemontcg.io Lucene query (#631, catalog scope).

    Maps each predicate onto the catalog's field syntax and ANDs them with
    spaces (Lucene's implicit AND). ``name`` becomes a prefix wildcard so
    "Eevee" catches "Eevee ex" / "Eevee VMAX"; the rest are exact-field
    matches. Multiple ``types`` AND together — a dual-type match, which is
    the same semantics the owned-scope resolver uses.

    Forward-compatible with ADR-0022: when the DSL planner lands it can own
    this translation, but for now the rule maps cleanly enough that a direct
    builder is simpler than standing up the planner."""
    parts: list[str] = []
    name = rule.get("name")
    if name:
        token = name.replace('"', "")
        # Prefix wildcard. Quote multi-word names so the wildcard binds to
        # the whole value rather than just the last token.
        parts.append(f'name:"{token}*"' if " " in token else f"name:{token}*")
    for t in rule.get("types", []) or []:
        parts.append(f'types:"{t}"' if " " in t else f"types:{t}")
    if rule.get("set_id"):
        parts.append(f'set.id:"{rule["set_id"]}"')
    if rule.get("number"):
        parts.append(f'number:"{rule["number"]}"')
    if rule.get("rarity"):
        parts.append(f'rarity:"{rule["rarity"]}"')
    return " ".join(parts)


def owned_quantity_map(db: Session, user_id: int) -> dict[tuple[str, str], int]:
    """Map ``(card_set_id, card_number) -> total owned quantity`` for the user.

    The overlay key for catalog-scope resolution: a catalog card is "owned"
    iff its identity is in this map. Sums ``quantity`` across every binder so
    two copies in two collections read as quantity 2. Only rows with a full
    promoted identity participate — a card we couldn't promote can't be
    matched against the catalog anyway."""
    rows = db.execute(
        select(
            CollectionItem.card_set_id,
            CollectionItem.card_number,
            func.coalesce(func.sum(CollectionItem.quantity), 0),
        )
        .join(Collection, CollectionItem.collection_id == Collection.id)
        .where(
            Collection.user_id == user_id,
            Collection.kind != COLLECTION_KIND_DYNAMIC,
            CollectionItem.card_set_id.is_not(None),
            CollectionItem.card_number.is_not(None),
        )
        .group_by(CollectionItem.card_set_id, CollectionItem.card_number)
    ).all()
    return {(set_id, number): int(qty) for set_id, number, qty in rows}


def count_dynamic_items(db: Session, user_id: int, rule: dict[str, Any]) -> int:
    """Count of resolved members — the badge number for the list view.

    Falls back to counting resolved rows in Python when the rule carries a
    ``types`` predicate (which can't be pushed to SQL); otherwise issues a
    cheap ``COUNT(*)`` against the indexed predicates."""
    if rule.get("types"):
        return len(resolve_dynamic_items(db, user_id, rule))
    stmt = _apply_sql_predicates(
        select(func.count(CollectionItem.id))
        .join(Collection, CollectionItem.collection_id == Collection.id)
        .where(
            Collection.user_id == user_id,
            Collection.kind != COLLECTION_KIND_DYNAMIC,
        ),
        rule,
    )
    return int(db.scalar(stmt) or 0)
