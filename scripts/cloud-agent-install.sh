#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [[ ! -d node_modules || ! -f packages/web/node_modules/better-auth/package.json || ! -f packages/server/node_modules/better-auth/package.json ]]; then
  npm ci
fi

npm install --no-save --no-package-lock \
  @tailwindcss/oxide-linux-x64-gnu@4.3.2 \
  lightningcss-linux-x64-gnu@1.32.0

npm run build -w @zentofact/falabella-api
npm run build -w @zentofact/core
npm run build -w @zentofact/ripley-api

echo "cloud-agent-install=ok"
