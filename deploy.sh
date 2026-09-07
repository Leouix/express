#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "== git pull =="
git pull --ff-only origin main

echo "== web: build =="
docker run --rm -v "$(pwd)/web:/app" -w /app node:20-alpine \
  sh -c "npm install --no-audit --no-fund && npm run build"

echo "== server: recreate container =="
docker compose -f docker-compose.prod.yaml up -d --force-recreate

echo "== fix ownership of build artifacts =="
chown -R deploy:deploy server web

echo "== done =="