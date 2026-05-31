# syntax=docker/dockerfile:1.7

# ---- Stage 1: build the SPA ----
FROM node:20-alpine AS web-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Shared brand assets (logo.svg, logo-dark.svg) live at the repo
# root and are imported by web/src/App.tsx via `../../assets/*`.
# Mirror them into the builder so Vite resolves the import.
COPY assets/ /app/assets/
RUN npm run build


# ---- Stage 2: Python runtime serving API + built SPA ----
FROM python:3.12-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.5.14 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

# Install dependencies first (cached layer).
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --extra api --no-dev --no-install-project --frozen

# Install the project itself. README.md is required because pyproject.toml
# declares it as the package readme — hatchling validates it at build time.
COPY src/ ./src/
COPY README.md ./
# CHANGELOG.md backs GET /api/v1/changelog (release notes for the web
# surfaces). Read at runtime from the repo root, so it must ship in the image.
COPY CHANGELOG.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --extra api --no-dev --frozen

# Bake a warmed set-image cache into the image so the deployed service starts
# hot. Render's free plan has no persistent disk, so without this every cold
# start (deploy or post-idle spin-up) pays the full image-download cost on
# the first set lookup. The warm pass walks pokemontcg.io's set catalog
# (~200 sets) and persists each logo+symbol — ~20 MB total on disk.
#
# `POKEMONTCG_IO_API_KEY` is passed in as a build arg (Render reads it from
# the service's envVars). When unset (e.g. a local `docker build` with no
# key), the warm step is skipped cleanly so the image still builds — it just
# starts with a cold cache.
#
# The warm step is best-effort: `warm-sets` already retries transient
# pokemontcg.io timeouts, but a sustained upstream outage would still exit
# non-zero. A cold cache is an acceptable degraded state (see the no-key
# branch below), so trap that exit with `|| echo` rather than letting a
# flaky API fail the whole deploy.
#
# Sits before `COPY api/` and `COPY --from=web-builder` so layer caching
# isn't invalidated by every api/ or web/ change — only by src/ or deps.
ARG POKEMONTCG_IO_API_KEY=""
ENV XDG_CACHE_HOME=/app/.cache
RUN if [ -n "$POKEMONTCG_IO_API_KEY" ]; then \
        POKEMONTCG_IO_API_KEY="$POKEMONTCG_IO_API_KEY" \
            uv run pkmn cache warm-sets \
            || echo "cache warm failed (pokemontcg.io unreachable?); image will start with a cold cache"; \
    else \
        echo "POKEMONTCG_IO_API_KEY not set at build time; skipping cache warm (image will start with a cold cache)"; \
    fi

# Copy API code and the built SPA from stage 1.
COPY api/ ./api/
COPY --from=web-builder /app/web/dist ./web/dist

# Render injects $PORT; default to 8000 for local docker run.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
