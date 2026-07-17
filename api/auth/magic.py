"""Magic-link sign-in for the hosted-demo auth surface.

Third slice of the [#61](https://github.com/mgzwarrior/mgz-pkmn/issues/61)
auth epic, per [ADR-0019](../../docs/adr/0019-hosted-demo-identity-and-auth.md).
Covers users who don't have or don't want to use GitHub / Google
sign-in.

Flow:

1. The SPA (or a curl client) `POST`s `{"email": "user@example.com"}`
   to `/api/v1/auth/magic/request`. The route signs a token carrying
   the email, builds an absolute callback URL, queues a send to the
   user's address via the configured SMTP relay, and **always returns
   202** — there is no leak about whether the email matched an
   existing account.
2. The recipient clicks the link, which lands on
   `/api/v1/auth/magic/callback?token=...`. The route verifies the
   token (signature + 15-minute TTL), upserts the `users` row keyed on
   the email, issues the session cookie, and 302s to `/`.

Account-merge contract is the same as
[`api/auth/github.py`](github.py): email is the anchor; `display_name`
is first-set-wins (a magic-link signup never overwrites a name a
prior GitHub or Google sign-in already filled). `email_verified_at`
is stamped on the first successful callback for that email.

Why itsdangerous tokens and not server-side stored OTPs: the signing
key (`MGZ_PKMN_SESSION_SECRET`, already required by the foundation
slice [ADR-0019](../../docs/adr/0019-hosted-demo-identity-and-auth.md))
gives us a tamper-proof, TTL-bound payload without a new table or a
cleanup job. Tokens are single-use *only* up to natural expiry — a
re-click inside the 15-minute window will sign the user in again.
That's a deliberate trade for v1; per-token revocation is a v2
concern when we add throttling and quota.

`magic_link_start` / `magic_link_callback` (below) reuse this same
token machinery for account *linking* (attaching a second email to an
already-signed-in user, [`api/auth/linking.py`](linking.py)) rather
than sign-in. That flow normally depends on `request.session`
continuity between the `/start` POST and the `/callback` click — fine
for the web SPA (same tab, same cookie jar) but broken for the iOS
app, whose `URLSession` cookie jar is never the one Safari uses when
the emailed link is tapped from Mail. `?next=app`
([#936](https://github.com/mgzwarrior/mgz-pkmn/issues/936)) bridges
that the same way [`api/auth/native.py`](native.py) bridges sign-in:
the token itself carries the initiating user's id
(`sign_link_native_token` / `verify_link_native_token`, a distinct
salt from the sign-in token pair above so the two shapes can never be
mixed up), and the callback mints a one-time code + redirects to
`mgzpkmn://auth/callback` instead of relying on the session.
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from html import escape
from pathlib import Path
from typing import Annotated, Protocol
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

from ..db.models import PROVIDER_MAGIC
from .identity import IdentityConflictError, link_identity_to_user, resolve_or_link_identity
from .linking import (
    POST_LINK_REDIRECT,
    consume_link_request,
    post_link_error_redirect,
    stage_link_request,
)
from .native import (
    NATIVE_CALLBACK_SCHEME,
    NATIVE_NEXT_VALUE,
    mint_native_code,
    native_error_redirect,
    native_success_redirect,
)
from .session import (
    CurrentUserOptional,
    CurrentUserRequired,
    DbSession,
    auth_enabled,
    resolve_session_secret,
)

_log = logging.getLogger(__name__)

#: SMTP relay used to send the magic-link mail. Production runs against
#: Resend (smtp.resend.com:587, STARTTLS); any RFC-compliant SMTP server
#: (Resend, SES, Mailgun, a local Postfix) works as long as the four
#: credentials below are populated. Buttondown (ADR-0014) is *not* a
#: viable target here — its "SMTP endpoint" is sender-side compose-by-
#: email for newsletter drafts, not a transactional relay.
SMTP_HOST_ENV = "MGZ_PKMN_SMTP_HOST"
SMTP_PORT_ENV = "MGZ_PKMN_SMTP_PORT"
SMTP_USERNAME_ENV = "MGZ_PKMN_SMTP_USERNAME"
SMTP_PASSWORD_ENV = "MGZ_PKMN_SMTP_PASSWORD"

#: `From:` header for the magic-link email. Resend / SES require this
#: to live on a verified domain. Kept as a separate var (rather than
#: reusing the SMTP username) so the auth surface can ship under
#: `noreply@mgz-pkmn.com` while the SMTP login stays the maintainer's
#: account.
SENDER_ENV = "MGZ_PKMN_MAGIC_LINK_FROM"

#: itsdangerous salt — keeps magic-link tokens domain-separated from
#: future signed surfaces (e.g. CSRF, email-change confirmations) that
#: share the session secret.
TOKEN_SALT = "auth-magic-link"

#: itsdangerous salt for the native-app account-link token (#936).
#: Domain-separated from `TOKEN_SALT` on purpose: a sign-in token only
#: ever carries an email, but this token also carries the *initiating
#: user's id*, so the two shapes must never be interchangeable even
#: though they share the session secret and a serializer class.
LINK_NATIVE_TOKEN_SALT = "auth-link-magic-native"

#: Token TTL. 15 minutes balances "the user goes to make coffee
#: between requesting and clicking" against "an old screenshot in
#: someone's screen-share doesn't become a sign-in".
TOKEN_MAX_AGE_SECONDS = 15 * 60

#: Where to send the user after a successful sign-in. Same anchor as
#: the GitHub provider so the SPA's `useEffect(/me)` flips to
#: signed-in.
POST_SIGNIN_REDIRECT = "/"

#: Subject line. Plain enough to not look like phishing in a busy
#: inbox; specific enough that the recipient knows what it is when
#: they search "mgz-pkmn" later.
MAIL_SUBJECT = "Sign in to mgz-pkmn"

_TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "templates" / "auth_magic.txt"
_LOGO_PATH = Path(__file__).resolve().parent.parent / "templates" / "auth_logo.png"
_LOGO_CID = "mgz-pkmn-logo"

# Email clients do not reliably preserve CSS variables, so these are
# resolved from design/tokens/colors_and_type.css and inlined below.
_EMAIL_COLORS = {
    "bg_app": "#FBF6E8",  # --sand-50 / --bg-app
    "bg_surface": "#FFFEF8",  # --bg-surface
    "bg_surface_2": "#F4ECD3",  # --sand-100 / --bg-surface-2
    "border": "#D6C99F",  # --sand-300 / --border-1
    "brand_primary": "#F5C94B",  # --sun-300 / --brand-primary
    "brand_secondary": "#4A8B3B",  # --palm-400 / --brand-secondary
    "brand_tertiary": "#6B4A2F",  # --coconut-500 / --brand-tertiary
    "fg_1": "#1F1B16",  # --husk-300 / --fg-1
    "fg_2": "#6B4A2F",  # --coconut-500 / --fg-2
    "fg_muted": "#5F583F",  # --sand-600 / --fg-3
    "fg_on_primary": "#15120E",  # --husk-400 / --fg-on-primary
}


router = APIRouter()


class Mailer(Protocol):
    """Minimal transactional-mail seam.

    Implementations send an already-built `EmailMessage`. The
    interface is sync — magic-link sends ride a FastAPI
    `BackgroundTasks` queue so the `/request` route returns 202
    immediately and we don't block the response on the SMTP round
    trip."""

    def send(self, message: EmailMessage) -> None: ...


class SmtpMailer:
    """STARTTLS SMTP mailer.

    Reads credentials from the four `MGZ_PKMN_SMTP_*` env vars at
    construction time. Built per-request rather than module-globally
    so tests don't need to clear module state between cases and so a
    self-hoster who never enables auth doesn't construct anything at
    import time."""

    def __init__(self, host: str, port: int, username: str, password: str) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password

    def send(self, message: EmailMessage) -> None:
        # `with` block closes the connection cleanly even if STARTTLS
        # negotiation or AUTH fails partway through.
        with smtplib.SMTP(self.host, self.port, timeout=30) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(self.username, self.password)
            smtp.send_message(message)


def _require_auth_enabled() -> None:
    """Match the GitHub provider's 404-when-disabled posture exactly —
    same status, same default body — so probes can't distinguish auth
    state from absent routes (see [`api/auth/github.py`](github.py))."""
    if not auth_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


AuthGate = Annotated[None, Depends(_require_auth_enabled)]


def _token_serializer() -> URLSafeTimedSerializer:
    """Build a serializer keyed on the session secret with our salt.

    Constructed per-call so a rotated `MGZ_PKMN_SESSION_SECRET` takes
    effect on the next request without restarting the process — same
    semantics as the session middleware."""
    return URLSafeTimedSerializer(resolve_session_secret(), salt=TOKEN_SALT)


def sign_token(email: str) -> str:
    """Sign an email into a TTL-bounded URL-safe token.

    Public for test injection — the callback tests build tokens here
    rather than driving a full request → email → click loop."""
    return _token_serializer().dumps(email)


def verify_token(token: str) -> str | None:
    """Verify a token and return the embedded email, or None on
    expired / tampered. Logs the failure reason (without the token
    body) so a deploy can spot misconfiguration vs. brute-force
    probes."""
    try:
        return _token_serializer().loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
    except SignatureExpired:
        _log.info("magic-link token rejected: expired")
        return None
    except BadSignature:
        _log.warning("magic-link token rejected: bad signature")
        return None


def _link_native_token_serializer() -> URLSafeTimedSerializer:
    """Build a serializer keyed on the session secret with the
    native-app link salt. Separate from `_token_serializer` so the two
    token shapes (email-only vs. email+user-id) can never verify
    against each other's salt."""
    return URLSafeTimedSerializer(resolve_session_secret(), salt=LINK_NATIVE_TOKEN_SALT)


