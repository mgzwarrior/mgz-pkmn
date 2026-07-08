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
    false,
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
    #: When the user finished (or skipped) the first-login onboarding survey
    #: (#742). Null = never seen it, so the SPA shows the favorite-Pokémon
    #: pop-up; a timestamp suppresses it across devices.
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

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
#: pocket ``binder_format``, a cover ``binder_color``, a ``binder_type``
#: storage style, an optional slot ``capacity``, and an ``is_master_set``
#: target flag. It rides the same ``collection_items`` machinery as
#: ``manual`` — the extra columns are just identity — so ownership badges,
#: insights, and the ID-card PDF work as-is. As of #681 the cover/type/
#: master-set identity is shared with ``dynamic`` (smart binder) collections;
#: only ``binder_format``/``capacity`` stay physical-only.
COLLECTION_KIND_BINDER = "binder"

#: Allowed ``Collection.binder_format`` values — the page pocket layout.
#: Null for non-binder kinds (and binders that haven't chosen one). See #679.
BINDER_FORMAT_4_POCKET = "4-pocket"
BINDER_FORMAT_9_POCKET = "9-pocket"
BINDER_FORMAT_12_POCKET = "12-pocket"
BINDER_FORMATS = (BINDER_FORMAT_4_POCKET, BINDER_FORMAT_9_POCKET, BINDER_FORMAT_12_POCKET)

#: Allowed ``Collection.binder_type`` values — how the cards are physically
#: stored (#681). ``regular`` is binder pages; ``toploader`` and ``graded``
#: cover the rigid-holder / slab cases Cardrake calls out for chase cards.
BINDER_TYPE_REGULAR = "regular"
BINDER_TYPE_TOPLOADER = "toploader"
BINDER_TYPE_GRADED = "graded"
BINDER_TYPE_OTHER = "other"
BINDER_TYPES = (
    BINDER_TYPE_REGULAR,
    BINDER_TYPE_TOPLOADER,
    BINDER_TYPE_GRADED,
    BINDER_TYPE_OTHER,
)

#: Curated ``Collection.binder_color`` presets — design-token palette stems
#: (``design/tokens/colors_and_type.css``) the SPA maps to ``bg-<color>-500``.
#: A binder may also store a freeform ``#rrggbb`` hex (#681, user data — see
#: ``_validate_binder_color``); both render as the cover swatch.
BINDER_COLORS = ("palm", "sun", "sky", "ember", "coconut", "sand", "husk")

#: Allowed values for ``Collection.dynamic_scope`` (#631). ``owned`` matches
#: the rule against the user's own cards — an inventory view (the #630
#: default). ``catalog`` resolves the full matching set from pokemontcg.io
#: and overlays ownership — a goal-with-progress target view. A null column
#: reads as ``owned``.
DYNAMIC_SCOPE_OWNED = "owned"
DYNAMIC_SCOPE_CATALOG = "catalog"

#: Allowed values for ``Collection.purpose`` (#707). ``personal`` (default) is
#: a keeper — it counts toward personal set-completion and the owned badge.
#: ``trade`` / ``bulk`` hold cards the user doesn't consider "theirs" for
#: completion purposes; they still occupy a binder, just distinctly (#576).
COLLECTION_PURPOSE_PERSONAL = "personal"
COLLECTION_PURPOSE_TRADE = "trade"
COLLECTION_PURPOSE_BULK = "bulk"
COLLECTION_PURPOSES = (
    COLLECTION_PURPOSE_PERSONAL,
    COLLECTION_PURPOSE_TRADE,
    COLLECTION_PURPOSE_BULK,
)

#: Allowed values for ``CollectionItem.added_via`` — provenance tag,
#: used by the insights dashboard to answer "how do users actually get
#: cards into their collections."
ADDED_VIA_MANUAL = "manual"
ADDED_VIA_WISHLIST_PROMOTE = "wishlist_promote"
ADDED_VIA_HAUL = "haul"
ADDED_VIA_DYNAMIC_MATCH = "dynamic_match"
ADDED_VIA_SWIPE = "swipe"
#: One-tap `Own` quick action against the user's default collection (#760).
ADDED_VIA_QUICK = "quick"

