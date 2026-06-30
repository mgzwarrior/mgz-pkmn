#!/usr/bin/env python3
"""Render the markdown welcome emails into branded, paste-ready HTML.

Each `*.md` under the track directories (collector/, show-prep/, builder/) is
wrapped in the same table-based, inline-color shell as the transactional
magic-link mail (api/auth/magic.py) — so the welcome drip looks like the app —
and written to a sibling `*.html`. Paste that HTML into the matching step of
the Resend Automation (the email step's HTML / "Code" view). See
[ADR-0028](../../adr/0028-resend-for-subscriptions-and-automations.md).

The markdown is authored copy (trusted, no user input), so this renders the
small subset the emails actually use — paragraphs, `-` bullet lists, fenced
code blocks, `**bold**`, `[text](url)` links, `` `code` `` spans, and a
standalone bold-link line as a CTA button — rather than pulling in a full
markdown dependency. Re-run after editing any `.md`:

    python docs/marketing/emails/render.py        # render all
    python docs/marketing/emails/render.py --check # fail if any .html is stale (CI-friendly)

No third-party imports — standard library only.
"""

from __future__ import annotations

import argparse
import re
import sys
from html import escape
from pathlib import Path

EMAILS_DIR = Path(__file__).resolve().parent
TRACKS = ("collector", "show-prep", "builder")

# Hosted brand logo (the same PNG the magic-link mail embeds). Email clients
# render PNG reliably; SVG is hit-or-miss, so we don't use assets/logo.svg here.
LOGO_URL = "https://raw.githubusercontent.com/mgzwarrior/mgz-pkmn/main/api/templates/auth_logo.png"

# Resend injects the recipient's one-click unsubscribe URL at this token.
UNSUBSCRIBE_TOKEN = "{{{RESEND_UNSUBSCRIBE_URL}}}"

# Colors resolved from design/tokens/colors_and_type.css — kept identical to
# api/auth/magic.py's `_EMAIL_COLORS` so transactional + marketing mail match.
# Email clients strip CSS variables, so every color is inlined.
C = {
    "bg_app": "#FBF6E8",
    "bg_surface": "#FFFEF8",
    "bg_surface_2": "#F4ECD3",
    "border": "#D6C99F",
    "brand_primary": "#F5C94B",
    "brand_secondary": "#4A8B3B",
    "brand_tertiary": "#6B4A2F",
    "fg_1": "#1F1B16",
    "fg_2": "#6B4A2F",
    "fg_muted": "#5F583F",
    "fg_on_primary": "#15120E",
}

FONT_BODY = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
FONT_DISPLAY = "'Bricolage Grotesque', " + FONT_BODY

# A line that is *only* a bold link, e.g. `[**Try the live demo →**](url)`,
# renders as a button rather than an inline link.
CTA_RE = re.compile(r"^\[\*\*(?P<label>.+?)\*\*\]\((?P<url>[^)]+)\)$")
LINK_RE = re.compile(r"\[(?P<text>[^\]]+)\]\((?P<url>[^)]+)\)")
BOLD_RE = re.compile(r"\*\*(?P<text>.+?)\*\*")
# Single-asterisk emphasis, applied after bold so `**...**` pairs are consumed
# first and a stray `*` left over never matches.
ITALIC_RE = re.compile(r"\*(?P<text>[^*]+)\*")
CODE_RE = re.compile(r"`(?P<text>[^`]+)`")


def parse_front_matter(text: str) -> tuple[dict[str, str], str]:
    """Split a `---` YAML-ish front-matter block from the markdown body.

    Only flat `key: value` pairs are used here, so a tiny hand parse beats a
    YAML dependency."""
    if not text.startswith("---"):
        return {}, text
    _, fm, body = text.split("---", 2)
    meta: dict[str, str] = {}
    for line in fm.strip().splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    return meta, body.strip()


def render_inline(text: str) -> str:
    """Escape, then apply inline markdown: code spans, links, bold."""
    out = escape(text)
    out = CODE_RE.sub(
        lambda m: (
            f'<code style="background:{C["bg_surface_2"]}; border-radius:4px; '
            f"padding:1px 5px; font-family:'JetBrains Mono', monospace; "
            f'font-size:13px; color:{C["fg_1"]};">{m.group("text")}</code>'
        ),
        out,
    )
    out = LINK_RE.sub(
        lambda m: (
            f'<a href="{m.group("url")}" style="color:{C["brand_secondary"]}; '
            f'text-decoration:underline;">{m.group("text")}</a>'
        ),
        out,
    )
    out = BOLD_RE.sub(
        lambda m: f'<strong style="color:{C["fg_1"]};">{m.group("text")}</strong>',
        out,
    )
    out = ITALIC_RE.sub(
        lambda m: f"<em>{m.group('text')}</em>",
        out,
    )
    return out


def render_button(label: str, url: str) -> str:
    return (
        f'<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin:4px 0;">'
        f'<tr><td style="border-radius:10px; background:{C["brand_primary"]};">'
        f'<a href="{url}" style="display:inline-block; padding:13px 20px; font-family:{FONT_BODY}; '
        f"font-size:16px; font-weight:700; line-height:1.2; color:{C['fg_on_primary']}; "
        f'text-decoration:none; border-radius:10px;">{escape(label)}</a>'
        f"</td></tr></table>"
    )