def sign_link_native_token(email: str, user_id: int) -> str:
    """Sign an email + initiating user id into a TTL-bounded token for
    the native-app account-link handoff (#936).

    Unlike `sign_token` (sign-in, email only), this token also carries
    the *calling* user's id, so `magic_link_callback` can complete the
    link without any session continuity between the `POST
    /auth/link/magic/start` call and the later callback click. That
    continuity can't be assumed here: tapping the emailed link opens
    Safari via the Mail app, which has an entirely separate, signed-out
    cookie jar from the app's own `URLSession` that made the `/start`
    call — see `api/auth/native.py`'s module docstring for the same
    problem on the sign-in side.

    Public for test injection, mirroring `sign_token`."""
    return _link_native_token_serializer().dumps({"email": email, "uid": user_id})


def verify_link_native_token(token: str) -> tuple[str, int] | None:
    """Verify a native-app link token and return `(email, user_id)`,
    or `None` on expired / tampered / malformed."""
    try:
        payload = _link_native_token_serializer().loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
    except SignatureExpired:
        _log.info("magic-link native-link token rejected: expired")
        return None
    except BadSignature:
        _log.warning("magic-link native-link token rejected: bad signature")
        return None
    if not isinstance(payload, dict):
        return None
    email = payload.get("email")
    uid = payload.get("uid")
    if not isinstance(email, str) or not isinstance(uid, int):
        return None
    return email, uid