#: Allowed ``product_type`` values on sealed-item rows (#882). Kept as bare
#: strings (no Enum) so adding a product shape is a one-line change; the API
#: layer validates against the tuple.
PRODUCT_TYPE_BOOSTER_PACK = "booster-pack"
PRODUCT_TYPE_BOOSTER_BOX = "booster-box"
PRODUCT_TYPE_ELITE_TRAINER_BOX = "elite-trainer-box"
PRODUCT_TYPE_TIN = "tin"
PRODUCT_TYPE_BLISTER = "blister"
PRODUCT_TYPE_BUNDLE = "bundle"
PRODUCT_TYPE_COLLECTION_BOX = "collection-box"
PRODUCT_TYPE_OTHER = "other"
PRODUCT_TYPES = (
    PRODUCT_TYPE_BOOSTER_PACK,
    PRODUCT_TYPE_BOOSTER_BOX,
    PRODUCT_TYPE_ELITE_TRAINER_BOX,
    PRODUCT_TYPE_TIN,
    PRODUCT_TYPE_BLISTER,
    PRODUCT_TYPE_BUNDLE,
    PRODUCT_TYPE_COLLECTION_BOX,
    PRODUCT_TYPE_OTHER,
)

#: Per-copy ``condition`` vocabulary for cards (#882) — the standard TCG
#: raw-condition scale. Lives on copies rows, not the item row, per ADR-0029.
CARD_CONDITIONS = ("NM", "LP", "MP", "HP", "DM")

#: Per-copy ``condition`` vocabulary for sealed product (#882). A box is
#: sealed / opened / resealed / damaged — the card scale doesn't apply.
SEALED_CONDITIONS = ("sealed", "opened", "resealed", "damaged")

#: Grading vocabulary shared across cards and sealed product (#882) — a
#: grading company assigns a numeric grade to either. Null company = raw.
GRADING_COMPANIES = ("PSA", "BGS", "CGC", "SGC")


