---
name: Bug report
about: Report something that isn't working as expected
title: ''
labels: 'type:bug'
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**To reproduce**
Steps to reproduce the behavior — include the exact command or input file
where relevant:
1. Run `pkmn ...`
2. With input '...'
3. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Actual output**
Paste the relevant CLI output, traceback, or screenshot (for the web UI).

**Environment**
 - mgz-pkmn version: [`pkmn --version`]
 - Python version: [e.g. 3.12]
 - OS: [e.g. macOS 14, Ubuntu 22.04]
 - Install method: [pip / uv / Docker / from source]

**Performance (if relevant)**
Optional — fill in if the report is about something being slow. Turn on
**Show lookup timer** in the SPA settings drawer to capture these
numbers; ranges to compare against live in
[docs/benchmarks.md](../../docs/benchmarks.md).

 - Lookup timer (from settings drawer): [e.g. 12.4s · 25 cards · 496 ms/card]
 - Workload: [e.g. `top:25 Charizard cards`]
 - Cache state: [warm / cold / unknown]
 - Compared against benchmarks in docs/benchmarks.md: [within range / N× slower]

**Additional context**
Add any other context about the problem here.
