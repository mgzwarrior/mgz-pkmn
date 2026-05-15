"""Parse free-form card list lines into structured CardQuery objects."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

# A "number" token: 4/102, SWSH286, SV20/SV94, TG01/TG30, 199a/165, etc.
NUMBER_RE = re.compile(r"^[A-Za-z]{0,6}\d+[a-z]?(?:/[A-Za-z]{0,6}\d+[a-z]?)?$")
# Limit variant hint to 100 non-bracket characters to prevent catastrophic
# backtracking on adversarial inputs sent via the API.
VARIANT_RE = re.compile(r"\[([^\]\n\r]{1,100})\]")
URL_RE = re.compile(r"https?://\S+")

# "Top-N chase cards" trigger phrases. Two shapes:
#   1. "All <subject> cards|prints"     — suffix REQUIRED so we don't grab
#                                         real card names that start with "All"
#                                         (e.g. "All Energy Removal"). Maps
#                                         to bulk_all=True (every match).
#   2. "top:<N> <subject>" / "top <N> <subject>" — explicit, suffix optional.
# Split into a two-step parse (prefix match + suffix strip) so that each
# individual regex is simple and non-backtracking.
# Matches only the "top:N " prefix of a bulk line.
_TOP_PREFIX_RE = re.compile(r"^top[: \t]+(\d+)[ \t]+", re.IGNORECASE)
# Matches only the "all " prefix of an "all <subject> cards" line.
_ALL_PREFIX_RE = re.compile(r"^all[ \t]+", re.IGNORECASE)
# Known trailing suffix words that identify a bulk-lookup line.  Using a
# frozenset + str.rsplit() avoids any regex on the subject body, which would
# risk O(n²) backtracking when the tail is full of whitespace.
_BULK_SUFFIX_WORDS: frozenset[str] = frozenset(
    ("cards", "card", "prints", "print", "versions", "version")
)

# In-line per-card price conditions on bulk lookups. Match a comparator
# (`>=`, `<=`, `>`, `<`) followed by an optional currency symbol and a
# number. Ordered longest-first so `>=` wins over `>`.
PRICE_COND_RE = re.compile(r"(>=|<=|>|<)\s*[\$€]?(\d+(?:\.\d+)?)")

# Leading list / task-list markers we strip before parsing the rest of the line:
#   "- [ ] ", "- [x] ", "* [ ] ", "1. ", "1) ", "- ", "* ", "• "
LIST_PREFIX_RE = re.compile(
    r"""^\s*(?:
            (?:[-*+•]|\d+[.)])         # bullet or "1." / "1)"
            \s+
            (?:\[[ xX\-/.]\]\s+)?      # optional task-list checkbox: [ ] [x] [-] [/]
        )+""",
    re.VERBOSE,
)

# Tokens that are clearly *descriptors* about a card rather than part of its name.
# We keep these in the original raw input but drop them when we ask the API for
# a match — they only ever hurt name search precision.
NOISE_TOKENS = frozenset(
    {
        # Language / region
        "chinese",
        "japanese",
        "korean",
        "german",
        "french",
        "spanish",
        "italian",
        "english",
        "portuguese",
        "thai",
        "indonesian",
        "asia",
        "asian",
        "international",
        # Rarity codes / print qualifiers (these often appear in collector lists)
        "sir",
        "sar",
        "ar",
        "fa",
        "rr",
        "ur",
        "hr",
        "secret",
        "promo",
        "promotional",
        "stamped",
    }
)

# Map a language descriptor in a card line ("Chinese", "Japanese", ...) to the
# TCGdex language codes we should query. Order matters — listed first is tried
# first when we fall back.
LANG_HINTS: dict[str, list[str]] = {
    "chinese": ["zh-tw", "zh-cn"],
    "japanese": ["ja"],
    "korean": ["ko"],
    "german": ["de"],
    "french": ["fr"],
    "spanish": ["es"],
    "italian": ["it"],
    "portuguese": ["pt", "pt-br"],
    "thai": ["th"],
    "indonesian": ["id"],
    "polish": ["pl"],
    "dutch": ["nl"],
}


@dataclass
class CardQuery:
    raw: str
    name: str
    set_hint: str | None = None
    number: str | None = None
    variant_hint: str | None = None
    url_hint: str | None = None  # explicit lookup URL (e.g. PriceCharting product page)
    bulk_top: int | None = None  # if set, return that many chase cards instead of one
    # Per-line price bounds (currency-blind, like --max-price). Honored only on
    # bulk lookups: candidates outside the band are excluded *before* the
    # top-N cut so an "affordable top 10 ≥ $20" still returns 10.
    price_min: float | None = None
    price_max: float | None = None
    # Whether each bound is strict (`>` / `<`) or inclusive (`>=` / `<=`).
    # When True, a card whose price exactly equals the bound is excluded.
    price_min_exclusive: bool = False
    price_max_exclusive: bool = False
    # Set by "All <subject> cards" lines — return every matching card rather
    # than capping at top-N. Mutually exclusive with bulk_top in practice.
    bulk_all: bool = False

    def __str__(self) -> str:
        bound_bits: list[str] = []
        if self.price_min is not None:
            op = ">" if self.price_min_exclusive else ">="
            bound_bits.append(f"{op}${self.price_min:g}")
        if self.price_max is not None:
            op = "<" if self.price_max_exclusive else "<="
            bound_bits.append(f"{op}${self.price_max:g}")
        bound = f" ({' '.join(bound_bits)})" if bound_bits else ""
        if self.bulk_all:
            in_set = f" in {self.set_hint}" if self.set_hint else ""
            return f"all {self.name}{in_set}{bound}"
        if self.bulk_top:
            in_set = f" in {self.set_hint}" if self.set_hint else ""
            return f"top {self.bulk_top} {self.name}{in_set}{bound}"
        bits = [self.name]
        if self.set_hint:
            bits.append(f"({self.set_hint})")
        if self.number:
            bits.append(self.number)
        if self.variant_hint:
            bits.append(f"[{self.variant_hint}]")
        if self.url_hint:
            bits.append(f"<{self.url_hint}>")
        return " ".join(bits) + bound


def parse_line(line: str) -> CardQuery | None:
    """Best-effort parse of a single card line into name / set / number / variant."""
    raw_input = line.strip()
    if not raw_input or raw_input.startswith("#"):
        return None

    # Strip markdown task-list / bullet / numbered prefixes so the rest of the
    # parser doesn't have to worry about them.
    body = LIST_PREFIX_RE.sub("", raw_input).strip()
    if not body:
        return None

    variant = None
    m = VARIANT_RE.search(body)
    if m:
        variant = m.group(1).strip()
        body = (body[: m.start()] + body[m.end() :]).strip()

    # Pull any URL out of the line first — we treat it as an explicit lookup
    # hint and don't want it confused with a card number or set name.
    url_hint = None
    url_match = URL_RE.search(body)
    if url_match:
        url_hint = url_match.group(0).rstrip(",;)]")
        body = (body[: url_match.start()] + body[url_match.end() :]).strip()
        body = re.sub(r"[|\-—]\s*$", "", body).strip()

    # Keep `raw` referring to the original input (pre-strip) so the spreadsheet
    # column shows what the user actually wrote.
    raw = raw_input

    # In-line price conditions (`>= $20`, `<= $50`, `between` via two clauses).
    # Pulled out before bulk-phrase matching because the bulk regex is anchored
    # to end-of-string and would otherwise miss when a price tail is present.
    body, price_min, price_max, price_min_exclusive, price_max_exclusive = _extract_price_conds(
        body
    )

    if not body and url_hint:
        return CardQuery(
            raw,
            _name_from_url(url_hint),
            None,
            None,
            variant,
            url_hint,
            price_min=price_min,
            price_max=price_max,
            price_min_exclusive=price_min_exclusive,
            price_max_exclusive=price_max_exclusive,
        )

    # "Top-N chase cards" patterns trump the regular parsing. The user is
    # asking for a bulk lookup, not a single specific card. Pipe-delimited
    # set hints are allowed: "top:5 Exeggutor | Aquapolis".
    bulk = _try_bulk(body)
    if bulk is not None:
        count, name, set_hint = bulk
        return CardQuery(
            raw,
            name,
            set_hint,
            None,
            variant,
            url_hint,
            count,
            price_min=price_min,
            price_max=price_max,
            price_min_exclusive=price_min_exclusive,
            price_max_exclusive=price_max_exclusive,
            bulk_all=count is None,
        )

    # Pipe or dash delimited canonical forms first.
    for sep in ("|", " - ", " — "):
        if sep in body:
            parts = [p.strip() for p in body.split(sep) if p.strip()]
            if len(parts) >= 3:
                if NUMBER_RE.match(parts[-1].replace(" ", "")):
                    name = parts[0]
                    set_hint = " ".join(parts[1:-1])
                    return CardQuery(
                        raw,
                        name,
                        set_hint,
                        _normalize_number(parts[-1]),
                        variant,
                        url_hint,
                        price_min=price_min,
                        price_max=price_max,
                        price_min_exclusive=price_min_exclusive,
                        price_max_exclusive=price_max_exclusive,
                    )
                return CardQuery(
                    raw,
                    parts[0],
                    " ".join(parts[1:]),
                    None,
                    variant,
                    url_hint,
                    price_min=price_min,
                    price_max=price_max,
                    price_min_exclusive=price_min_exclusive,
                    price_max_exclusive=price_max_exclusive,
                )
            if len(parts) == 2:
                if NUMBER_RE.match(parts[1].replace(" ", "")):
                    return CardQuery(
                        raw,
                        parts[0],
                        None,
                        _normalize_number(parts[1]),
                        variant,
                        url_hint,
                        price_min=price_min,
                        price_max=price_max,
                        price_min_exclusive=price_min_exclusive,
                        price_max_exclusive=price_max_exclusive,
                    )
                return CardQuery(
                    raw,
                    parts[0],
                    parts[1],
                    None,
                    variant,
                    url_hint,
                    price_min=price_min,
                    price_max=price_max,
                    price_min_exclusive=price_min_exclusive,
                    price_max_exclusive=price_max_exclusive,
                )

    # Positional fallback. Find a number-shaped token; everything else is name+set.
    tokens = body.split()
    number = None
    leftover: list[str] = []
    for tok in tokens:
        if number is None and NUMBER_RE.match(tok):
            number = _normalize_number(tok)
        else:
            leftover.append(tok)

    if not leftover:
        return None
    name = " ".join(leftover)
    return CardQuery(
        raw,
        name,
        None,
        number,
        variant,
        url_hint,
        price_min=price_min,
        price_max=price_max,
        price_min_exclusive=price_min_exclusive,
        price_max_exclusive=price_max_exclusive,
    )


def _extract_price_conds(
    body: str,
) -> tuple[str, float | None, float | None, bool, bool]:
    """Pull `>=`, `<=`, `>`, `<` numeric conditions out of a line and return
    the cleaned body plus the resolved (min, max) bounds and their strict /
    inclusive flags.

    Multiple conditions on the same side narrow toward the more restrictive
    bound (`>= 20 >= 30` → min=30; `<= 100 <= 50` → max=50). Strict (`>`,
    `<`) and inclusive (`>=`, `<=`) are tracked distinctly: when two bounds
    name the same value, the strict form wins (it admits a smaller set).
    """
    price_min: float | None = None
    price_max: float | None = None
    price_min_exclusive = False
    price_max_exclusive = False

    def _capture(m: re.Match) -> str:
        nonlocal price_min, price_max, price_min_exclusive, price_max_exclusive
        op, raw_val = m.group(1), m.group(2)
        val = float(raw_val)
        strict = op in (">", "<")
        if op in (">=", ">"):
            if price_min is None or val > price_min:
                price_min = val
                price_min_exclusive = strict
            elif val == price_min and strict:
                price_min_exclusive = True
        else:
            if price_max is None or val < price_max:
                price_max = val
                price_max_exclusive = strict
            elif val == price_max and strict:
                price_max_exclusive = True
        return ""

    cleaned = PRICE_COND_RE.sub(_capture, body)
    # Collapse runs of spaces/tabs without using a backtracking regex.
    cleaned = " ".join(cleaned.split())
    # Trim trailing connectors / separators left over after the substitution
    # (e.g. "X cards >= $20" → "X cards", or "X | >= $20" → "X").
    # str.rstrip() is O(n) with no backtracking.
    cleaned = cleaned.rstrip(" ,;|-—")
    return cleaned, price_min, price_max, price_min_exclusive, price_max_exclusive


def _normalize_number(raw: str) -> str:
    """Strip whitespace; preserve case (some sets use 'SV20', 'TG01')."""
    return raw.replace(" ", "").strip()


def _strip_bulk_suffix(text: str) -> str:
    """Remove a trailing 'cards|prints|versions' word if present.

    Uses str.rsplit() + a frozenset lookup — O(n) with no regex backtracking.
    """
    parts = text.rsplit(None, 1)
    if len(parts) == 2 and parts[1].lower() in _BULK_SUFFIX_WORDS:
        return parts[0].rstrip()
    return text


def _try_bulk(body: str) -> tuple[int | None, str, str | None] | None:
    """Detect a 'top-N chase cards' line and return (count, name, set_hint).

    `count` is the explicit top-N for "top:N <subject>" forms, or `None` to
    signal "All …" — i.e. return every matching card rather than a top-N
    cut. The caller maps `None` to `bulk_all=True` on the CardQuery.

    Allows an optional pipe-delimited set hint:
        top:5 Exeggutor | Aquapolis
        All Charizard cards | Hidden Fates

    A leading 'top:N'/'top N' triggers bulk unconditionally. 'All …' requires
    a 'cards|prints|versions' suffix so real card names like 'All Energy
    Removal' aren't accidentally treated as bulk. If the line doesn't start
    with one of those forms, returns None and parsing falls through to the
    single-card path.

    Uses prefix-match regexes + str.rsplit() for the suffix so that no
    combination of quantifiers can cause polynomial backtracking on adversarial
    whitespace-heavy inputs."""
    head, set_hint = _split_set_hint(body)

    # --- "top:N <subject>" / "top N <subject>" ---
    m = _TOP_PREFIX_RE.match(head)
    if m:
        subject = _strip_bulk_suffix(head[m.end() :].strip())
        if subject:
            return int(m.group(1)), subject, set_hint
        return None

    # --- "All <subject> cards|prints|versions" ---
    m = _ALL_PREFIX_RE.match(head)
    if m:
        rest = head[m.end() :].strip()
        # The suffix is REQUIRED for "All …" so "All Energy Removal" is not
        # accidentally treated as a bulk query.
        parts = rest.rsplit(None, 1)
        if len(parts) == 2 and parts[1].lower() in _BULK_SUFFIX_WORDS:
            subject = parts[0].rstrip()
            if subject:
                return None, subject, set_hint
    return None


def _split_set_hint(body: str) -> tuple[str, str | None]:
    """If the line is `<head> | <set>`, split into (head, set). Otherwise
    return (body, None)."""
    if "|" in body:
        head, _, rest = body.partition("|")
        return head.strip(), (rest.strip() or None)
    return body, None


def _name_from_url(url: str) -> str:
    """Best guess at a card name from a URL — fallback when the user provides
    only a URL and no other text on the line."""
    last = urlparse(url).path.rstrip("/").split("/")[-1] or "card"
    last = re.sub(r"-\d+$", "", last)
    return last.replace("-", " ").strip().title() or "card"


def strip_noise(name: str) -> str:
    """Drop language/rarity descriptors that hurt name search precision."""
    tokens = [t for t in name.split() if t.lower() not in NOISE_TOKENS]
    return " ".join(tokens).strip()


def detect_languages(name: str) -> list[str]:
    """Pull language hints out of the user's raw line."""
    out: list[str] = []
    tokens = [t.lower().strip(",") for t in name.split()]
    for token in tokens:
        for hint, langs in LANG_HINTS.items():
            if token == hint:
                out.extend(langs)
    return list(dict.fromkeys(out))


