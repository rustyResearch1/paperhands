FROM node:20-slim

RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @paperhands/web build

ENV NODE_ENV=production
# Mount a Railway volume at /data — the ledger lives there.
ENV PAPERHANDS_DB=/data/paperhands.sqlite
EXPOSE 3000
CMD ["bash", "deploy/start.sh"]
