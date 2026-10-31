#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../app"
npm ci --no-audit --no-fund
npm run verify
