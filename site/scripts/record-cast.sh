#!/usr/bin/env bash
# Re-record site/public/casts/lookup-demo.cast.
#
# Why this exists
# ---------------
# The hero on mgz-pkmn.com embeds an asciinema cast of a real `pkmn lookup`
# run instead of a hand-curated <pre><code> block. This script captures it
# end-to-end against the tracked `sample_cards.txt` so the cast can be
# regenerated whenever CLI output drifts (banner, summary line, colors).
#
# Requirements
# ------------
# - asciinema 3+ (`brew install asciinema`)
# - pkmn (this repo's `make install` puts it on PATH)
# - Internet (the lookup hits pokemontcg.io; set POKEMONTCG_IO_API_KEY to
#   sidestep the anonymous rate limit)
#
# Usage
# -----
#   ./site/scripts/record-cast.sh
#
# The cast is overwritten in place. Commit the diff if it changed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CAST_PATH="${REPO_ROOT}/site/public/casts/lookup-demo.cast"
INNER_SCRIPT="$(mktemp -t mgz-cast-XXXX.sh)"
trap 'rm -f "${INNER_SCRIPT}"' EXIT

# The inner script is what `asciinema rec --command` runs. Keeping it in
# its own file (vs `--command "cd && cat && pkmn …"`) means the user can
# read the exact sequence the cast captures, and the prompt-printing
# stays consistent regardless of which shell is running outside.
cat >"${INNER_SCRIPT}" <<'SCRIPT'
#!/usr/bin/env bash
set -e
cd "${REPO_ROOT}"

prompt() {
  printf '\033[0;36m$ \033[0m%s\n' "$1"
}

prompt "cat sample_cards.txt"
grep -v '^#' sample_cards.txt | grep -v '^$'
sleep 1

echo
prompt "pkmn lookup sample_cards.txt -o /tmp/demo.xlsx --pdf /tmp/demo-binder.pdf --checklist /tmp/demo-checklist.pdf"
pkmn lookup sample_cards.txt \
  -o /tmp/demo.xlsx \
  --pdf /tmp/demo-binder.pdf \
  --checklist /tmp/demo-checklist.pdf

echo
prompt "ls -la /tmp/demo*"
ls -la /tmp/demo* 2>/dev/null | awk '{print $NF, "(" $5 " bytes)"}'
SCRIPT

chmod +x "${INNER_SCRIPT}"

mkdir -p "$(dirname "${CAST_PATH}")"

# `--overwrite` replaces any prior cast in place; `--idle-time-limit=1.5`
# clips long network waits so the timeline reflects a brisk session, not
# raw seconds spent waiting on pokemontcg.io.
REPO_ROOT="${REPO_ROOT}" asciinema rec \
  --overwrite \
  --idle-time-limit=1.5 \
  --cols=100 \
  --rows=30 \
  --command="${INNER_SCRIPT}" \
  "${CAST_PATH}"

echo
echo "✓ wrote ${CAST_PATH}"
