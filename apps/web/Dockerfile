# NOTE: build context is the repo ROOT (see docker-compose.yml `context: .`),
# not apps/web — so COPY paths are repo-relative. This lets the build read the
# root VERSION file directly instead of depending on the caller passing
# --build-arg APP_VERSION. A root .dockerignore keeps the context small.
FROM node:20-alpine AS deps
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web/ ./
# APP_VERSION is optional. `make build` and CI pass it explicitly via
# --build-arg; a bare `docker compose build web` omits it and we fall back to
# the repo-root VERSION file. This prevents the image from being stamped with
# the 0.0.0 sentinel, which made the footer falsely show "rebuild available".
COPY VERSION /tmp/VERSION
ARG APP_VERSION=""
RUN APP_VERSION="${APP_VERSION:-$(cat /tmp/VERSION)}" && \
    NEXT_PUBLIC_APP_VERSION="$APP_VERSION" npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Standalone output bundles everything needed to run without node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