# Unicode script ranges we use to fingerprint a card's language from its name.
# Hiragana / katakana are unique to Japanese; hangul to Korean. CJK ideographs
# are shared across Chinese and Japanese kanji, so we only treat them as a
# Chinese signal when there's no kana present (i.e. kanji-only).
_HIRAGANA_KATAKANA_RE = re.compile("[\u3040-\u309f\u30a0-\u30ff]")
_HANGUL_RE = re.compile("[\uac00-\ud7af]")
_CJK_IDEOGRAPH_RE = re.compile("[\u3400-\u9fff]")


def detect_card_language(
    name: str | None,
    set_name: str | None = None,
    url: str | None = None,
) -> str:
    """Best-effort language code for a card returned by any source.

    Order of evidence:
      1. Script of the card name — kana → ja, hangul → ko, kanji-only → zh-cn.
      2. Keyword anywhere in the set name or URL slug — "japanese" / "chinese"
         / "korean" / "french" / "german" / "spanish" / "italian" /
         "portuguese". Used by sources whose payload doesn't include the
         localized name (e.g. PriceCharting product pages).

    Defaults to ``"en"`` when no evidence points elsewhere — the bulk of
    pokemontcg.io's catalog is English."""
    n = name or ""
    if _HIRAGANA_KATAKANA_RE.search(n):
        return "ja"
    if _HANGUL_RE.search(n):
        return "ko"
    if _CJK_IDEOGRAPH_RE.search(n):
        # Kanji-only — most likely Chinese (no kana means Japanese is unlikely).
        return "zh-cn"

    haystack = f"{set_name or ''} {url or ''}".lower()
    keyword_to_lang = {
        "japanese": "ja",
        "chinese": "zh-cn",
        "korean": "ko",
        "french": "fr",
        "german": "de",
        "spanish": "es",
        "italian": "it",
        "portuguese": "pt",
        "thai": "th",
    }
    for keyword, lang in keyword_to_lang.items():
        if keyword in haystack:
            return lang
    return "en"


def parse_lines(text: str) -> list[CardQuery]:
    """Parse a multi-line card list string and return the matched queries.

    Empty lines and lines starting with ``#`` are ignored. Every other line
    is passed through :func:`parse_line`; ``None`` results (unrecognised
    lines) are dropped silently.
    """
    queries: list[CardQuery] = []
    for line in text.splitlines():
        q = parse_line(line)
        if q is not None:
            queries.append(q)
    return queries


def read_input(path) -> list[CardQuery]:
    """Read a card-list file and return the parsed queries."""
    return parse_lines(path.read_text(encoding="utf-8"))
