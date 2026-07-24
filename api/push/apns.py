"""Direct APNs delivery — the concrete :class:`PushSender` (#976).

Direct APNs (not a third-party provider like Firebase/OneSignal): only
the iOS client exists today, and APNs' HTTP/2 provider API needs
nothing beyond ``httpx[http2]`` — already a near-neighbor of the
``authlib``/``httpx`` stack the Apple Sign-In slice pulls in
(``api/auth/apple.py``) — so this avoids standing up a provider account
for reach we don't need yet.

Auth is key-based (``.p8`` Auth Key, **not** the Sign-In-with-Apple
key — a separate Apple Developer resource with its own Key ID): an
ES256 JWT with ``iss`` (team ID) and ``iat``, cached per
``(team_id, key_id)`` and re-minted well inside Apple's ~1 hour
validity window (mirrors the client-secret cache in
``api/auth/apple.py``, just without the ``sub``/``aud``/``exp`` claims
APNs' provider token doesn't require).

The httpx call is factored into one seam (``send``) so tests patch
``apns.httpx.AsyncClient`` the same way ``api/routes/subscribe.py``'s
Resend calls do, rather than mocking a lower-level transport.
"""

from __future__ import annotations

import contextlib
import logging
import os
import time

import httpx
from authlib.jose import jwt

from .base import PushResult

_log = logging.getLogger(__name__)

#: APNs Auth Key credentials. All four must be set for a send attempt to
#: go anywhere; unlike the Apple Sign-In env vars this isn't behind an
#: HTTP route, so a missing var is a logged skip, not a 503.
#:
#: - ``MGZ_PKMN_APNS_TEAM_ID`` — the 10-character Apple Developer team
#:   identifier (JWT ``iss``).
#: - ``MGZ_PKMN_APNS_KEY_ID`` — the 10-character Key ID of the APNs
#:   ``.p8`` Auth Key (JWT header ``kid``).
#: - ``MGZ_PKMN_APNS_PRIVATE_KEY`` — the PEM-encoded contents of that
#:   ``.p8`` file. Loaded from a secret store; never committed.
#: - ``MGZ_PKMN_APNS_BUNDLE_ID`` — the iOS app's bundle identifier,
#:   sent as the ``apns-topic`` header.
APNS_TEAM_ID_ENV = "MGZ_PKMN_APNS_TEAM_ID"
APNS_KEY_ID_ENV = "MGZ_PKMN_APNS_KEY_ID"
APNS_PRIVATE_KEY_ENV = "MGZ_PKMN_APNS_PRIVATE_KEY"
APNS_BUNDLE_ID_ENV = "MGZ_PKMN_APNS_BUNDLE_ID"

#: Which APNs host to call. ``production`` (the default) serves
#: TestFlight and App Store builds; Xcode-run development builds carry
#: sandbox tokens and need ``MGZ_PKMN_APNS_ENVIRONMENT=sandbox``.
APNS_ENVIRONMENT_ENV = "MGZ_PKMN_APNS_ENVIRONMENT"
APNS_PRODUCTION_URL = "https://api.push.apple.com"
APNS_SANDBOX_URL = "https://api.sandbox.push.apple.com"

#: Lifetime for the cached provider JWT. Apple treats a token as stale
#: after roughly an hour and asks integrators not to mint more than
#: once every 20 minutes; 45 minutes leaves comfortable headroom on
#: both sides.
PROVIDER_TOKEN_TTL_SECONDS = 45 * 60

#: ``reason`` values (and the one status code, 410) APNs uses to report
#: a device token that will never succeed again — the device row should
#: be removed rather than retried.
_INVALID_TOKEN_REASONS = frozenset({"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"})


