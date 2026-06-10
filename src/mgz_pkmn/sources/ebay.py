"""eBay Developer OAuth client-credentials auth (#421).

Mints, caches, and refreshes an application-level eBay access token for
reading public sold / active listings (per
[ADR-0020](../../../docs/adr/0020-ebay-pricing-source.md)). There is no
per-user OAuth: eBay's client-credentials grant returns an "Application
Access Token" scoped to public data, which is all the pricing pipeline
needs.

The future ``EbayClient`` adapter (#422) consumes :meth:`EbayAuthClient.get_token`;
on a 401 from an eBay API call it retries once with
``get_token(force_refresh=True)``. This module owns acquisition + caching +
the ``force_refresh`` seam; the adapter owns the 401 detection.
"""

from __future__ import annotations

import base64
import os
import sys
import time

import requests

from ._common import USER_AGENT

#: Client-credentials pair from the eBay Developer portal.
CLIENT_ID_ENV = "MGZ_PKMN_EBAY_CLIENT_ID"
CLIENT_SECRET_ENV = "MGZ_PKMN_EBAY_CLIENT_SECRET"
#: Optional pre-supplied application access token. When set, it's returned
#: verbatim — the simple-deploy escape hatch ADR-0020 names. Minting +
#: refresh are bypassed entirely.
STATIC_TOKEN_ENV = "MGZ_PKMN_EBAY_TOKEN"
#: ``production`` (default) | ``sandbox`` — selects the token host.
ENV_ENV = "MGZ_PKMN_EBAY_ENV"

_PROD_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
_SANDBOX_TOKEN_URL = "https://api.sandbox.ebay.com/identity/v1/oauth2/token"

#: Application scope for the client-credentials grant. Same string for
#: production and sandbox.
_CLIENT_CREDENTIALS_SCOPE = "https://api.ebay.com/oauth/api_scope"

#: Re-mint this many seconds before the token's real expiry so a request in
#: flight at the moment of expiry can't observe the gap (mirrors the Apple
#: client-secret cache in ``api/auth/apple.py``).
_EXPIRY_SKEW_SECONDS = 60

#: Fallback lifetime if eBay's response omits / malforms ``expires_in``.
#: eBay's documented application-token lifetime is 7200s.
_DEFAULT_EXPIRES_IN = 7200


class EbayAuthError(RuntimeError):
    """eBay auth is misconfigured, or token acquisition failed."""


class EbayAuthClient:
    """Acquires and caches an eBay application access token.

    Construction reads the env vars above; every value is overridable via
    kwargs so tests don't have to mutate the environment. A ``static_token``
    (or ``MGZ_PKMN_EBAY_TOKEN``) short-circuits minting; otherwise a
    ``client_id`` / ``client_secret`` pair drives the client-credentials
    grant.
    """

    def __init__(
        self,
        *,
        client_id: str | None = None,
        client_secret: str | None = None,
        static_token: str | None = None,
        environment: str | None = None,
        session: requests.Session | None = None,
        verbose: bool = False,
    ) -> None:
        self.client_id = (
            client_id if client_id is not None else os.environ.get(CLIENT_ID_ENV, "")
        ).strip()
        self.client_secret = (
            client_secret if client_secret is not None else os.environ.get(CLIENT_SECRET_ENV, "")
        ).strip()
        self.static_token = (
            static_token if static_token is not None else os.environ.get(STATIC_TOKEN_ENV, "")
        ).strip()
        env = (
            (environment if environment is not None else os.environ.get(ENV_ENV, ""))
            .strip()
            .lower()
        )
        self.environment = "sandbox" if env == "sandbox" else "production"
        self.session = session or requests.Session()
        self.session.headers.setdefault("User-Agent", USER_AGENT)
        self.verbose = verbose
        # (token, expiry_unix_seconds); None until first mint.
        self._cached: tuple[str, float] | None = None

    @property
    def token_url(self) -> str:
        return _SANDBOX_TOKEN_URL if self.environment == "sandbox" else _PROD_TOKEN_URL

    def get_token(self, *, force_refresh: bool = False) -> str:
        """Return a valid application access token.

        Order: a configured static token wins; otherwise a cached token is
        reused while it's outside the expiry-skew window; otherwise (or when
        ``force_refresh`` is set — the on-401 retry path) a fresh token is
        minted and cached.
        """
        if self.static_token:
            return self.static_token
        now = time.time()
        if not force_refresh and self._cached is not None:
            token, expiry = self._cached
            if expiry - now > _EXPIRY_SKEW_SECONDS:
                return token
        token, expires_in = self._mint()
        self._cached = (token, now + expires_in)
        return token

    def _mint(self) -> tuple[str, int]:
        """POST the client-credentials grant and return (token, expires_in)."""
        if not (self.client_id and self.client_secret):
            raise EbayAuthError(
                f"eBay auth not configured: set {STATIC_TOKEN_ENV}, or both "
                f"{CLIENT_ID_ENV} and {CLIENT_SECRET_ENV}"
            )
        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode("ascii")
        if self.verbose:
            print(f"  POST {self.token_url} (client_credentials)", file=sys.stderr)
        try:
            resp = self.session.post(
                self.token_url,
                headers={
                    "Authorization": f"Basic {basic}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "client_credentials", "scope": _CLIENT_CREDENTIALS_SCOPE},
                timeout=20,
            )
            resp.raise_for_status()
            payload = resp.json()
        except requests.RequestException as exc:
            raise EbayAuthError(f"eBay token request failed: {exc}") from exc
        token = payload.get("access_token")
        if not token:
            raise EbayAuthError("eBay token response missing access_token")
        try:
            expires_in = int(payload.get("expires_in"))
        except (TypeError, ValueError):
            expires_in = _DEFAULT_EXPIRES_IN
        return token, expires_in


__all__ = [
    "CLIENT_ID_ENV",
    "CLIENT_SECRET_ENV",
    "ENV_ENV",
    "STATIC_TOKEN_ENV",
    "EbayAuthClient",
    "EbayAuthError",
]
