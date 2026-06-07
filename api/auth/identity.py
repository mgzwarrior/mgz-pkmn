"""Identity-first lookup for the provider callbacks (#491 slice 1).

The three provider callbacks ([github.py](github.py) / [google.py](google.py) /
[magic.py](magic.py)) used to inline a "look up users by email, mint if
missing" upsert. This module promotes that into a single helper keyed
on ``user_identities`` so a user who first signed in via GitHub can
sign in via Google with the same email and end up on the same
``users`` row *with the new identity attached* — explicit linkage
rather than the silent first-set-wins merge ADR-0019 footnoted as a
deferral.

Resolution order:

1. **Identity hit** — ``(provider, provider_subject)`` already attached
   to a user. Return that user. Refresh the identity's ``email`` if
   the provider reported a new one this round (the user changed their
   primary email on that provider).
2. **Email hit** — no identity, but ``users.email`` matches. Attach a
   new ``user_identities`` row to the existing user and return it.
   This is the "I signed in via GitHub last week, today I'm using
   Google with the same email" path.
3. **Cold miss** — mint a new ``users`` row + first identity, return.

``IntegrityError`` recovery on both `users.email` (the existing
partial-unique index) and `user_identities (provider, subject)` (the
new unique constraint) is handled centrally so each callback stops
needing its own race-handler.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db.models import User, UserIdentity

#: ``name_prefix`` value that triggers the email-hash path inside
#: :func:`_candidate_user_name`. Kept literal here to avoid conflating
#: the *name-prefix tag* with the *provider tag* (the magic-link path
#: is the only provider whose subject is too long to fit verbatim in
#: ``users.name``'s 64-char unique index).
_MAGIC_NAME_PREFIX = "magic"


def resolve_or_link_identity(
    db: Session,
    *,
    provider: str,
    subject: str,
    email: str,
    display_name: str | None = None,
    name_prefix: str,
) -> User:
    """Resolve the ``User`` row this sign-in should land on.

    Parameters
    ----------
    provider, subject
        The provider tag and provider-side stable identifier (GitHub
        login, Google ``sub``, or — for magic-link — the verified email
        itself).
    email
        The verified email this sign-in proves ownership of. Used both
        for the email-fallback branch and stamped onto the identity
        row so the future "linked providers" panel can display it.
    display_name
        Provider-reported display name. Per ADR-0019 first-set-wins,
        only written to ``users.display_name`` when that column is
        NULL — so the user keeps whatever name they chose on their
        first sign-in even when a later provider reports a different
        one.
    name_prefix
        Provider-specific prefix burned into ``users.name`` on a cold
        mint. The existing callbacks used ``"gh:<login>"`` etc.; we
        keep the convention so a row's origin is greppable even after
        the identity table lands. Magic-link's prefix is special-cased
        below to hash the email (matching the pre-slice-1 behavior).

    Returns
    -------
    User
        The resolved or freshly minted user. Caller is responsible for
        writing ``request.session["user_id"] = user.id`` and
        redirecting — this helper only owns the upsert. ``get_db`` will
        commit on normal return.
    """

    # 1. Identity hit — fast path. Subject is the source of truth.
    identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == provider,
            UserIdentity.provider_subject == subject,
        )
    )
    if identity is not None:
        user = db.get(User, identity.user_id)
        if user is None:
            # Defensive: identity exists but user row is gone (manual
            # delete, FK cascade misconfig). Treat as a cold miss.
            db.delete(identity)
            db.flush()
            identity = None
        else:
            _stamp_first_set_wins(user, email=email, display_name=display_name)
            if identity.email != email:
                identity.email = email
            return user

    # 2. Email fallback — attach this provider to the existing row.
    existing = _find_user_by_email(db, email)
    if existing is not None:
        _stamp_first_set_wins(existing, email=email, display_name=display_name)
        new_identity = UserIdentity(
            user_id=existing.id,
            provider=provider,
            provider_subject=subject,
            email=email,
        )
        db.add(new_identity)
        try:
            db.flush()
        except IntegrityError:
            # A concurrent callback for the same (provider, subject)
            # raced us. Roll back, re-read, return — same shape as the
            # email-race handler in the cold-mint branch.
            db.rollback()
            identity = db.scalar(
                select(UserIdentity).where(
                    UserIdentity.provider == provider,
                    UserIdentity.provider_subject == subject,
                )
            )
            if identity is not None:
                user = db.get(User, identity.user_id)
                if user is not None:
                    return user
            raise
        return existing

    # 3. Cold miss — mint the user + first identity together.
    user = User(
        name=_candidate_user_name(name_prefix=name_prefix, subject=subject, email=email),
        email=email,
        email_verified_at=datetime.now(UTC),
        display_name=display_name,
    )
    db.add(user)
    try:
        # Flush to surface unique violations on `users.email` /
        # `users.name` while the transaction is still recoverable.
        db.flush()
    except IntegrityError:
        # Two callbacks for the same email landed within the read-then-
        # insert window. Roll back, re-read the winning user row, and
        # re-enter the email-fallback branch so we attach this provider's
        # identity to it.
        db.rollback()
        existing = _find_user_by_email(db, email)
        if existing is None:
            raise
        _stamp_first_set_wins(existing, email=email, display_name=display_name)
        new_identity = UserIdentity(
            user_id=existing.id,
            provider=provider,
            provider_subject=subject,
            email=email,
        )
        db.add(new_identity)
        # Second flush — if *this* also races, we surface the original
        # IntegrityError. A retry loop here would just paper over a
        # bug somewhere upstream.
        db.flush()
        return existing

    # Mint succeeded. Attach the first identity row.
    db.add(
        UserIdentity(
            user_id=user.id,
            provider=provider,
            provider_subject=subject,
            email=email,
        )
    )
    return user


def _find_user_by_email(db: Session, email: str) -> User | None:
    """Existence check for the email-fallback path.

    Carved out so the race-recovery tests can patch it the same way
    the original callbacks did."""
    return db.scalar(select(User).where(User.email == email))


def _stamp_first_set_wins(
    user: User,
    *,
    email: str,
    display_name: str | None,
) -> None:
    """Apply ADR-0019's first-set-wins update on an existing user row.

    - ``email_verified_at`` is stamped on the first sign-in that brings
      a verified email through (subsequent sign-ins don't refresh it —
      we don't track "last verified" yet).
    - ``display_name`` is filled only when currently NULL. Lets the
      user keep whatever name they chose on first sign-in even when a
      later provider reports a different one.
    - ``user.email`` is left alone. The identity row's ``email`` column
      tracks the most-recent per-provider value separately so the
      primary email on the user row stays stable across provider drift.
    """
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)
    if not user.display_name and display_name:
        user.display_name = display_name


def _candidate_user_name(*, name_prefix: str, subject: str, email: str) -> str:
    """Build the ``users.name`` value for a freshly minted row.

    Keeps the existing ``gh:<login>`` / ``google:<sub>`` / ``magic:<hash>``
    convention so a row's origin is still readable in a DB browser
    after the identity table lands. The magic-link case can't use the
    subject directly because two long email addresses sharing the
    first ~58 chars would collide on the 64-char unique index — hash
    the email to a 48-char SHA-256 prefix (192 bits, collision-
    resistant) and tag with the ``magic:`` prefix, matching the
    pre-slice-1 behavior.
    """
    if name_prefix == _MAGIC_NAME_PREFIX:
        digest = hashlib.sha256(email.encode("utf-8")).hexdigest()[:48]
        return f"magic:{digest}"
    return f"{name_prefix}:{subject}"[:64]
