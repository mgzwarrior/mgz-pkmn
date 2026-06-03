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
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
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

    user: Mapped[User] = relationship(back_populates="runs")
    rows: Mapped[list[RunRow]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="RunRow.position",
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
