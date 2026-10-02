# syntax = docker/dockerfile:1

# Node + Express + Socket.io + node:sqlite (no native build step the SQLite
# driver needs — node:sqlite ships in the runtime). See PROCESS.md for why.
# Whatever your app is built with, the image must serve HTTP on
# 0.0.0.0:$PORT (fly.toml sets PORT) and publish README.md at /readme/
# (spec/README.md says what's checked).

FROM node:24.21.0-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.app.json ./
COPY src ./src
RUN pnpm build

FROM node:24.21.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY public ./public
COPY README.md ./README.md

ENV PORT=8080
ENV DB_PATH=/data/app.db
EXPOSE 8080
CMD ["node", "dist/server.js"]
