# syntax=docker/dockerfile:1

# ---- build stage: install deps (compiles better-sqlite3) and build the app ----
FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime stage: slim image, production deps only ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Runtime needs: the built server (build/), the pruned node_modules (which still
# holds the compiled better-sqlite3 + drizzle-orm + dotenv + web-push), the
# migrations folder, the migrate + secret scripts, and package.json.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

# The SQLite DB lives on the mounted /data volume (via DATABASE_URL in .env), and
# .env (ORIGIN + secrets) is bind-mounted at /app/.env. On start: apply any pending
# migrations (migrate.js loads .env itself), then run the server with .env loaded
# into the environment. `exec` hands signals to node for clean shutdown.
CMD ["sh", "-c", "node scripts/migrate.js && exec node -r dotenv/config build"]
