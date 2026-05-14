# syntax=docker/dockerfile:1.7

# ---- Stage 1: build the SPA ----
FROM node:20-alpine AS web-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
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
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --extra api --no-dev --frozen

# Copy API code and the built SPA from stage 1.
COPY api/ ./api/
COPY --from=web-builder /app/web/dist ./web/dist

# Render injects $PORT; default to 8000 for local docker run.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
