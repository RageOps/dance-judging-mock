#!/bin/sh
set -eu

PORT="${PORT:-8080}"
sed "s/__PORT__/${PORT}/" /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

cd /app/server
node dist/db/migrate.js
node dist/db/seed.js

node dist/index.js &
API_PID=$!

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if wget -qO- "http://127.0.0.1:3001/api/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "API process exited before becoming healthy"
    exit 1
  fi
  sleep 1
done

if ! wget -qO- "http://127.0.0.1:3001/api/health" >/dev/null 2>&1; then
  echo "API health check failed"
  exit 1
fi

trap 'kill "$API_PID" 2>/dev/null || true' EXIT INT TERM
exec nginx -g 'daemon off;'
