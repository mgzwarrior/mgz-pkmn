# mgz-pkmn documentation

Reference docs for the CLI, the lookup pipeline, and the output artifacts.
The repo's [root README](../README.md) is the install + quickstart entry
point — start there, then drill into a topic below.

## Reference

| Page | What's in it |
|---|---|
| [CLI reference](cli.md) | Every flag, the option matrix, and `pkmn` invocation patterns. |
| [Input format](input-format.md) | Single-card lookup syntax (pipe / dash / positional / markdown), variant hints, and the bulk `top:N` / `All …` family. |
| [Sources & coverage](sources.md) | How pokemontcg.io, TCGdex, and PriceCharting are layered, plus what failure messages mean. |
| [Languages](languages.md) | How non-English / regional cards are detected and surfaced in every artifact. |
| [Outputs](outputs.md) | Spreadsheet column reference and the JSON report schema. |
| [PDF binder](binder-pdf.md) | Standard 3×3 (placeholder cards) and condensed 6×4 (visual scan) layouts. |
| [Checklist PDF](checklist.md) | Front-of-binder checklist output and how `--sort` shapes its order. |
| [Cache](cache.md) | Disk cache layout, TTLs, URL overrides, and when to use `--no-cache` / `--clear-cache`. |
| [Plugins](plugins.md) | Entry-point groups for third-party subcommands and output writers, with a minimal example package. |
| [Accessibility](accessibility.md) | What we commit to, how we enforce it (axe-core in CI + live-browser scan), keyboard reference, and how to add new UI without regressing. |
| [Deployment](deployment.md) | Production recipes: Render, Docker, env vars, reverse-proxy config. |

## Sub-project docs (co-located with code)

| Page | Scope |
|---|---|
| [api/README.md](../api/README.md) | FastAPI endpoint reference, SSE streaming, troubleshooting. |
| [web/README.md](../web/README.md) | React + Vite frontend, dev server, build, settings. |

## Project direction

| Page | What's in it |
|---|---|
| [Architecture decisions](adr/) | The load-bearing decisions behind the codebase, recorded as ADRs (one decision per file, dated, with alternatives). |
| [Roadmap](roadmap.md) | V1 polish items + V2 directions, organized by project area. |

## Contributing

See [contributing.md](contributing.md) for project layout, dev workflow,
pre-commit hooks, CI, and the release process.

Questions before you open an issue or PR? Start a thread in [GitHub Discussions](https://github.com/mgzwarrior/mgz-pkmn/discussions) so the conversation is easy for future contributors to find.
