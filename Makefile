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

.PHONY: uninstall
uninstall:  ## Remove the local Python venv and uninstall the pre-commit git hooks. Use `make clean` for the broader nuke (also removes web/node_modules, site/node_modules, build artifacts). Leaves the user cache ($XDG_CACHE_HOME/mgz-pkmn, default ~/.cache/mgz-pkmn) alone — wipe that with `pkmn cache clear`.
	uv tool run pre-commit uninstall --hook-type commit-msg >/dev/null 2>&1 || true
	uv tool run pre-commit uninstall >/dev/null 2>&1 || true
	rm -rf .venv
	@echo "✓ removed .venv and uninstalled pre-commit git hooks"

## Dev servers

.PHONY: dev
dev: docker-build  ## Rebuild the Docker image and run it on :8000 (API + built SPA in one container). No hot reload — use `dev-api` + `dev-web` for the inner edit/reload loop.
	@$(MAKE) -s docker-run

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

.PHONY: e2e
e2e:  ## Run the Playwright end-to-end suite — builds the SPA, then boots the API (auth off, throwaway DB) and drives a real browser. First run downloads the browser.
	cd web && npm run build && npx playwright install chromium && npm run e2e

.PHONY: coverage
coverage:  ## Run the Python test suite under coverage; emit terminal report + coverage.xml + junit.xml + htmlcov/.
	uv run coverage run -m pytest tests/ --junitxml=junit.xml -o junit_family=legacy
	uv run coverage report
	uv run coverage xml
	uv run coverage html
	@echo "✓ HTML report: htmlcov/index.html"

.PHONY: lint
lint: lint-py lint-web lint-design  ## Lint everything (Python ruff + web ESLint + design oxlint).

.PHONY: lint-py
lint-py:  ## Run ruff lint over Python sources.
	uv run ruff check $(PY_PATHS)

.PHONY: lint-web
lint-web:  ## Run ESLint over the web frontend.
	cd web && npm run lint

.PHONY: lint-design
lint-design:  ## Run oxlint with the design-system adherence config over web/ and site/ sources.
	web/node_modules/.bin/oxlint -c .oxlintrc.json site/src web/src

.PHONY: test-site
test-site:  ## Run the marketing-site regression tests (node:test, no deps).
	cd site && npm test

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

# The radon complexity gate has no allowlist. Epic #551 cleared every
# pre-existing offender, so as of #670 every file in `src/` and `api/` clears the
# D-rank cyclomatic and B-rank maintainability bars with no exceptions. A new D+
# function or B+ file must be refactored — there is deliberately no knob to
# exclude it. See issue #387 (gate) / epic #551 (cleanup) / issue #670 (this).
.PHONY: complexity
complexity:  ## Maintainability gate: fail on D+ cyclomatic complexity or B+ maintainability index.
	@out=$$(uv run radon cc src/ api/ -n D) \
	  || { echo "✗ radon cc invocation failed (uv / radon could not run)" >&2; exit 1; }; \
	  if [ -n "$$out" ]; then \
	    echo "$$out" >&2; \
	    echo >&2; \
	    echo "✗ Cyclomatic complexity gate failed: D-rank or worse function above." >&2; \
	    echo "  Refactor it — the gate has no allowlist (every file in src/ and api/ clears the bar)." >&2; \
	    exit 1; \
	  fi
	@out=$$(uv run radon mi src/ api/ -n B) \
	  || { echo "✗ radon mi invocation failed (uv / radon could not run)" >&2; exit 1; }; \
	  if [ -n "$$out" ]; then \
	    echo "$$out" >&2; \
	    echo >&2; \
	    echo "✗ Maintainability index gate failed: B-rank or worse file above." >&2; \
	    echo "  Refactor it — the gate has no allowlist (every file in src/ and api/ clears the bar)." >&2; \
	    exit 1; \
	  fi
	@echo "✓ complexity gate passed"

.PHONY: check
check: lint-py format-check complexity test lint-web lint-design test-site  ## CI-equivalent: lint + format-check + complexity gate + tests + web lint + design lint + site regressions.

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

.PHONY: refresh-gallery
refresh-gallery: refresh-examples  ## Regenerate output/ examples AND the marketing-site gallery thumbnails in one pass (requires network + poppler/webp/uv). Commit the diff.
	./site/scripts/refresh-screenshots.sh

.PHONY: cache-clear
cache-clear:  ## Wipe the on-disk cache (~/.cache/mgz-pkmn) — including URL overrides.
	rm -rf $${XDG_CACHE_HOME:-$$HOME/.cache}/mgz-pkmn
	@echo "✓ cleared $${XDG_CACHE_HOME:-$$HOME/.cache}/mgz-pkmn"

.PHONY: migrate
migrate:  ## Apply pending Alembic migrations against the configured DB (MGZ_PKMN_DATABASE_URL or the SQLite default).
	uv run alembic -c api/alembic.ini upgrade head

## Cleanup

.PHONY: clean
clean:  ## Remove build artifacts and installed dependencies (.venv, node_modules, dist).
	rm -rf .venv web/node_modules web/dist site/node_modules site/dist site/.astro .ruff_cache .coverage coverage.xml htmlcov junit.xml
	find . -type d -name '__pycache__' -prune -exec rm -rf {} +
	@echo "✓ removed .venv, web/node_modules, web/dist, site/node_modules, site/dist, site/.astro, .ruff_cache, .coverage, coverage.xml, htmlcov, junit.xml, __pycache__"
