# mgz-pkmn — developer-facing convenience targets.
#
# `make help` prints the full list. Targets that need network or running
# servers are grouped at the bottom. POSIX sh, no GNU-make-isms beyond
# .PHONY and a single .DEFAULT_GOAL.

.DEFAULT_GOAL := help

# Path to a sample input list used by the `run-sample` smoke target. Override
# at the command line: `make run-sample INPUT=input/calvins-cards.txt`.
INPUT ?= sample_cards.txt
OUTPUT_DIR ?= output
PORT_API ?= 8000

# Paths the python tooling operates on, kept in one place so tweaks (adding a
# new top-level package, etc.) only land in one spot.
PY_PATHS := src/ tests/ api/

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

.PHONY: help
help:  ## Print this help. Default when `make` is run with no target.
	@printf '\nUsage: make <target>\n\nTargets:\n'
	@awk 'BEGIN {FS = ":.*## "} \
		/^[a-zA-Z0-9_-]+:.*## / { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 } \
		/^## / { printf "\n\033[1m%s\033[0m\n", substr($$0, 4) }' $(MAKEFILE_LIST)
	@printf '\n'

## Setup

.PHONY: install
install: install-api install-web install-hooks  ## Full dev setup: API + web + pre-commit hook.
	@echo "✓ install complete — try \`make dev-api\` and \`make dev-web\` next."

.PHONY: install-cli
install-cli:  ## CLI dependencies only (no API, no web). Fastest install.
	uv sync

.PHONY: install-api
install-api:  ## CLI + API dependencies (`uv sync --extra api`).
	uv sync --extra api

.PHONY: install-web
install-web:  ## Web frontend dependencies (`npm install` in web/).
	cd web && npm install

.PHONY: install-site
install-site:  ## Marketing site dependencies (`npm install` in site/).
	cd site && npm install

.PHONY: install-hooks
install-hooks:  ## Install pre-commit as a uv tool and register the git hooks (pre-commit + commit-msg).
	uv tool install pre-commit
	uv tool run pre-commit install
	uv tool run pre-commit install --hook-type commit-msg

## Dev servers

.PHONY: dev
dev: docker-build  ## Rebuild the Docker image and run it on :8000 (API + built SPA in one container). No hot reload — use `dev-api` + `dev-web` for the inner edit/reload loop.
	docker run --rm -e POKEMONTCG_IO_API_KEY -p $(PORT_API):8000 mgz-pkmn

.PHONY: dev-api
dev-api:  ## Start the FastAPI dev server with reload on :8000 (override: PORT_API=).
	uv run uvicorn api.main:app --reload --port $(PORT_API)

.PHONY: dev-web
dev-web:  ## Start the Vite dev server on :5173 (proxies /api to :8000).
	cd web && npm run dev

.PHONY: dev-site
dev-site:  ## Start the Astro dev server on :4321 for the marketing site.
	cd site && npm run dev

## Test, lint, format

.PHONY: test
test:  ## Run the Python test suite.
	uv run python -m unittest discover -s tests

.PHONY: lint
lint: lint-py lint-web  ## Lint everything (Python ruff + web ESLint).

.PHONY: lint-py
lint-py:  ## Run ruff lint over Python sources.
	uv run ruff check $(PY_PATHS)

.PHONY: lint-web
lint-web:  ## Run ESLint over the web frontend.
	cd web && npm run lint

.PHONY: format
format:  ## Apply ruff formatting in-place.
	uv run ruff format $(PY_PATHS)

.PHONY: format-check
format-check:  ## Verify formatting without modifying files (CI mode).
	uv run ruff format --check $(PY_PATHS)

.PHONY: fix
fix:  ## Auto-fix safe ruff issues + reformat.
	uv run ruff check --fix $(PY_PATHS)
	uv run ruff format $(PY_PATHS)

.PHONY: check
check: lint-py format-check test lint-web  ## CI-equivalent: lint + format-check + tests + web lint.

.PHONY: precommit
precommit:  ## Run all pre-commit hooks against every file in the repo.
	uv tool run pre-commit run --all-files

## Build

.PHONY: build-web
build-web:  ## Type-check and bundle the web frontend into web/dist/.
	cd web && npm run build

.PHONY: build-site
build-site:  ## Build the static marketing site into site/dist/.
	cd site && npm run build

.PHONY: docker-build
docker-build:  ## Build the single-image Docker artifact (API + built SPA).
	docker build -t mgz-pkmn .

.PHONY: docker-run
docker-run:  ## Run the Docker image on :8000. Reads POKEMONTCG_IO_API_KEY from the env.
	docker run --rm -e POKEMONTCG_IO_API_KEY -p $(PORT_API):8000 mgz-pkmn

## CLI / cache

.PHONY: run-sample
run-sample:  ## Smoke-run the CLI on sample_cards.txt (override: INPUT=, OUTPUT_DIR=).
	@mkdir -p $(OUTPUT_DIR)
	uv run pkmn lookup $(INPUT) -o $(OUTPUT_DIR)/cards.xlsx --pdf $(OUTPUT_DIR)/binder.pdf --report-json $(OUTPUT_DIR)/summary.json

.PHONY: refresh-examples
refresh-examples:  ## Regenerate all tracked output/ examples from sample_cards.txt. Run before tagging a release (requires network).
	@mkdir -p $(OUTPUT_DIR)
	uv run pkmn lookup $(INPUT) \
	  -o $(OUTPUT_DIR)/cards.xlsx \
	  --pdf $(OUTPUT_DIR)/binder.pdf \
	  --condensed-pdf $(OUTPUT_DIR)/binder-condensed.pdf \
	  --checklist $(OUTPUT_DIR)/checklist.pdf \
	  --report-json $(OUTPUT_DIR)/summary.json

.PHONY: cache-clear
cache-clear:  ## Wipe the on-disk cache (~/.cache/mgz-pkmn) — including URL overrides.
	rm -rf $${XDG_CACHE_HOME:-$$HOME/.cache}/mgz-pkmn
	@echo "✓ cleared $${XDG_CACHE_HOME:-$$HOME/.cache}/mgz-pkmn"

## Cleanup

.PHONY: clean
clean:  ## Remove build artifacts and installed dependencies (.venv, node_modules, dist).
	rm -rf .venv web/node_modules web/dist site/node_modules site/dist site/.astro .ruff_cache
	find . -type d -name '__pycache__' -prune -exec rm -rf {} +
	@echo "✓ removed .venv, web/node_modules, web/dist, site/node_modules, site/dist, site/.astro, .ruff_cache, __pycache__"
