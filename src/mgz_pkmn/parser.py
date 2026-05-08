"""Parse free-form card list lines into structured CardQuery objects."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

# A "number" token: 4/102, SWSH286, SV20/SV94, TG01/TG30, 199a/165, etc.
NUMBER_RE = re.compile(r"^[A-Za-z]{0,6}\d+[a-z]?(?:/[A-Za-z]{0,6}\d+[a-z]?)?$")
VARIANT_RE = re.compile(r"\[([^\]]+)\]")
URL_RE = re.compile(r"https?://\S+")

# "Top-N chase cards" trigger phrases. Two shapes:
#   1. "All <subject> cards|prints"     — suffix REQUIRED so we don't grab
#                                         real card names that start with "All"
#                                         (e.g. "All Energy Removal").
#   2. "top:<N> <subject>" / "top <N> <subject>" — explicit, suffix optional.
DEFAULT_BULK_TOP = 5
ALL_PHRASE_RE = re.compile(r"^all\s+(.+?)\s+(?:cards?|prints?|versions?)\s*$", re.IGNORECASE)
TOP_PHRASE_RE = re.compile(
    r"^top[:\s]+(\d+)\s+(.+?)\s*(?:cards?|prints?|versions?)?\s*$", re.IGNORECASE
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

    def __str__(self) -> str:
        bound_bits: list[str] = []
        if self.price_min is not None:
            bound_bits.append(f">=${self.price_min:g}")
        if self.price_max is not None:
            bound_bits.append(f"<=${self.price_max:g}")
        bound = f" ({' '.join(bound_bits)})" if bound_bits else ""
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
    body, price_min, price_max = _extract_price_conds(body)

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
    )


def _extract_price_conds(body: str) -> tuple[str, float | None, float | None]:
    """Pull `>=`, `<=`, `>`, `<` numeric conditions out of a line and return
    the cleaned body plus the resolved (min, max) bounds.

    Multiple conditions on the same side narrow toward the more restrictive
    bound (`>= 20 >= 30` → min=30; `<= 100 <= 50` → max=50). Inclusive vs
    strict is collapsed — `>` is treated like `>=` and `<` like `<=` for
    simplicity since "exactly $20" isn't a useful budget filter."""
    price_min: float | None = None
    price_max: float | None = None

    def _capture(m: re.Match) -> str:
        nonlocal price_min, price_max
        op, raw_val = m.group(1), m.group(2)
        val = float(raw_val)
        if op in (">=", ">"):
            price_min = val if price_min is None else max(price_min, val)
        else:
            price_max = val if price_max is None else min(price_max, val)
        return ""

    cleaned = PRICE_COND_RE.sub(_capture, body)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    # Trim trailing connectors / separators left over after the substitution
    # (e.g. "X cards >= $20" → "X cards", or "X | >= $20" → "X").
    cleaned = re.sub(r"[,;|\-—\s]+$", "", cleaned).strip()
    return cleaned, price_min, price_max


def _normalize_number(raw: str) -> str:
    """Strip whitespace; preserve case (some sets use 'SV20', 'TG01')."""
    return raw.replace(" ", "").strip()


def _try_bulk(body: str) -> tuple[int, str, str | None] | None:
    """Detect a 'top-N chase cards' line and return (count, name, set_hint).

    Allows an optional pipe-delimited set hint:
        top:5 Exeggutor | Aquapolis
        All Charizard cards | Hidden Fates

    A leading 'top:N'/'top N' triggers bulk unconditionally. 'All …' requires
    a 'cards|prints|versions' suffix so real card names like 'All Energy
    Removal' aren't accidentally treated as bulk. If the line doesn't start
    with one of those forms, returns None and parsing falls through to the
    single-card path."""
    head, set_hint = _split_set_hint(body)

    m = TOP_PHRASE_RE.match(head)
    if m:
        return int(m.group(1)), m.group(2).strip(), set_hint
    m = ALL_PHRASE_RE.match(head)
    if m:
        return DEFAULT_BULK_TOP, m.group(1).strip(), set_hint
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


def read_input(path) -> list[CardQuery]:
    """Read a card-list file and return the parsed queries."""
    queries: list[CardQuery] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        q = parse_line(line)
        if q is not None:
            queries.append(q)
    return queries