def _native_link_conflict_redirect(provider: str) -> RedirectResponse:
    """Build the `mgzpkmn://auth/callback?error=identity_already_linked&provider=<provider>`
    redirect for a native-app account-link conflict (#936).

    Mirrors `native_error_redirect`'s fixed-scheme construction, but
    also carries `provider` — matching the shape
    `post_link_error_redirect` already uses for the web flow
    (`/account?link_error=...&provider=...`) — so the iOS client's
    existing `mgzpkmn://auth/callback?error=...` handling doesn't need
    any special-casing to also read `provider` off this one error."""
    query = urlencode({"error": "identity_already_linked", "provider": provider})
    return RedirectResponse(url=f"{NATIVE_CALLBACK_SCHEME}?{query}", status_code=302)


def _build_message(to_email: str, sender: str, link: str) -> EmailMessage:
    """Render the branded magic-link email into an `EmailMessage`.

    The message keeps a plain-text fallback first, then adds a
    table-based HTML alternative with inline colors for broad email
    client support."""
    body = _TEMPLATE_PATH.read_text(encoding="utf-8").format(link=link)
    msg = EmailMessage()
    msg["Subject"] = MAIL_SUBJECT
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(body)
    msg.add_alternative(_render_html_email(link), subtype="html")
    html_part = msg.get_payload()[1]
    html_part.add_related(
        _LOGO_PATH.read_bytes(),
        maintype="image",
        subtype="png",
        cid=f"<{_LOGO_CID}>",
        filename="mgz-pkmn-logo.png",
        disposition="inline",
    )
    return msg


