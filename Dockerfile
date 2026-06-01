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

# Note: the previous Dockerfile baked a warmed set-image cache into the
# image with a build-time `pkmn cache warm-sets` step. That made sense when
# Render's free tier reset the writable filesystem on every redeploy. With
# the persistent disk allocated in #369 (mounted at `/var/cache`, with
# `XDG_CACHE_HOME=/var/cache` in render.yaml's envVars), set logos and
# symbols are now warmed at runtime by the lifespan bootstrap in
# `api.main._warm_sets_in_background` onto durable storage — a single warm
# pass after the first deploy serves every subsequent deploy until the
# `sets_warm.json` manifest's TTL (1 week) expires. Image is ~20 MB smaller
# and builds ~30 s faster as a result.

# Copy API code and the built SPA from stage 1.
COPY api/ ./api/
COPY --from=web-builder /app/web/dist ./web/dist

# Render injects $PORT; default to 8000 for local docker run.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