def _read_apns_env() -> tuple[str, str, str, str, str] | None:
    """Read the APNs env vars, or ``None`` when the deploy hasn't
    configured push yet. Returns
    ``(team_id, key_id, private_key_pem, bundle_id, base_url)``."""
    team_id = os.environ.get(APNS_TEAM_ID_ENV, "").strip()
    key_id = os.environ.get(APNS_KEY_ID_ENV, "").strip()
    # Don't ``.strip()`` the PEM — embedded newlines are load-bearing for
    # the ``-----BEGIN``/``-----END`` envelope, same caveat as
    # `api.auth.apple._read_apple_env`.
    private_key = os.environ.get(APNS_PRIVATE_KEY_ENV, "").strip("\t ")
    bundle_id = os.environ.get(APNS_BUNDLE_ID_ENV, "").strip()
    if not all([team_id, key_id, private_key, bundle_id]):
        return None
    environment = os.environ.get(APNS_ENVIRONMENT_ENV, "production").strip().lower()
    base_url = APNS_SANDBOX_URL if environment == "sandbox" else APNS_PRODUCTION_URL
    return team_id, key_id, private_key, bundle_id, base_url


def mint_provider_token(
    *,
    team_id: str,
    key_id: str,
    private_key_pem: str,
    now: int | None = None,
) -> str:
    """Mint an ES256-signed JWT for APNs' ``authorization: bearer`` header.

    Public for test injection — callers should usually go through
    :meth:`ApnsSender._get_provider_token` so the result is cached."""
    issued_at = int(time.time()) if now is None else int(now)
    headers = {"alg": "ES256", "kid": key_id}
    claims = {"iss": team_id, "iat": issued_at}
    token_bytes = jwt.encode(headers, claims, private_key_pem)
    return token_bytes.decode("ascii") if isinstance(token_bytes, bytes) else str(token_bytes)


class ApnsSender:
    """The concrete :class:`api.push.base.PushSender` for iOS."""

    def __init__(self) -> None:
        self._token_cache: dict[tuple[str, str], tuple[str, int]] = {}

    def _get_provider_token(self, *, team_id: str, key_id: str, private_key_pem: str) -> str:
        cache_key = (team_id, key_id)
        now = int(time.time())
        cached = self._token_cache.get(cache_key)
        if cached is not None and now < cached[1]:
            return cached[0]
        token = mint_provider_token(
            team_id=team_id, key_id=key_id, private_key_pem=private_key_pem, now=now
        )
        self._token_cache[cache_key] = (token, now + PROVIDER_TOKEN_TTL_SECONDS)
        return token

    async def send(self, device_token: str, payload: dict) -> PushResult:
        config = _read_apns_env()
        if config is None:
            _log.warning("apns send skipped: push not configured")
            return PushResult(delivered=False, invalid_token=False, reason="apns_not_configured")
        team_id, key_id, private_key_pem, bundle_id, base_url = config

        provider_token = self._get_provider_token(
            team_id=team_id, key_id=key_id, private_key_pem=private_key_pem
        )
        async with httpx.AsyncClient(http2=True, base_url=base_url, timeout=10.0) as client:
            try:
                resp = await client.post(
                    f"/3/device/{device_token}",
                    json=payload,
                    headers={
                        "authorization": f"bearer {provider_token}",
                        "apns-topic": bundle_id,
                        "apns-push-type": "alert",
                    },
                )
            except httpx.HTTPError as exc:
                _log.warning("apns send failed: %s", exc)
                return PushResult(delivered=False, invalid_token=False, reason=str(exc))

        if resp.status_code == 200:
            return PushResult(delivered=True, invalid_token=False)

        reason: str | None = None
        with contextlib.suppress(ValueError):
            reason = resp.json().get("reason")
        invalid = resp.status_code == 410 or reason in _INVALID_TOKEN_REASONS
        if not invalid:
            _log.warning("apns send rejected: status=%s reason=%s", resp.status_code, reason)
        return PushResult(delivered=False, invalid_token=invalid, reason=reason)


__all__ = [
    "APNS_BUNDLE_ID_ENV",
    "APNS_ENVIRONMENT_ENV",
    "APNS_KEY_ID_ENV",
    "APNS_PRIVATE_KEY_ENV",
    "APNS_PRODUCTION_URL",
    "APNS_SANDBOX_URL",
    "APNS_TEAM_ID_ENV",
    "ApnsSender",
    "mint_provider_token",
]
