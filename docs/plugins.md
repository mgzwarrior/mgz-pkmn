# Plugins

The `pkmn` CLI has a deliberate plugin surface: separately installed packages can add subcommands and output writers without any coordination with this repo. It exists for two audiences at once — community plugins (custom outputs, workflows) and the private `mgz-pkmn-vendor` package that [ADR-0012](adr/0012-open-core-architecture.md) places on the paid side of the open-core line. The mechanism is standard [entry points](https://packaging.python.org/en/latest/specifications/entry-points/): install a package that registers against one of the groups below, and `pkmn` discovers it at startup. Uninstall it and the capability disappears.

## Entry-point groups

| Group | Loads to | What it does |
|---|---|---|
| `mgz_pkmn.commands` | a `click.Command` or `click.Group` | Mounted onto the root `pkmn` group under the entry point's name — `vendor = ...` becomes `pkmn vendor ...`. |
| `mgz_pkmn.writers` | a callable `write(rows, path)` | Receives the resolved lookup rows (`list[mgz_pkmn.spreadsheet.Row]`) and a destination `Path`. Invoked with `pkmn lookup --writer NAME=PATH`. |
| `mgz_pkmn.sources` | *(reserved)* | Lookup-source adapters. Discovery works (`mgz_pkmn.plugins.load_sources()`), but the lookup pipeline doesn't consume plugin sources yet — the wiring into the source ensemble ([ADR-0023](adr/0023-source-ensemble-pricing.md)) is tracked separately. |

## Security model

A plugin is a Python package you install, and it runs with your full privileges — the same trust decision as any other dependency. There is deliberately no approval list or vetting gate: an installed package can run arbitrary code with or without registering an entry point, so a gate here would add friction without adding safety. Install plugins only from authors you trust, exactly as you would any package from PyPI. What the CLI does guarantee is core integrity: a plugin that fails to load can't take `pkmn` down, and a plugin can never shadow a built-in command (see failure semantics below). Plugin discovery runs only in the CLI — the API service never loads plugins.

## Failure semantics

A broken plugin must never take the core CLI down. A plugin that fails to import, loads to the wrong type, or collides with an existing command name is skipped with a warning on stderr — built-ins always win a collision. The one deliberate exception: a writer you named on the command line (`--writer csv=out.csv`) failing to *write* is a hard error, because you asked for that artifact. Writer specs are also resolved before any lookups run, so a typo'd name fails fast instead of after a long network run.

## Writing a plugin

A minimal package that adds `pkmn hello` and a `csv` writer:

```toml
# pyproject.toml
[project]
name = "pkmn-hello"
dependencies = ["mgz-pkmn"]

[project.entry-points."mgz_pkmn.commands"]
hello = "pkmn_hello.cli:hello"

[project.entry-points."mgz_pkmn.writers"]
csv = "pkmn_hello.writers:write_csv"
```

```python
# pkmn_hello/cli.py
import click


@click.command()
def hello() -> None:
    """Say hello from a plugin."""
    click.echo("hello from a plugin")
```

```python
# pkmn_hello/writers.py
import csv
from pathlib import Path

from mgz_pkmn.spreadsheet import Row


def write_csv(rows: list[Row], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["name", "set", "market"])
        for row in rows:
            card = row.card or {}
            writer.writerow([card.get("name"), (card.get("set") or {}).get("name"), row.pricing.market])
```

Install it next to `mgz-pkmn` (`pip install pkmn-hello`) and both hooks are live:

```console
$ pkmn hello
hello from a plugin
$ pkmn lookup cards.txt --writer csv=cards.csv
```

Multi-command plugins register a `click.Group` instead of a `click.Command` — that's how the vendor package's `pkmn vendor <subcommand>` family mounts as one entry point.

## Stability

This surface is a public API. Per ADR-0012, breaking it is a downstream-impact event even while the set of published plugins is small, and declaring it stable is one of the triggers the [roadmap](roadmap.md) names for a V2 major bump. Treat changes to the group names, the writer signature, or `Row` fields consumed by writers as breaking.

## Where the open-core line sits

Per [ADR-0012](adr/0012-open-core-architecture.md) and the [#420 tracking issue](https://github.com/mgzwarrior/mgz-pkmn/issues/420): this repo carries the plugin entry points and this reference doc, and nothing else. Vendor-track implementation — the bulk card-recognition scanner, model selection, pricing logic, hosted infrastructure — lives in the private `mgz-pkmn-vendor` repo, which depends on `mgz-pkmn` as an ordinary pip dependency and registers against the groups above. Architectural or boundary questions go on [#420](https://github.com/mgzwarrior/mgz-pkmn/issues/420); vendor implementation work is out of scope for this repo.
