"""Lookup module for Pokémon card queries."""

from typing import Any, Dict, List, Optional, Set, Tuple

from mgz_pkmn.db import get_db
from mgz_pkmn.models import Card, Set
from mgz_pkmn.constants import (
    CONCEPT_KEYWORDS,
    SET_FALLBACK_CHAIN,
    SUBTYPE_MAP,
    CARD_TYPES,
)


def find_top_cards(
    query: str,
    limit: int = 20,
    offset: int = 0,
    sort_by: str = "release_date",
    sort_order: str = "desc",
    filters: Optional[Dict[str, Any]] = None,
) -> Tuple[List[Card], int]:
    """Find top N cards matching the given query.

    Args:
        query: Search query string
        limit: Maximum number of results to return
        offset: Number of results to skip
        sort_by: Field to sort by
        sort_order: Sort direction ('asc' or 'desc')
        filters: Additional filters to apply

    Returns:
        Tuple of (list of Card objects, total count)
    """
    filters = filters or {}

    # Step 1: Resolve the set chain
    set_ids = _resolve_set_chain(query, filters)

    # Step 2: Expand concept keywords
    set_ids = _expand_concept_keywords(set_ids, query)

    # Step 3: Build subtype filter
    subtype_filter = _build_subtype_filter(query, filters)

    # Step 4: Execute the bulk query
    cards, total_count = _execute_bulk_query(
        set_ids=set_ids,
        subtype_filter=subtype_filter,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_order=sort_order,
        filters=filters,
    )

    # Step 5: Format results
    return _format_results(cards, total_count)


def _resolve_set_chain(
    query: str,
    filters: Dict[str, Any],
) -> List[str]:
    """Walk the curated set-fallback chain to determine which sets to query.

    Args:
        query: Search query string
        filters: Additional filters that may contain set information

    Returns:
        List of set IDs to query
    """
    set_ids = []

    # Check if a specific set is requested in filters
    if "set_id" in filters:
        set_ids.append(filters["set_id"])
        return set_ids

    # Check if the query matches a known set
    db = get_db()
    known_sets = db.get_all_sets()
    query_lower = query.lower()

    for pkmn_set in known_sets:
        if query_lower in pkmn_set.name.lower() or query_lower in pkmn_set.code.lower():
            set_ids.append(pkmn_set.id)
            break

    # If no specific set found, use the fallback chain
    if not set_ids:
        set_ids = _get_fallback_chain_sets(known_sets)

    return set_ids


def _get_fallback_chain_sets(known_sets: List[Set]) -> List[str]:
    """Get set IDs from the fallback chain.

    Args:
        known_sets: List of all known sets

    Returns:
        List of set IDs from the fallback chain
    """
    set_ids = []
    for chain_set in SET_FALLBACK_CHAIN:
        for pkmn_set in known_sets:
            if pkmn_set.code == chain_set or pkmn_set.name == chain_set:
                set_ids.append(pkmn_set.id)
                break
    return set_ids


def _expand_concept_keywords(
    set_ids: List[str],
    query: str,
) -> List[str]:
    """Expand concept keywords into concrete set IDs.

    Args:
        set_ids: Current list of set IDs
        query: Search query string

    Returns:
        Expanded list of set IDs
    """
    query_lower = query.lower()

    # Check if query contains a concept keyword
    for keyword, expansion_fn in CONCEPT_KEYWORDS.items():
        if keyword in query_lower:
            expanded_sets = expansion_fn()
            set_ids.extend(expanded_sets)
            break

    # Remove duplicates while preserving order
    seen: Set[str] = set()
    unique_set_ids = []
    for set_id in set_ids:
        if set_id not in seen:
            seen.add(set_id)
            unique_set_ids.append(set_id)

    return unique_set_ids


def _build_subtype_filter(
    query: str,
    filters: Dict[str, Any],
) -> Optional[str]:
    """Build the subtype filter for the database query.

    Args:
        query: Search query string
        filters: Additional filters

    Returns:
        Subtype filter string or None
    """
    # Check for explicit subtype filter
    if "subtype" in filters:
        return filters["subtype"]

    # Check if query contains a subtype keyword
    query_lower = query.lower()
    for subtype, keywords in SUBTYPE_MAP.items():
        for keyword in keywords:
            if keyword in query_lower:
                return subtype

    return None


def _execute_bulk_query(
    set_ids: List[str],
    subtype_filter: Optional[str],
    limit: int,
    offset: int,
    sort_by: str,
    sort_order: str,
    filters: Dict[str, Any],
) -> Tuple[List[Card], int]:
    """Execute the bulk database query with proper pagination.

    Args:
        set_ids: List of set IDs to query
        subtype_filter: Optional subtype filter
        limit: Maximum number of results
        offset: Number of results to skip
        sort_by: Field to sort by
        sort_order: Sort direction
        filters: Additional filters

    Returns:
        Tuple of (list of Card objects, total count)
    """
    db = get_db()

    # Build the query parameters
    query_params = {
        "set_ids": set_ids,
        "limit": limit,
        "offset": offset,
        "sort_by": sort_by,
        "sort_order": sort_order,
    }

    # Add subtype filter if present
    if subtype_filter:
        query_params["subtype"] = subtype_filter

    # Add any additional filters
    for key, value in filters.items():
        if key not in ("set_id", "subtype"):
            query_params[key] = value

    # Execute the query
    cards = db.find_cards_by_set_ids(**query_params)
    total_count = db.count_cards_by_set_ids(set_ids=set_ids, subtype=subtype_filter)

    return cards, total_count


def _format_results(
    cards: List[Card],
    total_count: int,
) -> Tuple[List[Card], int]:
    """Format results into the expected output structure.

    Args:
        cards: List of Card objects from the database
        total_count: Total count of matching cards

    Returns:
        Tuple of (list of Card objects, total count)
    """
    # Currently a pass-through, but provides a hook for future
    # formatting logic (e.g., sorting, deduplication, enrichment)
    return cards, total_count