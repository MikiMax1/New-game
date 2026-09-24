#!/usr/bin/env sh
# Starts Port Solmar on macOS / Linux: ./start-game.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org and run this again."
  exit 1
fi
[ -d node_modules ] || npm install || exit 1
echo "Starting Port Solmar at http://localhost:5173 (Ctrl+C to stop)"
npm run dev -- --open
