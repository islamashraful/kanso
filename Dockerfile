# Bun runs TypeScript directly, so there is no separate compile stage — the
# stages below exist only to keep the Prisma CLI (a devDependency, needed
# only to generate the client) out of the image that actually runs.

# ---- deps: every dependency, including dev, so `prisma generate` can run ----
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- build: the generated Prisma client, against the real schema ----
FROM deps AS build
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN bunx --bun prisma generate

# ---- runtime: production dependencies only, plus the generated client and
# source carried over from the stages above ----
FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# tsconfig.json is not dead weight here: Bun reads its `paths` entry to
# resolve every `@/...` import at runtime, the same as it does in dev.
COPY tsconfig.json ./
COPY --from=build /app/src/generated ./src/generated
COPY src ./src

EXPOSE 3000

# Liveness only (docs/architecture.md's Health checks section): this never
# touches Postgres or Redis, so a dependency outage does not make Docker
# report the container itself as unhealthy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Runs the API by default. The worker process (`src/worker.ts`) is the same
# image with its command overridden at deploy time — nothing about it needs a
# separate build.
CMD ["bun", "src/server.ts"]