class Binder(Base):
    """A physical binder the collector owns (#702).

    Inventory-level container: a binder is a real binder you own (its
    ``binder_format`` / ``binder_color`` / ``binder_type`` / ``capacity``
    identity from #679/#681 lives here, not on the collection), and it holds
    zero or more :class:`Collection` rows via ``Collection.binder_id``. An
    empty binder is a binder with no collections filed in it yet — the "own a
    binder before you fill it" case the inventory view needs.
    """

    __tablename__ = "binders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), default=DEFAULT_USER_ID, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    #: Physical identity — same vocabulary as the collection-level columns
    #: (:data:`BINDER_FORMATS` / :data:`BINDER_COLORS` / :data:`BINDER_TYPES`),
    #: now owned by the binder itself. All nullable until the collector pins them.
    binder_format: Mapped[str | None] = mapped_column(String(16), nullable=True)
    binder_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    binder_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)

    collections: Mapped[list[Collection]] = relationship(
        back_populates="binder",
        order_by="Collection.created_at",
    )
    #: Want-lists filed into this binder (#774). A binder organizes both owned
    #: (collections) and chasing (want-lists); deleting it detaches both.
    wishlists: Mapped[list[Wishlist]] = relationship(
        back_populates="binder",
        order_by="Wishlist.created_at",
    )


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
    #: Physical binders only (a smart binder has no fixed slots).
    binder_format: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: Cover color — a :data:`BINDER_COLORS` token stem or a ``#rrggbb`` hex
    #: (#681). Shared identity: set on physical and smart binders alike.
    binder_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: Storage style — one of :data:`BINDER_TYPES` (#681). Shared identity.
    binder_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: Total card slots, so the list can show how full the binder is. Null
    #: when the collector hasn't pinned a size.
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Whether the binder targets the *master set* of the set it organizes
    #: (``source_set_id``). Nullable so rows predating #679 read as not-master.
    is_master_set: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # ---- #702: parent physical binder ----
    #: The :class:`Binder` this collection is filed in, or null for a loose
    #: collection not in any binder. A binder holds many collections; deleting
    #: a binder detaches (``SET NULL``) its collections rather than removing them.
    binder_id: Mapped[int | None] = mapped_column(
        ForeignKey("binders.id", ondelete="SET NULL"), nullable=True
    )
    binder: Mapped[Binder | None] = relationship(back_populates="collections")
    # ---- #759: the user's default personal collection for one-tap `Own` (ADR-0027) ----
    #: Exactly one row per user may be the default (a partial unique index on
    #: ``user_id WHERE is_default`` enforces it). The flag is the invariant, not
    #: the row: renaming keeps it, deleting re-establishes one lazily.
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # ---- #707: collection purpose — personal keeper vs. trade / bulk ----
    #: One of :data:`COLLECTION_PURPOSES`. Drives purpose-aware ownership
    #: (#576): only ``personal`` counts toward set-completion / the owned
    #: badge; ``trade``/``bulk`` still occupy a binder, surfaced distinctly.
    purpose: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=COLLECTION_PURPOSE_PERSONAL,
        server_default=COLLECTION_PURPOSE_PERSONAL,
    )
    # ---- #788: customizable ID card cover ----
    #: Pins a specific owned item as the ID card's cover art, overriding the
    #: auto-pick (most valuable, falling back to first). Null keeps auto-pick.
    #: ``SET NULL`` on delete so removing the pinned item falls back rather
    #: than leaving a dangling reference.
    id_card_cover_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("collection_items.id", ondelete="SET NULL"), nullable=True
    )

    items: Mapped[list[CollectionItem]] = relationship(
        back_populates="collection",
        cascade="all, delete-orphan",
        order_by="CollectionItem.added_at",
        # #788 added a second FK between the tables (id_card_cover_item_id) —
        # pin this relationship to the ownership FK so SQLAlchemy doesn't have
        # to guess which one it is.
        foreign_keys="CollectionItem.collection_id",
    )
    sealed_items: Mapped[list[CollectionSealedItem]] = relationship(
        back_populates="collection",
        cascade="all, delete-orphan",
        order_by="CollectionSealedItem.added_at",
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

    collection: Mapped[Collection] = relationship(
        back_populates="items", foreign_keys="CollectionItem.collection_id"
    )
    #: Opt-in per-copy condition/grade breakdown (#882, ADR-0029). An item
    #: with no copies rows just uses its aggregate ``quantity``.
    copies: Mapped[list[CollectionItemCopy]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="CollectionItemCopy.id",
    )


class CollectionSealedItem(Base):
    """A sealed product (booster box, ETB, tin, …) in a collection (#882).

    Parallel table to :class:`CollectionItem`, not a polymorphic ``kind``
    column — same reasoning ADR-0025 used to keep wishlists and collections
    apart, documented in ADR-0029. Mirrors the card-item pattern: verbatim
    ``product_json`` as source of truth plus promoted identity columns for
    indexed queries. Identity is captured per-item from whatever source
    resolved it (PriceCharting scrape or manual entry) — there is no
    sealed-product catalog table."""

    __tablename__ = "collection_sealed_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection_id: Mapped[int] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), nullable=False
    )
    # Verbatim resolved product payload — the only stable handle across re-lookups.
    product_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    #: Promoted product-identity columns, extracted from ``product_json`` at
    #: insert. See :mod:`api.db.product_payload` for the extractor.
    product_set_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    product_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    #: One of :data:`PRODUCT_TYPES`. Nullable so a raw PriceCharting capture
    #: that didn't classify still stores; the API layer validates on write.
    product_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    product_language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    product_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    price_snapshot: Mapped[float | None] = mapped_column(
        Numeric(12, 2, asdecimal=False), nullable=True
    )
    priced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Provenance tag — one of the ``ADDED_VIA_*`` constants.
    added_via: Mapped[str | None] = mapped_column(String(32), nullable=True)

    collection: Mapped[Collection] = relationship(back_populates="sealed_items")
    #: Opt-in per-copy condition/grade breakdown, mirroring the card side.
    copies: Mapped[list[CollectionSealedItemCopy]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="CollectionSealedItemCopy.id",
    )


