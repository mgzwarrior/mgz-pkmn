from __future__ import annotations

import datetime as _dt
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import MagicMock

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mgz_pkmn import cache as disk_cache
from mgz_pkmn.set_cards import (
    _draw_logo,
    _release_year,
    fetch_all_sets,
    warm_set_images,
    write_set_cards_pdf,
)


def _set(
    *,
    sid: str = "sv8",
    name: str = "Surging Sparks",
    series: str | None = "Scarlet & Violet",
    total: int | None = 252,
    printed: int | None = 191,
    release: str | None = "2024/11/08",
    logo: str | None = "https://images.pokemontcg.io/sv8/logo.png",
) -> dict:
    out: dict = {
        "id": sid,
        "name": name,
        "series": series,
        "total": total,
        "printedTotal": printed,
        "releaseDate": release,
    }
    if logo is not None:
        out["images"] = {"logo": logo, "symbol": logo.replace("logo", "symbol")}
    return out


class ReleaseYearTests(unittest.TestCase):
    def test_parses_iso_like_date(self) -> None:
        self.assertEqual(_release_year("2024/11/08"), "2024")

    def test_handles_year_only(self) -> None:
        self.assertEqual(_release_year("1999"), "1999")

    def test_none_when_missing(self) -> None:
        self.assertIsNone(_release_year(None))
        self.assertIsNone(_release_year(""))


class FetchAllSetsTests(unittest.TestCase):
    def test_normalizes_pokemontcg_payload(self) -> None:
        client = MagicMock()
        response = MagicMock()
        response.json.return_value = {
            "data": [
                {
                    "id": "sv8",
                    "name": "Surging Sparks",
                    "series": "Scarlet & Violet",
                    "printedTotal": 191,
                    "total": 252,
                    "releaseDate": "2024/11/08",
                    "images": {
                        "logo": "https://images.pokemontcg.io/sv8/logo.png",
                        "symbol": "https://images.pokemontcg.io/sv8/symbol.png",
                    },
                },
                # Skipped — no id.
                {"name": "Bogus"},
            ]
        }
        client.session.get.return_value = response

        sets = fetch_all_sets(client)
        self.assertEqual(len(sets), 1)
        self.assertEqual(sets[0]["id"], "sv8")
        self.assertEqual(sets[0]["images"]["logo"], "https://images.pokemontcg.io/sv8/logo.png")


