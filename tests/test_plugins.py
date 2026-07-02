"""Tests for the entry-point plugin surface (ADR-0012, docs/plugins.md)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import click

from mgz_pkmn import plugins
from mgz_pkmn.cli import cli
from mgz_pkmn.cli.lookup import _run_plugin_writer
from mgz_pkmn.parser import CardQuery
from mgz_pkmn.pricing import Pricing
from mgz_pkmn.spreadsheet import Row


class FakeEntryPoint:
    """Stand-in for importlib.metadata.EntryPoint with a canned payload."""

    def __init__(self, name: str, payload=None, *, raises: Exception | None = None):
        self.name = name
        self.value = f"fake_plugin:{name}"
        self._payload = payload
        self._raises = raises

    def load(self):
        if self._raises is not None:
            raise self._raises
        return self._payload


def _patch_group(group: str, eps: list[FakeEntryPoint]):
    """Patch discovery so only `group` yields `eps`; other groups stay empty."""

    def fake_iter(requested: str) -> list[FakeEntryPoint]:
        return eps if requested == group else []

    return patch.object(plugins, "_iter_entry_points", side_effect=fake_iter)


@click.command()
def _sample_command() -> None:
    click.echo("sample plugin ran")


class RegisterPluginCommandsTests(unittest.TestCase):
    def test_mounts_plugin_command_under_entry_point_name(self) -> None:
        group = click.Group()
        eps = [FakeEntryPoint("vendor", _sample_command)]
        with _patch_group(plugins.COMMANDS_GROUP, eps):
            plugins.register_plugin_commands(group)
        self.assertIn("vendor", group.commands)
        result = CliRunner().invoke(group, ["vendor"])
        self.assertEqual(result.exit_code, 0)
        self.assertIn("sample plugin ran", result.output)

    def test_broken_plugin_warns_and_is_skipped(self) -> None:
        group = click.Group()
        eps = [
            FakeEntryPoint("broken", raises=RuntimeError("boom")),
            FakeEntryPoint("vendor", _sample_command),
        ]
        with _patch_group(plugins.COMMANDS_GROUP, eps), patch.object(plugins, "_warn") as warn:
            plugins.register_plugin_commands(group)
        self.assertNotIn("broken", group.commands)
        # The failure never blocks later plugins from mounting.
        self.assertIn("vendor", group.commands)
        warn.assert_called_once()
        self.assertIn("boom", warn.call_args[0][0])

    def test_non_command_payload_is_skipped(self) -> None:
        group = click.Group()
        eps = [FakeEntryPoint("notacommand", object())]
        with _patch_group(plugins.COMMANDS_GROUP, eps), patch.object(plugins, "_warn") as warn:
            plugins.register_plugin_commands(group)
        self.assertEqual(group.commands, {})
        warn.assert_called_once()

    def test_existing_command_wins_name_collision(self) -> None:
        group = click.Group()

        @group.command(name="lookup")
        def builtin() -> None:
            click.echo("builtin")

        eps = [FakeEntryPoint("lookup", _sample_command)]
        with _patch_group(plugins.COMMANDS_GROUP, eps), patch.object(plugins, "_warn") as warn:
            plugins.register_plugin_commands(group)
        result = CliRunner().invoke(group, ["lookup"])
        self.assertIn("builtin", result.output)
        warn.assert_called_once()


class LoadWritersTests(unittest.TestCase):
    def test_discovers_callable_writers(self) -> None:
        writes: list[tuple] = []
        eps = [FakeEntryPoint("csv", lambda rows, path: writes.append((rows, path)))]
        with _patch_group(plugins.WRITERS_GROUP, eps):
            writers = plugins.load_writers()
        self.assertEqual(list(writers), ["csv"])
        writers["csv"]([], Path("x"))
        self.assertEqual(writes, [([], Path("x"))])

    def test_non_callable_writer_is_skipped(self) -> None:
        eps = [FakeEntryPoint("bad", "not-callable")]
        with _patch_group(plugins.WRITERS_GROUP, eps), patch.object(plugins, "_warn") as warn:
            writers = plugins.load_writers()
        self.assertEqual(writers, {})
        warn.assert_called_once()


class LoadSourcesTests(unittest.TestCase):
    def test_discovers_sources(self) -> None:
        marker = object()
        eps = [FakeEntryPoint("mysource", marker)]
        with _patch_group(plugins.SOURCES_GROUP, eps):
            sources = plugins.load_sources()
        self.assertEqual(sources, {"mysource": marker})


class ResolveWriterSpecsTests(unittest.TestCase):
    def test_empty_specs_short_circuit_without_discovery(self) -> None:
        with patch.object(plugins, "load_writers") as load:
            self.assertEqual(plugins.resolve_writer_specs(()), [])
        load.assert_not_called()

    def test_valid_spec_resolves(self) -> None:
        writer = lambda rows, path: None  # noqa: E731
        eps = [FakeEntryPoint("csv", writer)]
        with _patch_group(plugins.WRITERS_GROUP, eps):
            resolved = plugins.resolve_writer_specs(("csv=out.csv",))
        self.assertEqual(resolved, [("csv", writer, Path("out.csv"))])

    def test_path_expands_user_home(self) -> None:
        eps = [FakeEntryPoint("csv", lambda rows, path: None)]
        with _patch_group(plugins.WRITERS_GROUP, eps):
            resolved = plugins.resolve_writer_specs(("csv=~/out.csv",))
        self.assertEqual(resolved[0][2], Path("~/out.csv").expanduser())
        self.assertNotIn("~", str(resolved[0][2]))

    def test_malformed_spec_raises(self) -> None:
        with _patch_group(plugins.WRITERS_GROUP, []), self.assertRaises(click.BadParameter) as ctx:
            plugins.resolve_writer_specs(("just-a-name",))
        self.assertIn("NAME=PATH", str(ctx.exception))

    def test_unknown_writer_lists_available(self) -> None:
        eps = [FakeEntryPoint("csv", lambda rows, path: None)]
        with _patch_group(plugins.WRITERS_GROUP, eps), self.assertRaises(click.BadParameter) as ctx:
            plugins.resolve_writer_specs(("nope=x",))
        self.assertIn("csv", str(ctx.exception))

    def test_unknown_writer_with_none_installed(self) -> None:
        with _patch_group(plugins.WRITERS_GROUP, []), self.assertRaises(click.BadParameter) as ctx:
            plugins.resolve_writer_specs(("nope=x",))
        self.assertIn("none installed", str(ctx.exception))


class RunPluginWriterTests(unittest.TestCase):
    def _row(self) -> Row:
        return Row(query=CardQuery(raw="x", name="x"), card=None, pricing=Pricing(), tag="t")

    def test_successful_write_receives_rows_and_path(self) -> None:
        seen: list[tuple] = []
        rows = [self._row()]
        _run_plugin_writer("csv", lambda r, p: seen.append((r, p)), rows, Path("out.csv"))
        self.assertEqual(seen, [(rows, Path("out.csv"))])

    def test_writer_failure_is_a_hard_error(self) -> None:
        def bad(rows, path):
            raise ValueError("disk full")

        with self.assertRaises(click.ClickException) as ctx:
            _run_plugin_writer("csv", bad, [self._row()], Path("out.csv"))
        self.assertIn("ValueError: disk full", str(ctx.exception.message))

    def test_writer_failure_with_empty_message_still_names_the_type(self) -> None:
        def bad(rows, path):
            raise ValueError

        with self.assertRaises(click.ClickException) as ctx:
            _run_plugin_writer("csv", bad, [self._row()], Path("out.csv"))
        self.assertIn("ValueError", str(ctx.exception.message))


class LookupWriterOptionTests(unittest.TestCase):
    def test_unknown_writer_fails_before_any_lookup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            input_file = Path(tmp) / "cards.txt"
            input_file.write_text("Pikachu | 58/102 | Base Set\n", encoding="utf-8")
            with _patch_group(plugins.WRITERS_GROUP, []):
                result = CliRunner().invoke(
                    cli, ["lookup", "--writer", "nope=x.csv", str(input_file)]
                )
        self.assertEqual(result.exit_code, 2)
        self.assertIn("unknown writer", result.output)
        # Failing fast means the run banner never prints (no network work).
        self.assertNotIn("Reading inputs", result.output)


if __name__ == "__main__":
    unittest.main()
