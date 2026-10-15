FROM node:24.21.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:24.21.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules/
COPY --from=build --chown=node:node /app/dist ./dist/
# The geo current refresh reads the reviewed view SQL, so the copy and the view cannot drift.
COPY --chown=node:node sql/002_core_views.sql ./sql/
USER node
CMD ["node", "dist/src/jobs/ingest.js"]
