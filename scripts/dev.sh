#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required for the default dev database. Install Docker or set DATABASE_URL." >&2
    exit 1
  fi
  docker compose -f docker-compose.dev.yml up -d --wait
  db_address=$(docker compose -f docker-compose.dev.yml port db 5432)
  db_port=${db_address##*:}
  export DATABASE_URL="postgres://astronote:astronote-dev@127.0.0.1:${db_port}/astronote"
fi

npm run migrate -w @astronote/db
npm run build -w @astronote/browser-client
exec npm run dev -w @astronote/server