def render_body(markdown: str) -> str:
    """Render the markdown body (front-matter already stripped) to HTML blocks.

    The leading `![logo](...)` line is dropped — the shell supplies the brand
    header — so the source markdown stays readable on GitHub while the email
    gets the real logo."""
    lines = markdown.splitlines()
    blocks: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        # Drop the markdown logo image; the HTML header renders the logo.
        if line.lstrip().startswith("![") and "logo" in line.lower():
            i += 1
            continue
        # Fenced code block.
        if line.startswith("```"):
            i += 1
            code: list[str] = []
            while i < n and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1  # closing fence
            body = escape("\n".join(code))
            blocks.append(
                f'<pre style="margin:0 0 16px 0; padding:14px 16px; background:{C["bg_surface_2"]}; '
                f"border-radius:10px; font-family:'JetBrains Mono', monospace; font-size:13px; "
                f'line-height:1.6; color:{C["fg_1"]}; white-space:pre-wrap; overflow-x:auto;">{body}</pre>'
            )
            continue
        # Bullet list.
        if line.lstrip().startswith("- "):
            items: list[str] = []
            while i < n and lines[i].lstrip().startswith("- "):
                items.append(render_inline(lines[i].lstrip()[2:].strip()))
                i += 1
            lis = "".join(f'<li style="margin:0 0 6px 0;">{it}</li>' for it in items)
            blocks.append(
                f'<ul style="margin:0 0 16px 0; padding-left:22px; font-family:{FONT_BODY}; '
                f'font-size:16px; line-height:1.6; color:{C["fg_2"]};">{lis}</ul>'
            )
            continue
        # Standalone CTA button.
        cta = CTA_RE.match(line.strip())
        if cta:
            blocks.append(render_button(cta.group("label"), cta.group("url")))
            i += 1
            continue
        # Heading (emails rarely use these, but support h2/h3).
        heading = re.match(r"^(#{2,3})\s+(.*)$", line)
        if heading:
            size = "20px" if len(heading.group(1)) == 2 else "16px"
            blocks.append(
                f'<h{len(heading.group(1))} style="margin:0 0 10px 0; font-family:{FONT_DISPLAY}; '
                f'font-size:{size}; font-weight:700; color:{C["fg_1"]};">'
                f"{render_inline(heading.group(2))}</h{len(heading.group(1))}>"
            )
            i += 1
            continue
        # Paragraph: gather until a blank line.
        para: list[str] = []
        while i < n and lines[i].strip() and not lines[i].startswith("```"):
            if lines[i].lstrip().startswith("- ") or CTA_RE.match(lines[i].strip()):
                break
            para.append(lines[i].strip())
            i += 1
        html_para = "<br>".join(render_inline(p) for p in para)
        blocks.append(
            f'<p style="margin:0 0 16px 0; font-family:{FONT_BODY}; font-size:16px; '
            f'line-height:1.6; color:{C["fg_2"]};">{html_para}</p>'
        )
    return "\n              ".join(blocks)


def render_email(md_path: Path) -> str:
    meta, body = parse_front_matter(md_path.read_text(encoding="utf-8"))
    subject = meta.get("subject", "")
    preheader = meta.get("preheader", "")
    content = render_body(body)
    return f"""\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{escape(subject)}</title>
  </head>
  <body style="margin:0; padding:0; background:{C["bg_app"]};">
    <!-- Generated from {md_path.name} by docs/marketing/emails/render.py — edit the .md, not this file. -->
    <!-- Colors inlined from design/tokens/colors_and_type.css (email clients strip CSS variables). -->
    <span style="display:none; max-height:0; overflow:hidden; opacity:0;">{escape(preheader)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; background:{C["bg_app"]};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; max-width:560px; background:{C["bg_surface"]}; border:1px solid {C["border"]}; border-radius:14px;">
            <tr>
              <td style="padding:28px 28px 8px 28px;">
                <img src="{LOGO_URL}" width="156" alt="mgz-pkmn" style="display:block; width:156px; max-width:100%; height:auto; border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 4px 28px;">
              {content}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 28px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; border-top:1px solid {C["border"]};">
                  <tr>
                    <td style="padding:16px 0 0 0; font-family:{FONT_BODY}; color:{C["fg_muted"]}; font-size:13px; line-height:1.6;">
                      You're getting this because you signed up at <a href="https://mgz-pkmn.com" style="color:{C["brand_secondary"]}; text-decoration:underline;">mgz-pkmn.com</a>.
                      <a href="{UNSUBSCRIBE_TOKEN}" style="color:{C["brand_secondary"]}; text-decoration:underline;">Unsubscribe</a> anytime.
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


def iter_email_files() -> list[Path]:
    files: list[Path] = []
    for track in TRACKS:
        files.extend(sorted((EMAILS_DIR / track).glob("*.md")))
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if any .html is missing or out of date (don't write).",
    )
    args = ap.parse_args()

    stale: list[str] = []
    for md_path in iter_email_files():
        html_path = md_path.with_suffix(".html")
        rendered = render_email(md_path)
        if args.check:
            current = html_path.read_text(encoding="utf-8") if html_path.exists() else ""
            if current != rendered:
                stale.append(str(html_path.relative_to(EMAILS_DIR)))
        else:
            html_path.write_text(rendered, encoding="utf-8")
            print(f"rendered {html_path.relative_to(EMAILS_DIR)}")

    if args.check and stale:
        print(
            "Stale rendered emails (run `python docs/marketing/emails/render.py`):", file=sys.stderr
        )
        for s in stale:
            print(f"  - {s}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
