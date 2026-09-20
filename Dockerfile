FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/browser-client/package.json apps/browser-client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/events/package.json packages/events/package.json
COPY packages/log/package.json packages/log/package.json
COPY packages/schemas/package.json packages/schemas/package.json
RUN npm ci

COPY . .
RUN npm run build -w @astronote/db \
 && npm run build -w @astronote/server \
 && npm run build -w @astronote/browser-client \
 && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3001
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /app/apps/browser-client/dist ./apps/browser-client/dist
COPY --from=build --chown=node:node /app/packages/db/dist ./packages/db/dist
COPY --from=build --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /app/packages/db/package.json ./packages/db/package.json

USER node
EXPOSE 3001
CMD ["sh", "-c", "node packages/db/dist/migrate.js && exec node apps/server/dist/index.js"]
