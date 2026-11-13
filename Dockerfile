# Portable image for Fly.io (or a Render Docker service). Node 24 for node:sqlite.
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# better-sqlite3 is optional; if the prebuilt binary is unavailable the ledger falls back to node:sqlite.
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