def _render_html_email(link: str) -> str:
    safe_link = escape(link, quote=True)
    colors = _EMAIL_COLORS
    return f"""\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{MAIL_SUBJECT}</title>
  </head>
  <body style="margin:0; padding:0; background:{colors["bg_app"]};">
    <!-- Colors resolved from design/tokens/colors_and_type.css because email clients strip CSS variables. -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; background:{colors["bg_app"]};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; max-width:560px; background:{colors["bg_surface"]}; border:1px solid {colors["border"]}; border-radius:14px;">
            <tr>
              <td style="padding:28px 28px 12px 28px;">
                <img src="cid:{_LOGO_CID}" width="156" alt="mgz-pkmn" style="display:block; width:156px; max-width:100%; height:auto; border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 0 28px; font-family:'Bricolage Grotesque', 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:{colors["fg_1"]};">
                <h1 style="margin:0; color:{colors["fg_1"]}; font-size:28px; line-height:1.2; font-weight:700;">Sign in to mgz-pkmn</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 0 28px; font-family:'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:{colors["fg_2"]}; font-size:16px; line-height:1.6;">
                <p style="margin:0;">Use this link to sign in. This link is good for 15 minutes.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <a href="{safe_link}" style="display:inline-block; background:{colors["brand_primary"]}; color:{colors["fg_on_primary"]}; border:1px solid {colors["brand_primary"]}; border-radius:10px; padding:13px 18px; font-family:'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size:16px; line-height:1.2; font-weight:700; text-decoration:none;">Sign in</a>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 0 28px; font-family:'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:{colors["fg_muted"]}; font-size:13px; line-height:1.6;">
                <p style="margin:0;">Button not working? Copy and paste this link into your browser:</p>
                <p style="margin:8px 0 0 0; word-break:break-all;"><a href="{safe_link}" style="color:{colors["brand_secondary"]}; text-decoration:underline;">{safe_link}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; background:{colors["bg_surface_2"]}; border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px; font-family:'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:{colors["brand_tertiary"]}; font-size:13px; line-height:1.6;">
                      If you didn't ask to sign in, you can ignore this email. Anyone with this link can sign in until it expires, so don't share or forward it.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def _normalize_email(raw: str) -> str:
    """Trim whitespace and strip CR/LF before any header / token /
    DB use.

    Two reasons:

    1. **No dual merge anchor.** `"a@b.com"` and `"a@b.com "` would
       otherwise sign as different tokens and upsert into different
       `users` rows, defeating the email-is-the-anchor contract.
    2. **No `To:` header injection.** A raw `\\n` in `payload.email`
       would let a sufficiently crafty caller append RFC-5322 headers
       to the outgoing message (`Bcc:`, etc.). Python's `email.message`
       does validate header values on write, but raising there would
       break the route's "always 202" contract — strip the dangerous
       characters upfront so the well-formed-but-junk path stays
       indistinguishable from the well-formed-and-real path.
    """
    return raw.strip().replace("\r", "").replace("\n", "")


def _get_mailer() -> SmtpMailer:
    """Construct a `SmtpMailer` from env vars.

    Raises `HTTPException(503)` if any of the four required SMTP env
    vars is missing or `MGZ_PKMN_SMTP_PORT` is non-numeric. The 503 is
    a deploy-time misconfiguration signal — it surfaces to the caller,
    so callers shouldn't observe it in steady state. Once SMTP is
    wired up, `/request` returns the stable 202 envelope unconditionally
    (which is the actual no-enumeration guarantee)."""
    host = os.environ.get(SMTP_HOST_ENV, "").strip()
    port_str = os.environ.get(SMTP_PORT_ENV, "").strip()
    username = os.environ.get(SMTP_USERNAME_ENV, "").strip()
    password = os.environ.get(SMTP_PASSWORD_ENV, "").strip()
    if not all([host, port_str, username, password]):
        raise HTTPException(
            status_code=503,
            detail=(
                f"Magic-link SMTP not configured ({SMTP_HOST_ENV}, "
                f"{SMTP_PORT_ENV}, {SMTP_USERNAME_ENV}, {SMTP_PASSWORD_ENV} "
                "must all be set)"
            ),
        )
    try:
        port = int(port_str)
    except ValueError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"{SMTP_PORT_ENV} must be an integer (got {port_str!r})",
        ) from exc
    return SmtpMailer(host=host, port=port, username=username, password=password)


def _get_sender() -> str:
    """Return the `From:` address for magic-link mails, raising 503
    when unset — same configuration-clarity posture as `_get_mailer`."""
    sender = os.environ.get(SENDER_ENV, "").strip()
    if not sender:
        raise HTTPException(
            status_code=503,
            detail=f"{SENDER_ENV} must be set for magic-link sign-in",
        )
    return sender


def _build_callback_url(request: Request, token: str, *, next_app: bool = False) -> str:
    """Build the absolute callback URL the email will link to.

    Uses `request.url_for` so the same code works locally, on the
    hosted demo, and behind a reverse proxy without an env var that
    has to be kept in sync with the deploy host.

    `next_app` (native-app handoff, #924) rides as a plain query param
    rather than inside the signed token — it only steers where the
    callback redirects the *result*, not who gets authenticated, so it
    doesn't need to be tamper-proof."""
    url = request.url_for("magic_callback").include_query_params(token=token)
    if next_app:
        url = url.include_query_params(next=NATIVE_NEXT_VALUE)
    return str(url)


def _build_link_callback_url(request: Request, token: str, *, next_app: bool = False) -> str:
    """Build the absolute callback URL for account-link magic emails.

    `next_app` (native-app link handoff, #936) rides as a plain query
    param, same posture as `_build_callback_url`'s `next_app` — it only
    steers where the callback redirects the *result*, not who gets
    linked (that's carried inside the signed token itself for this
    flow), so it doesn't need to be tamper-proof."""
    url = request.url_for("magic_link_callback").include_query_params(token=token)
    if next_app:
        url = url.include_query_params(next=NATIVE_NEXT_VALUE)
    return str(url)


def _send_magic_link(message: EmailMessage, mailer: Mailer) -> None:
    """Background-task body: do the actual SMTP send and swallow
    failures into a log line.

    We deliberately don't surface SMTP errors back to the caller — the
    `/request` route's 202 contract is unconditional. A bounce or
    relay outage gets logged here; the user sees the same response
    they would on success and can retry. Per-attempt observability
    lives in the deploy's log stream, not the HTTP surface."""
    try:
        mailer.send(message)
    except Exception:
        _log.exception("magic-link send failed")


class MagicRequestIn(BaseModel):
    """Payload for `POST /auth/magic/request`.

    Email kept as bare `str` rather than `pydantic.EmailStr` on
    purpose: an RFC-validator that rejects "not-an-email" returns
    422, which leaks enumeration signal (the response shape would
    differ from the 202 a well-formed-but-unknown address receives).
    Bare `str` means even garbage inputs go through the queue-the-send
    path and get the same 202; the SMTP relay rejects them downstream
    and the failure is logged, never surfaced."""

    email: str


@router.post(
    "/auth/magic/request",
    status_code=status.HTTP_202_ACCEPTED,
    response_class=Response,
)
def magic_request(
    payload: MagicRequestIn,
    request: Request,
    background_tasks: BackgroundTasks,
    _: AuthGate,
    next: str | None = None,
) -> Response:
    """Request a magic-link email.

    Always returns 202 with an empty body once the SMTP layer is
    configured — no enumeration leak. If SMTP is missing we 503 with a
    setup hint (this only happens on a misconfigured deploy, never as
    a runtime signal about the requester's email).

    `?next=app` (native-app handoff, #924) is threaded into the
    callback link so clicking the emailed link redirects to the app
    instead of the SPA."""
    mailer = _get_mailer()
    sender = _get_sender()
    # Normalize once, then use everywhere — token, To: header, and the
    # downstream callback's merge anchor all see the same string.
    email = _normalize_email(payload.email)
    token = sign_token(email)
    link = _build_callback_url(request, token, next_app=(next == NATIVE_NEXT_VALUE))
    message = _build_message(email, sender, link)
    # Queue the send so the response time is independent of how slow
    # the SMTP relay is — also keeps the response timing flat across
    # found / not-found emails, so the response time itself doesn't
    # leak.
    background_tasks.add_task(_send_magic_link, message, mailer)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post(
    "/auth/link/magic/start",
    status_code=status.HTTP_202_ACCEPTED,
    response_class=Response,
)
def magic_link_start(
    payload: MagicRequestIn,
    request: Request,
    background_tasks: BackgroundTasks,
    _: AuthGate,
    user: CurrentUserRequired,
    next: str | None = None,
) -> Response:
    """Send a magic-link email for attaching another email identity.

    `?next=app` (native-app link handoff, #936) signs the calling
    user's id directly into the token (`sign_link_native_token`)
    instead of staging it in the session cookie (`stage_link_request`)
    — the callback is opened from Mail into Safari, which never shares
    a cookie jar with the app's `URLSession` that made this request, so
    session-based staging would be unreadable by the time the callback
    runs. Web-flow behavior (`next` unset) is unchanged."""
    next_app = next == NATIVE_NEXT_VALUE
    mailer = _get_mailer()
    sender = _get_sender()
    email = _normalize_email(payload.email)
    if next_app:
        token = sign_link_native_token(email, user.id)
        link = _build_link_callback_url(request, token, next_app=True)
    else:
        stage_link_request(request, user)
        token = sign_token(email)
        link = _build_link_callback_url(request, token)
    message = _build_message(email, sender, link)
    background_tasks.add_task(_send_magic_link, message, mailer)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.get("/auth/magic/callback", name="magic_callback")
def magic_callback(
    token: str,
    request: Request,
    db: DbSession,
    _: AuthGate,
    next: str | None = None,
) -> RedirectResponse:
    """Verify a magic-link token and sign the user in.

    On success: upsert `users` keyed on the verified email, issue the
    session cookie, 302 to `/`. On expiry / tamper: 400 — the user can
    request a fresh link from the SPA.

    When the request was started with `?next=app` (#924), errors
    redirect to `mgzpkmn://auth/callback?error=<reason>` instead of
    raising, and success mints a one-time code for
    `POST /auth/native/exchange` instead of setting the session cookie
    directly."""
    next_app = next == NATIVE_NEXT_VALUE
    email = verify_token(token)
    if email is None:
        if next_app:
            return native_error_redirect("invalid_or_expired_token")
        raise HTTPException(status_code=400, detail="invalid_or_expired_token")

    # Slice 1 of #491: the identity-first resolver in `api/auth/identity.py`
    # owns the upsert. ``provider_subject`` is the verified email — magic-
    # link has no other anchor — and ``display_name=None`` because the
    # user gave us only an email. A future GitHub / Google sign-in for
    # the same address fills display_name via ADR-0019 first-set-wins.
    user = resolve_or_link_identity(
        db,
        provider=PROVIDER_MAGIC,
        subject=email,
        email=email,
        display_name=None,
        name_prefix="magic",
    )

    if next_app:
        return native_success_redirect(mint_native_code(user.id))

    request.session["user_id"] = user.id
    return RedirectResponse(url=POST_SIGNIN_REDIRECT, status_code=302)


@router.get("/auth/link/magic/callback", name="magic_link_callback")
def magic_link_callback(
    token: str,
    request: Request,
    db: DbSession,
    _: AuthGate,
    user: CurrentUserOptional,
    next: str | None = None,
) -> RedirectResponse:
    """Verify a magic-link token and attach that email to this account.

    `?next=app` (native-app link handoff, #936) skips
    `consume_link_request` entirely — no session dependency — and
    decodes the initiating user's id straight out of the token
    (`verify_link_native_token`, minted by `magic_link_start`) instead.
    On success it mints a native handoff code and redirects to
    `mgzpkmn://auth/callback?code=...` (`native_success_redirect`)
    instead of `/account`; on an identity conflict it redirects to
    `mgzpkmn://auth/callback?error=identity_already_linked&provider=magic`
    instead of raising. `user` is only required (401 if absent) on the
    web path — the whole point of the token carrying the user id is
    that this callback's caller (Safari, opened from Mail) is never
    signed in. Web-flow behavior (`next` unset) is unchanged."""
    next_app = next == NATIVE_NEXT_VALUE

    if next_app:
        decoded = verify_link_native_token(token)
        if decoded is None:
            return native_error_redirect("invalid_or_expired_token")
        email, link_user_id = decoded
    else:
        if user is None:
            raise HTTPException(status_code=401, detail="sign-in required")
        link_user_id = consume_link_request(request, user)
        email = verify_token(token)
        if email is None:
            raise HTTPException(status_code=400, detail="invalid_or_expired_token")

    try:
        link_identity_to_user(
            db,
            user_id=link_user_id,
            provider=PROVIDER_MAGIC,
            subject=email,
            email=email,
        )
    except IdentityConflictError as exc:
        if next_app:
            return _native_link_conflict_redirect(exc.provider)
        # Round-trip back into the Account modal with a recoverable error
        # rather than terminating on a JSON 409 page — see #536.
        return RedirectResponse(url=post_link_error_redirect(exc.provider), status_code=302)

    if next_app:
        return native_success_redirect(mint_native_code(link_user_id))

    return RedirectResponse(url=POST_LINK_REDIRECT, status_code=302)


# Re-export under the `_get_mailer` / `_get_sender` names that tests
# patch through. (Defined as module-level callables above; no extra
# wiring needed — listed here for grep-discoverability.)
__all__ = [
    "LINK_NATIVE_TOKEN_SALT",
    "MAIL_SUBJECT",
    "SENDER_ENV",
    "SMTP_HOST_ENV",
    "SMTP_PASSWORD_ENV",
    "SMTP_PORT_ENV",
    "SMTP_USERNAME_ENV",
    "TOKEN_MAX_AGE_SECONDS",
    "MagicRequestIn",
    "Mailer",
    "SmtpMailer",
    "router",
    "sign_link_native_token",
    "sign_token",
    "verify_link_native_token",
    "verify_token",
]