class WritePdfTests(unittest.TestCase):
    def test_renders_pdf_without_network(self) -> None:
        sets = [_set(), _set(sid="sv7", name="Stellar Crown", printed=142, total=175)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            written = write_set_cards_pdf(sets, out)
            self.assertEqual(written, 2)
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)

    def test_zero_when_no_sets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            self.assertEqual(write_set_cards_pdf([], out), 0)
            self.assertFalse(out.exists())

    def test_paginates_when_more_than_nine_sets(self) -> None:
        sets = [_set(sid=f"set-{i}", name=f"Set {i}") for i in range(11)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            written = write_set_cards_pdf(sets, out)
            self.assertEqual(written, 11)
            self.assertTrue(out.exists())

    def test_handles_missing_optional_fields(self) -> None:
        # Cards with no release date / total / logo still render.
        sets = [_set(release=None, total=None, printed=None, logo=None, series=None)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            written = write_set_cards_pdf(sets, out)
            self.assertEqual(written, 1)
            self.assertTrue(out.exists())

    def test_today_override(self) -> None:
        # The `today` knob is mostly for snapshot tests; just verify it
        # accepts a date and doesn't blow up.
        sets = [_set()]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            written = write_set_cards_pdf(sets, out, today=_dt.date(2026, 5, 10))
            self.assertEqual(written, 1)


class _IsolatedCacheMixin(unittest.TestCase):
    """Point cache_root() at a tempdir so the image cache stays test-local."""

    def setUp(self) -> None:
        super().setUp()
        self._tmp = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CACHE_HOME")
        os.environ["XDG_CACHE_HOME"] = self._tmp.name
        os.environ.pop(disk_cache._NO_CACHE_ENV, None)

    def tearDown(self) -> None:
        if self._old_xdg is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._old_xdg
        self._tmp.cleanup()
        super().tearDown()


def _client_with_responses(responses: dict[str, bytes]) -> MagicMock:
    """Build a TCGClient stand-in whose session returns the mapped bytes."""
    client = MagicMock()

    def _get(url: str, timeout: float | None = None) -> MagicMock:
        resp = MagicMock()
        resp.status_code = 200
        resp.content = responses.get(url, b"")
        resp.raise_for_status.return_value = None
        return resp

    client.session.get.side_effect = _get
    return client


class WarmSetImagesTests(_IsolatedCacheMixin):
    def test_warms_logo_and_symbol_for_every_set(self) -> None:
        sets = [
            {
                "id": "sv8",
                "name": "Surging Sparks",
                "images": {
                    "logo": "https://example/sv8-logo.png",
                    "symbol": "https://example/sv8-symbol.png",
                },
            },
            {
                "id": "sv7",
                "name": "Stellar Crown",
                "images": {
                    "logo": "https://example/sv7-logo.png",
                    "symbol": "https://example/sv7-symbol.png",
                },
            },
        ]
        client = _client_with_responses(
            {
                "https://example/sv8-logo.png": b"sv8-logo",
                "https://example/sv8-symbol.png": b"sv8-symbol",
                "https://example/sv7-logo.png": b"sv7-logo",
                "https://example/sv7-symbol.png": b"sv7-symbol",
            }
        )

        result = warm_set_images(client, sets=sets)

        self.assertEqual(result.sets, 2)
        self.assertEqual(result.logos_cached, 2)
        self.assertEqual(result.symbols_cached, 2)
        self.assertEqual(result.failures, 0)
        # Verify each artifact landed in the right cache slot.
        for sid in ("sv8", "sv7"):
            self.assertIsNotNone(disk_cache.read_image("sets/logo", sid))
            self.assertIsNotNone(disk_cache.read_image("sets/symbol", sid))

    def test_second_warm_pass_is_cache_only(self) -> None:
        sets = [
            {
                "id": "sv8",
                "name": "Surging Sparks",
                "images": {"logo": "https://example/sv8-logo.png"},
            }
        ]
        client = _client_with_responses({"https://example/sv8-logo.png": b"sv8-logo"})

        warm_set_images(client, sets=sets)
        first_calls = client.session.get.call_count
        warm_set_images(client, sets=sets)

        # First pass downloaded; second pass should not have touched the network.
        self.assertEqual(client.session.get.call_count, first_calls)

    def test_skips_sets_without_images(self) -> None:
        sets = [
            {"id": "old1", "name": "No Images"},
            {
                "id": "old2",
                "name": "Only Logo",
                "images": {"logo": "https://example/old2-logo.png"},
            },
        ]
        client = _client_with_responses({"https://example/old2-logo.png": b"old2-logo"})

        result = warm_set_images(client, sets=sets)

        self.assertEqual(result.sets, 2)
        self.assertEqual(result.logos_cached, 1)
        self.assertEqual(result.symbols_cached, 0)
        self.assertEqual(result.failures, 0)


class WritePdfUsesImageCacheTests(_IsolatedCacheMixin):
    def test_uses_cached_logo_when_present(self) -> None:
        # Pre-seed the cache and confirm write_set_cards_pdf reads from it
        # instead of calling the session.
        disk_cache.write_image("sets/logo", "sv8", b"\x89PNG\r\n\x1a\n" + b"fake")
        sets = [
            {
                "id": "sv8",
                "name": "Surging Sparks",
                "images": {"logo": "https://example/sv8-logo.png"},
            }
        ]
        session = MagicMock()  # Should never be invoked.

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "set-cards.pdf"
            written = write_set_cards_pdf(sets, out, session=session)
            self.assertEqual(written, 1)
            self.assertTrue(out.exists())
        session.get.assert_not_called()


class DrawLogoTests(unittest.TestCase):
    def test_corrupt_file_logs_and_draws_placeholder(self) -> None:
        # A path that exists but isn't a valid image used to silently fail.
        # Now it should log to stderr and render an "image error" placeholder
        # instead of leaving an invisible gap.
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "broken.png"
            bad.write_bytes(b"not a real image")
            out = Path(tmp) / "out.pdf"
            c = canvas.Canvas(str(out), pagesize=letter)

            err = io.StringIO()
            with redirect_stderr(err):
                _draw_logo(c, bad, 100, 100, 100, 50)
            c.save()

            self.assertIn("logo render failed", err.getvalue())
            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
