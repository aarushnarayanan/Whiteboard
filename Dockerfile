FROM node:22-alpine

WORKDIR /app

# Install first, from just the manifests, so this layer caches across builds
# where only source files changed.
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

# Applying migrations is safe to run on every boot — the migrator tracks
# which ones already ran and skips them, so this stays a no-op once the
# schema is current. This is what actually creates the tables on a fresh
# database the first time this deploys.
CMD ["sh", "-c", "node server/dist/db/migrate.js && node server/dist/index.js"]