class CollectionItemCopy(Base):
    """Per-copy condition/grade breakdown for a card item (#882, ADR-0029).

    The child ADR-0025 deferred: a stack of 3 copies can be 2 raw-NM + 1
    PSA 9, which a single ``condition`` column on the item row can't
    represent. Opt-in detail — an item with no copies rows just uses its
    aggregate ``quantity``; the copies rows don't have to sum to it."""

    __tablename__ = "collection_item_copies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection_item_id: Mapped[int] = mapped_column(
        ForeignKey("collection_items.id", ondelete="CASCADE"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    #: One of :data:`CARD_CONDITIONS`. Nullable — a graded copy's raw
    #: condition is moot (the slab grade is the condition).
    condition: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: One of :data:`GRADING_COMPANIES`; null = raw / ungraded.
    grading_company: Mapped[str | None] = mapped_column(String(8), nullable=True)
    #: Numeric grade on the company's scale (PSA 9, BGS 9.5). Null when raw.
    grade: Mapped[float | None] = mapped_column(Numeric(4, 1, asdecimal=False), nullable=True)
    cert_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    #: Copy-level price snapshot — a PSA 9 prices differently from its raw
    #: siblings, so the item-level snapshot can't stand in for it.
    price_snapshot: Mapped[float | None] = mapped_column(
        Numeric(12, 2, asdecimal=False), nullable=True
    )
    priced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    item: Mapped[CollectionItem] = relationship(back_populates="copies")


class CollectionSealedItemCopy(Base):
    """Per-copy condition/grade breakdown for a sealed item (#882).

    Same shape as :class:`CollectionItemCopy` with the sealed ``condition``
    vocabulary (:data:`SEALED_CONDITIONS`); the grading vocabulary is shared
    — companies slab sealed product too."""

    __tablename__ = "collection_sealed_item_copies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection_sealed_item_id: Mapped[int] = mapped_column(
        ForeignKey("collection_sealed_items.id", ondelete="CASCADE"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    #: One of :data:`SEALED_CONDITIONS`. Nullable, mirroring the card side.
    condition: Mapped[str | None] = mapped_column(String(16), nullable=True)
    grading_company: Mapped[str | None] = mapped_column(String(8), nullable=True)
    grade: Mapped[float | None] = mapped_column(Numeric(4, 1, asdecimal=False), nullable=True)
    cert_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    price_snapshot: Mapped[float | None] = mapped_column(
        Numeric(12, 2, asdecimal=False), nullable=True
    )
    priced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    item: Mapped[CollectionSealedItem] = relationship(back_populates="copies")


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
    # ---- #759: the user's default wishlist for one-tap `Want` (ADR-0027) ----
    #: Exactly one row per user may be the default (a partial unique index on
    #: ``user_id WHERE is_default`` enforces it). The flag is the invariant, not
    #: the row: renaming keeps it, deleting re-establishes one lazily.
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # ---- #774: parent physical binder ----
    #: The :class:`Binder` this want-list is filed in, or null for a loose
    #: want-list not in any binder. Mirrors ``Collection.binder_id`` (#702):
    #: deleting a binder detaches (``SET NULL``) its want-lists, not removes them.
    binder_id: Mapped[int | None] = mapped_column(
        ForeignKey("binders.id", ondelete="SET NULL"), nullable=True
    )
    binder: Mapped[Binder | None] = relationship(back_populates="wishlists")

    items: Mapped[list[WishlistItem]] = relationship(
        back_populates="wishlist",
        cascade="all, delete-orphan",
        order_by="WishlistItem.added_at",
    )
    sealed_items: Mapped[list[WishlistSealedItem]] = relationship(
        back_populates="wishlist",
        cascade="all, delete-orphan",
        order_by="WishlistSealedItem.added_at",
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
    # ---- #882: chase-target condition/grade (ADR-0029) ----
    #: You don't own physical copies of a chase target, so wishlists get
    #: target columns instead of copies rows. All nullable — null means
    #: "any condition".
    target_condition: Mapped[str | None] = mapped_column(String(16), nullable=True)
    target_grading_company: Mapped[str | None] = mapped_column(String(8), nullable=True)
    target_min_grade: Mapped[float | None] = mapped_column(
        Numeric(4, 1, asdecimal=False), nullable=True
    )

    wishlist: Mapped[Wishlist] = relationship(back_populates="items")


class WishlistSealedItem(Base):
    """A sealed product on a wishlist (#882).

    Parallel table to :class:`WishlistItem`, mirroring
    :class:`CollectionSealedItem` on the collection side — a "Charizard
    chase" wishlist can hold the card and the booster box side by side.
    Carries the same acquired-lifecycle plumbing as the card row so the
    promote-to-collection flow (#884) stays symmetric."""

    __tablename__ = "wishlist_sealed_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wishlist_id: Mapped[int] = mapped_column(
        ForeignKey("wishlists.id", ondelete="CASCADE"), nullable=False
    )
    # Verbatim resolved product payload — the only stable handle across re-lookups.
    product_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Optional alert threshold, mirroring ``wishlist_items.max_price``.
    max_price: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=True)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    #: Promoted product-identity columns — same set as
    #: :class:`CollectionSealedItem`, kept symmetric so cross-surface
    #: queries don't need a discriminator.
    product_set_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    product_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    product_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    product_language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    product_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    price_snapshot: Mapped[float | None] = mapped_column(
        Numeric(12, 2, asdecimal=False), nullable=True
    )
    priced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    added_via: Mapped[str | None] = mapped_column(String(32), nullable=True)
    #: Lifecycle plumbing for the sealed promote-to-collection flow —
    #: mirrors ``wishlist_items.acquired_*``.
    acquired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acquired_collection_sealed_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("collection_sealed_items.id", ondelete="SET NULL"), nullable=True
    )
    #: Chase-target condition/grade — same columns as ``wishlist_items``
    #: with the sealed condition vocabulary (:data:`SEALED_CONDITIONS`).
    target_condition: Mapped[str | None] = mapped_column(String(16), nullable=True)
    target_grading_company: Mapped[str | None] = mapped_column(String(8), nullable=True)
    target_min_grade: Mapped[float | None] = mapped_column(
        Numeric(4, 1, asdecimal=False), nullable=True
    )

    wishlist: Mapped[Wishlist] = relationship(back_populates="sealed_items")


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


