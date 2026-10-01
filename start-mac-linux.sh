#!/usr/bin/env bash
# Installs everything and starts both servers. Needs Node.js 20+ (https://nodejs.org, LTS).
set -e
cd "$(dirname "$0")"
(cd backend && npm install && npm run start:dev) &
(cd frontend && npm install && npm run dev) &
echo "Open http://localhost:3000 when you see 'Ready'."
wait
