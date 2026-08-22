#!/usr/bin/env bash
# Uruchamia DOKŁADNIE JEDEN serwer gry (bez --reload).
# Najpierw ubija stare instancje, żeby nigdy się nie nazbierały i nie zamuliły laptopa.
cd "$(dirname "$0")" || exit 1

pkill -f "uvicorn server:app" 2>/dev/null
sleep 1

nohup ./.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000 > server.log 2>&1 &
disown
sleep 4

if lsof -iTCP:8000 -sTCP:LISTEN -n >/dev/null 2>&1; then
  echo "✅ Serwer działa:  http://localhost:8000"
  echo "   (dla znajomych z internetu odpal osobno: ./tunnel.sh)"
else
  echo "❌ Serwer nie wstał — koniec server.log:"; tail -n 15 server.log
fi
