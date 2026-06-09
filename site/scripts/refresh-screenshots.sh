#!/usr/bin/env bash
# Re-render site/public/screenshots/{cards-xlsx,binder-page,checklist-page}.webp
# from the tracked sample outputs in `output/`.
#
# Why this exists
# ---------------
# The marketing site's "What you get" gallery shows three real
# deliverables: the .xlsx workbook, one binder PDF page, and one
# checklist PDF page. Regenerating them as renders of the *actual*
# tracked outputs keeps the gallery honest — drift between what the
# tool produces and what the site shows is now a diff in this script's
# inputs, not a forgotten manual screenshot.
#
# Pipeline
# --------
# - **PDFs** (binder, checklist): pdftoppm renders page 1 to a PNG;
#   cwebp re-encodes at quality 82.
# - **xlsx**: rendered by render_xlsx_preview.py, which composes a
#   spreadsheet-style preview directly from output/summary.json plus
#   the thumbnails in output/images/. LibreOffice headless can't render
#   the embedded card-image references the xlsx writer uses, so a
#   custom composer is the cleanest faithful path.
#
# Requirements
# ------------
# - poppler / pdftoppm (`brew install poppler`) — renders one PDF page
#   to PNG.
# - cwebp (`brew install webp`) — re-encodes PNGs to WebP for ~10x
#   smaller payload at marketing-quality. Lighthouse cares.
# - uv (`brew install uv`) — runs the xlsx renderer in the project's
#   Python environment (Pillow is already a transitive dep).
#
# Usage
# -----
#   ./site/scripts/refresh-screenshots.sh
#
# Outputs land in site/public/screenshots/. Commit the diff if non-empty.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/site/public/screenshots"
WORK_DIR="$(mktemp -d -t mgz-shots-XXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT

mkdir -p "${OUT_DIR}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing tool: $1 ($2)" >&2
    exit 1
  fi
}

need pdftoppm "brew install poppler"
need cwebp "brew install webp"
need uv "brew install uv"

# Render one PDF page to a single PNG file in WORK_DIR.
# Arguments: <pdf> <page-number> <basename>
#
# `-singlefile` suppresses pdftoppm's page-number suffix so we get a
# stable `<name>.png` regardless of how many pages the source has.
render_pdf_page() {
  local pdf="$1" page="$2" name="$3"
  pdftoppm -png -r 150 -singlefile -f "${page}" -l "${page}" \
    "${pdf}" "${WORK_DIR}/${name}"
}

# Convert + downscale a PNG → WebP at marketing-quality.
# Arguments: <png-name-in-WORK_DIR> <out-basename>
to_webp() {
  local png_name="$1" out_name="$2"
  # 1000px wide is ~2x retina at the gallery cards' render size. The binder
  # page is photo-dense (a 3x3 grid of card scans), so quality 76 at this
  # width keeps it inside the landing page's ~40-80 KB Lighthouse budget;
  # the text-only checklist lands far smaller at the same settings.
  cwebp -q 76 -resize 1000 0 \
    "${WORK_DIR}/${png_name}.png" \
    -o "${OUT_DIR}/${out_name}.webp" \
    >/dev/null
  echo "  ✓ ${out_name}.webp"
}

echo "→ Rendering binder PDF page"
render_pdf_page "${REPO_ROOT}/output/binder.pdf" 1 binder
to_webp binder binder-page

echo "→ Rendering checklist PDF page"
render_pdf_page "${REPO_ROOT}/output/checklist.pdf" 1 checklist
to_webp checklist checklist-page

echo "→ Composing xlsx preview (openpyxl + Pillow)"
# Custom composer (see render_xlsx_preview.py) — writes the .webp
# directly, so no PDF intermediate or cwebp pass for this one.
(cd "${REPO_ROOT}" && uv run python3 site/scripts/render_xlsx_preview.py)

echo
echo "✓ wrote ${OUT_DIR}/{binder-page,checklist-page,cards-xlsx}.webp"