class FavoriteSet(Base):
    """One set a user has pinned as a favorite (#712).

    Durable, per-user, server-side — unlike the localStorage swipe taste
    profile — so other surfaces (search defaults, set ID cards, swipe
    candidate weighting) can read an explicit "I love this set" signal that
    survives a device change. The set is referenced by its catalog id
    (``base1``, ``sv4pt5``); the friendly name is resolved client-side from
    the baked set catalog, so it isn't denormalised here.

    Append-only and idempotent: the unique constraint on
    ``(user_id, set_id)`` makes re-pinning a no-op rather than a duplicate
    row, mirroring :class:`SwipeSeen`."""

    __tablename__ = "favorite_sets"
    __table_args__ = (UniqueConstraint("user_id", "set_id", name="uq_favorite_set_user_set"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        default=DEFAULT_USER_ID,
        nullable=False,
        index=True,
    )
    set_id: Mapped[str] = mapped_column(String(64), nullable=False)
    pinned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class FavoriteSpecies(Base):
    """One Pokémon species a user has pinned as a favorite (#742).

    The species-level sibling of :class:`FavoriteSet`: a durable, per-user,
    server-side "I love this Pokémon" signal that Swipe / Browse lean toward.
    Keyed by national Pokédex number — the same key Browse's pokedex view and
    ``GET /pokedex/{number}/cards`` use — so a card's
    ``nationalPokedexNumbers`` matches it directly.

    Append-only and idempotent: the unique constraint on
    ``(user_id, dex_number)`` makes re-pinning a no-op rather than a duplicate
    row, mirroring :class:`FavoriteSet`."""

    __tablename__ = "favorite_species"
    __table_args__ = (
        UniqueConstraint("user_id", "dex_number", name="uq_favorite_species_user_dex"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        default=DEFAULT_USER_ID,
        nullable=False,
        index=True,
    )
    dex_number: Mapped[int] = mapped_column(Integer, nullable=False)
    pinned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


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
