#!/usr/bin/env bash
# One-box deploy: the indexer (discover + watch + tails) and the web
# terminal share the SQLite ledger on the mounted volume. If either dies,
# exit nonzero so the platform restarts the pair together.
set -m

cd /app/packages/indexer
node_modules/.bin/tsx src/main.ts serve &
INDEXER=$!

cd /app/apps/web
node_modules/.bin/next start -p "${PORT:-3000}" &
WEB=$!

wait -n "$INDEXER" "$WEB"
echo "a process exited — restarting the pair" >&2
exit 1
