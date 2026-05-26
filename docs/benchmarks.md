# Benchmarks

A reference set of expected lookup latencies for the workloads users
hit most often. The point isn't absolute fidelity — networks vary,
caches warm at different rates, upstream APIs occasionally throttle —
it's giving a reviewer (human or AI) a *"this is what normal looks
like"* anchor to judge whether a change has measurably slowed the
pipeline down.

Pair this with the **Show lookup timer** toggle in the
[Settings drawer](../web/src/components/SettingsDrawer.tsx): turn it
on, run one of the workloads below, and compare the on-screen total
against the expected range. If the number lands well outside the
range, that's worth reporting — see the [Performance section in the
bug template](../.github/ISSUE_TEMPLATE/bug.md).

## Reference machine

The ranges below were captured on a typical dev machine:

- **CPU:** Apple Silicon (M-series)
- **RAM:** 24 GB
- **OS:** macOS 26
- **Network:** Wired or strong Wi-Fi; no VPN
- **Cache state:** Noted per row (warm / cold)

"Warm" means the API response cache (`~/.cache/mgz-pkmn`) already
holds the response for the query; the only work is reading from disk
and rendering. "Cold" means the cache was just pruned
(`pkmn cache prune`) so every request hits the upstream API.

## Reference workloads

| Workload | Input | CLI | SPA click path | Expected range | Notes |
|---|---|---|---|---|---|
| 1 explicit card (warm) | `Charizard \| Base Set \| 4/102` | `pkmn lookup -q 'Charizard \| Base Set \| 4/102'` | Paste into the input box · **Look up** | 50–150 ms | Cache-hit path |
| 1 explicit card (cold) | `Charizard \| Base Set \| 4/102` | `pkmn cache prune && pkmn lookup -q 'Charizard \| Base Set \| 4/102'` | Same as above after `pkmn cache prune` | 0.8–1.5 s | First call after cache prune |
| 10-line mixed list (warm) | The empty-state example chips, one per line | `pkmn lookup -i examples.txt` | Click each example chip on the empty state | 0.5–1.0 s | Mix of explicit, bulk, and variant queries |
| `top:25 Charizard cards` (warm) | `top:25 Charizard cards` | `pkmn lookup -q 'top:25 Charizard cards'` | Paste · **Look up** | 1.5–3.0 s | Bulk path; 25-card expansion |
| `All Charizard cards \| Base Set` (warm) | `All Charizard cards \| Base Set` | `pkmn lookup -q 'All Charizard cards \| Base Set'` | Paste · **Look up** | 0.8–1.6 s | Bulk path, narrow set filter |
| Set ID cards PDF (warm) | n/a | `pkmn set-cards --set base1,jungle,fossil` | **Set ID cards…** · pick a few sets · **Download PDF** | 2–4 s | Every-set walk; PDF render dominates |

The SPA path's timing is measured wall-clock from "first SSE event
received" to "done event received" so it reflects user-felt latency
(network + SSE overhead included), not backend wall-clock alone.

## When to investigate

A single run landing 1.5–2× over the expected range is usually
noise — try a second run, especially if the cache was unexpectedly
cold. Consistent slowdowns of **2× or more across multiple runs and
multiple workloads** are the signal worth filing.

For backend-side per-stage timings — which call took how long inside
a single lookup — see the per-line stage events tracked under
[#260](https://github.com/mgzwarrior/mgz-pkmn/issues/260). The total
here is the user-felt number; the stages there are the breakdown.
