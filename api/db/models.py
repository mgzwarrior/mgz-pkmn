"""SQLAlchemy 2 models for the persistence layer (ADR-0013).

Three tables in this slice:

- `users` — one row per logical user. v1 seeds a single sentinel `default`
  row (`id=1`); the FK exists on every per-user table so #61 (auth) is a
  contained backfill rather than a wire-format rewrite.
- `runs` — one row per completed lookup pipeline.
- `run_rows` — one row per resolved `Row`. `market_price` and `currency`
  are promoted out of `pricing_json` into typed columns so list filters
  (the existing `--max-price` flag, future above-cap highlighting) are
  real SQL queries; the rest of the pricing/card/query payloads stay in
  JSON columns so source-side drift doesn't force schema changes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

DEFAULT_USER_ID = 1
DEFAULT_USER_NAME = "default"


def _utcnow() -> datetime:
    """Server-default-compatible timestamp factory.

    SQLAlchemy lets us pass a Python callable as ``default`` so test code
    can monkeypatch the wall clock if needed; using ``datetime.now(UTC)``
    keeps the stored values timezone-aware and UTC-normalised."""
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """Single declarative base — shared across every table the API persists."""


#: Provider tags stored verbatim in ``user_identities.provider``. Kept as
#: bare strings (no Enum) so adding a future provider is a code change in
#: exactly one place (`api/auth/identity.py`) — the column is just a tag.
PROVIDER_GITHUB = "github"
PROVIDER_GOOGLE = "google"
PROVIDER_DISCORD = "discord"
PROVIDER_MAGIC = "magic"
PROVIDER_APPLE = "apple"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    # Auth columns, populated only when one of the sign-in flows from #61
    # upserts a row. Nullable so the sentinel `default` user (and any
    # self-hosted-anonymous future row) keeps working.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    runs: Mapped[list[Run]] = relationship(back_populates="user")
    identities: Mapped[list[UserIdentity]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserIdentity(Base):
    """One row per (provider, provider_subject) attached to a ``User``.

    Promotes "which provider did this row originate from" from an
    implicit `users.name` prefix into a first-class concept the auth
    surface can list, attach, and detach against (#491, slice 1 — the
    backend foundation; link / unlink endpoints + SPA panel are slices
    2 / 3 of the same epic).

    The lookup contract that lives on top of this row is in
    :mod:`api.auth.identity`: callbacks resolve ``(provider, subject)``
    first, fall back to the verified email, and mint a new ``users`` +
    first identity row only on a cold miss."""

    __tablename__ = "user_identities"
    __table_args__ = (
        # A given provider identity can attach to at most one account.
        # This is what makes "sign in via Google with the email I used
        # for GitHub last week" land on the existing row instead of
        # silently minting a duplicate.
        UniqueConstraint("provider", "provider_subject", name="uq_user_identity_provider_subject"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    #: Provider tag — one of :data:`PROVIDER_GITHUB`, :data:`PROVIDER_GOOGLE`,
    #: :data:`PROVIDER_DISCORD`, :data:`PROVIDER_MAGIC`, :data:`PROVIDER_APPLE`.
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Provider-side stable identifier. GitHub login, Google ``sub``, or
    #: (for magic-link) the verified email itself — there's no other
    #: anchor on that path.
    provider_subject: Mapped[str] = mapped_column(String(128), nullable=False)
    #: Email at link time. May drift from ``users.email`` if the user's
    #: primary email on that provider changes later — we don't try to
    #: stay in sync, the email on the identity row reflects what the
    #: provider sent on the most recent sign-in for this identity.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    user: Mapped[User] = relationship(back_populates="identities")


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), default=DEFAULT_USER_ID, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    elapsed_seconds: Mapped[float | None] = mapped_column(nullable=True)
    input_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Lightweight aggregate (matched/missed counts, totals, per-tag breakdown)
    # so sidebar listing doesn't need to load run_rows.
    summary_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    # Non-NULL once the user "saves" the run as a named search. The sidebar
    # filters on this — unnamed runs stay in the table (so re-export and a
    # future "recents" surface can still find them) but don't clutter the
    # saved list.
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Snapshot of the ResultsTable sort + column-filter state at save time.
    # Replayed on click-to-load so a saved search re-opens with the exact
    # view the user was looking at.
    view_state: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    user: Mapped[User] = relationship(back_populates="runs")
    rows: Mapped[list[RunRow]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="RunRow.position",
    )


#: Allowed values for ``Collection.kind``. ``manual`` is the default
#: catalog ("Show Binder", "Trade Stock"); ``set`` anchors to a
#: ``source_set_id`` so completion % is well-defined; ``dynamic``
#: stores a ``rule_json`` and recomputes membership. See #506.
COLLECTION_KIND_MANUAL = "manual"
COLLECTION_KIND_SET = "set"
COLLECTION_KIND_DYNAMIC = "dynamic"
#: A ``binder`` is a manual bucket with physical-binder identity (#679): a
#: pocket ``binder_format``, a cover ``binder_color``, an optional slot
#: ``capacity``, and an ``is_master_set`` target flag. It rides the same
#: ``collection_items`` machinery as ``manual`` — the extra columns are just
#: identity — so ownership badges, insights, and the ID-card PDF work as-is.
COLLECTION_KIND_BINDER = "binder"

#: Allowed ``Collection.binder_format`` values — the page pocket layout.
#: Null for non-binder kinds (and binders that haven't chosen one). See #679.
BINDER_FORMAT_4_POCKET = "4-pocket"
BINDER_FORMAT_9_POCKET = "9-pocket"
BINDER_FORMAT_12_POCKET = "12-pocket"
BINDER_FORMATS = (BINDER_FORMAT_4_POCKET, BINDER_FORMAT_9_POCKET, BINDER_FORMAT_12_POCKET)

#: Allowed ``Collection.binder_color`` values — design-token palette names
#: (``design/tokens/colors_and_type.css``) used to tint the cover swatch in
#: the library list. Stored as the token stem so the SPA maps it to
#: ``bg-<color>-500`` without a lookup table. See #679.
BINDER_COLORS = ("palm", "sun", "sky", "ember", "coconut", "sand")

#: Allowed values for ``Collection.dynamic_scope`` (#631). ``owned`` matches
#: the rule against the user's own cards — an inventory view (the #630
#: default). ``catalog`` resolves the full matching set from pokemontcg.io
#: and overlays ownership — a goal-with-progress target view. A null column
#: reads as ``owned``.
DYNAMIC_SCOPE_OWNED = "owned"
DYNAMIC_SCOPE_CATALOG = "catalog"

#: Allowed values for ``CollectionItem.added_via`` — provenance tag,
#: used by the insights dashboard to answer "how do users actually get
#: cards into their collections."
ADDED_VIA_MANUAL = "manual"
ADDED_VIA_WISHLIST_PROMOTE = "wishlist_promote"
ADDED_VIA_HAUL = "haul"
ADDED_VIA_DYNAMIC_MATCH = "dynamic_match"
ADDED_VIA_SWIPE = "swipe"


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), default=DEFAULT_USER_ID, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    # ---- v1.5 collections-rework columns (#574) ----
    #: One of ``manual``, ``set``, ``dynamic``. Default keeps existing
    #: behavior unchanged. Set-based and dynamic kinds ride #506 — the
    #: column exists now so future migrations are additive.
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default=COLLECTION_KIND_MANUAL)
    #: Required when ``kind == 'set'``. Matches the promoted
    #: ``card_set_id`` on items, so set-completion is a single JOIN.
    source_set_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Required when ``kind == 'dynamic'``. Stores the rule definition
    #: (the query DSL from ADR-0022); the membership query is recomputed
    #: lazily and never materialised as ``collection_items`` rows.
    rule_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    #: Only meaningful when ``kind == 'dynamic'`` (#631). One of ``owned`` /
    #: ``catalog``; null reads as ``owned``. ``catalog`` flips the rule from
    #: an inventory view into a catalog-backed target view with progress.
    dynamic_scope: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # ---- #679: physical-binder identity (only meaningful for kind='binder') ----
    #: Page pocket layout — one of :data:`BINDER_FORMATS`. Null when unset.
    binder_format: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: Cover color — a design-token palette stem from :data:`BINDER_COLORS`.
    binder_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: Total card slots, so the list can show how full the binder is. Null
    #: when the collector hasn't pinned a size.
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Whether the binder targets the *master set* of the set it organizes
    #: (``source_set_id``). Nullable so rows predating #679 read as not-master.
    is_master_set: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    items: Mapped[list[CollectionItem]] = relationship(
        back_populates="collection",
        cascade="all, delete-orphan",
        order_by="CollectionItem.added_at",
    )
    snapshots: Mapped[list[CollectionSnapshot]] = relationship(
        back_populates="collection",
        cascade="all, delete-orphan",
        order_by="CollectionSnapshot.captured_at",
    )


class CollectionItem(Base):
    __tablename__ = "collection_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection_id: Mapped[int] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), nullable=False
    )
    # Verbatim matched card payload — the only stable handle across re-lookups.
    card_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    # ---- v1.5 collections-rework columns (#574) ----
    #: Vendor multiples. Default 1 keeps existing behavior unchanged.
    #: Per-condition (NM/LP/MP/HP/DM) breakdown is a deliberate future
    #: child — don't collapse it into this column.
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    #: Promoted card-identity columns, extracted from ``card_json`` at
    #: insert. ``card_json`` stays as source of truth for unpromoted
    #: fields; these exist so cross-collection lookup, set-completion,
    #: and the insights dashboard are indexed SQL instead of JSON scans.
    #: See :mod:`api.db.card_payload` for the extractor.
    card_set_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    card_number: Mapped[str | None] = mapped_column(String(16), nullable=True)
    card_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    card_rarity: Mapped[str | None] = mapped_column(String(64), nullable=True)
    card_types_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    card_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    #: Snapshot at insert time. Powers value-over-time + top-N. Null when
    #: the payload didn't carry a recognizable price.
    price_snapshot: Mapped[float | None] = mapped_column(
        Numeric(12, 2, asdecimal=False), nullable=True
    )
    priced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Provenance tag — one of the ``ADDED_VIA_*`` constants. Nullable
    #: on backfilled rows; new inserts always set it.
    added_via: Mapped[str | None] = mapped_column(String(32), nullable=True)

    collection: Mapped[Collection] = relationship(back_populates="items")


class CollectionSnapshot(Base):
    """Periodic snapshot of a collection's headline metrics.

    Backs the value-over-time chart on the insights dashboard (#575) and
    the set-ID-card progress view (#508). Written on item add/remove and
    by a nightly cron (separate child issue). Append-only — old rows are
    history, not state to mutate."""

    __tablename__ = "collection_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection_id: Mapped[int] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), nullable=False
    )
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    #: Distinct cards (ignores quantity).
    unique_cards: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Sum of ``CollectionItem.quantity`` at snapshot time.
    total_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Sum of ``price_snapshot * quantity`` in cents (integer to avoid
    #: float drift on charts that subtract day-over-day).
    est_value_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: For ``kind == 'set'`` collections: ``unique_cards / total_in_set``
    #: as a fraction in [0, 1]. Null for non-set collections.
    set_completion_pct: Mapped[float | None] = mapped_column(
        Numeric(5, 4, asdecimal=False), nullable=True
    )
    #: Free-form room for headline breakdowns (top rarity, top type) so
    #: the dashboard doesn't have to recompute them on every render.
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    collection: Mapped[Collection] = relationship(back_populates="snapshots")


class Wishlist(Base):
    __tablename__ = "wishlists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), default=DEFAULT_USER_ID, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    # ---- v1.5 collections-rework column (#574) ----
    #: Optional "for the Allentown show on June 14" anchor. Powers
    #: post-show retrospectives in the insights dashboard. Route plumbing
    #: rides on #504.
    target_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list[WishlistItem]] = relationship(
        back_populates="wishlist",
        cascade="all, delete-orphan",
        order_by="WishlistItem.added_at",
    )


class WishlistItem(Base):
    __tablename__ = "wishlist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wishlist_id: Mapped[int] = mapped_column(
        ForeignKey("wishlists.id", ondelete="CASCADE"), nullable=False
    )
    # Verbatim matched card payload — the only stable handle across re-lookups.
    card_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional alert threshold the user wants the card under. Persisted now,
    # wired to alerting later — see ADR-0013's "Out of scope".
    max_price: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=True)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    # ---- v1.5 collections-rework columns (#574) ----
    #: Same promoted card-identity columns as ``CollectionItem`` — kept
    #: symmetric so cross-surface queries (e.g. "is this card already
    #: chased or owned?") don't need a discriminator.
    card_set_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    card_number: Mapped[str | None] = mapped_column(String(16), nullable=True)
    card_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    card_rarity: Mapped[str | None] = mapped_column(String(64), nullable=True)
    card_types_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    card_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    price_snapshot: Mapped[float | None] = mapped_column(
        Numeric(12, 2, asdecimal=False), nullable=True
    )
    priced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Lifecycle plumbing for the wishlist → collection promote in #504.
    #: ``acquired_at`` is when the user marked the chase complete;
    #: ``acquired_collection_item_id`` points at the resulting
    #: ``collection_items`` row so the SPA can render "got it" with a
    #: link instead of deleting the wishlist row.
    acquired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acquired_collection_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("collection_items.id", ondelete="SET NULL"), nullable=True
    )

    wishlist: Mapped[Wishlist] = relationship(back_populates="items")


#: Allowed values for ``SwipeSeen.swipe_dir`` — the decision that retired
#: the card from the deck. Mirror the SPA's swipe vocabulary (left / right /
#: up); nullable so a backfill or a future "mark seen without a decision"
#: path can omit it.
SWIPE_DIR_PASS = "pass"
SWIPE_DIR_SAVE = "save"
SWIPE_DIR_LOVE = "love"


class SwipeSeen(Base):
    """One row per card a user has been shown in swipe mode (#581).

    Promotes the swipe deck's "already seen" memory from the SPA's
    session-local ``localStorage`` set to durable per-user state, so the
    same chase card never resurfaces across sessions until the user resets
    the deck. Keyed on the promoted ``(card_set_id, card_number)`` identity
    — the same pair indexed on ``collection_items`` / ``wishlist_items`` —
    so the library-aware exclusion query unions cleanly across all three
    tables.

    Append-only and idempotent: the unique constraint on
    ``(user_id, card_set_id, card_number)`` makes re-seeing a card a no-op
    rather than a duplicate row. Reset clears the user's rows."""

    __tablename__ = "swipe_seen"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "card_set_id",
            "card_number",
            name="uq_swipe_seen_user_card",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        default=DEFAULT_USER_ID,
        nullable=False,
        index=True,
    )
    card_set_id: Mapped[str] = mapped_column(String(64), nullable=False)
    card_number: Mapped[str] = mapped_column(String(16), nullable=False)
    seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    #: One of the ``SWIPE_DIR_*`` constants, or null when unknown.
    swipe_dir: Mapped[str | None] = mapped_column(String(8), nullable=True)


class RunRow(Base):
    __tablename__ = "run_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    # Streaming order — preserved so a re-load reads the same sequence the
    # user saw.
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    # Promoted columns — see ADR-0013. NULL on miss / non-USD-only sources.
    tag: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # asdecimal=False so reads come back as float, matching the annotation —
    # otherwise SQLAlchemy materialises Numeric as Decimal and float
    # comparisons downstream raise TypeError.
    market_price: Mapped[float | None] = mapped_column(
        Numeric(12, 2, asdecimal=False), nullable=True
    )
    currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    image_path: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Opaque sub-payloads — source-side shape drift doesn't force migrations.
    query_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    card_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    pricing_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    run: Mapped[Run] = relationship(back_populates="rows")
