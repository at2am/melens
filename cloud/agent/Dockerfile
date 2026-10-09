# Build from the cloud/ context: `docker build -f agent/Dockerfile .` or agent/cloudbuild.yaml.
FROM node:24.21.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY map/package.json map/
COPY agent/package.json agent/
RUN npm ci --workspace agent
COPY shared/tsconfig.json shared/
COPY shared/src/ shared/src/
COPY agent/tsconfig.json agent/
COPY agent/src/ agent/src/
RUN npm run build --workspace agent && npm prune --omit=dev --workspace agent

FROM node:24.21.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules/
COPY --from=build --chown=node:node /app/shared/package.json ./shared/
COPY --from=build --chown=node:node /app/shared/dist ./shared/dist/
COPY --from=build --chown=node:node /app/agent/package.json ./agent/
COPY --from=build --chown=node:node /app/agent/dist ./agent/dist/
COPY --chown=node:node map/infra/dev-public-sources.json ./map/infra/dev-public-sources.json
USER node
EXPOSE 8080
CMD ["node", "agent/dist/src/main.js"]
