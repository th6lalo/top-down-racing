#!/usr/bin/env bash
# Uruchamia DOKŁADNIE JEDEN serwer gry (bez --reload).
# Najpierw ubija stare instancje, żeby nigdy się nie nazbierały i nie zamuliły laptopa.
cd "$(dirname "$0")" || exit 1

pkill -f "uvicorn server:app" 2>/dev/null
sleep 1

nohup ./.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000 > server.log 2>&1 &
disown
# Czekamy AŻ port zacznie nasłuchiwać, zamiast sprawdzać raz po sztywnych 4 s.
# Start bywa wolniejszy (serwer generuje zawczasu pulę torów), przez co skrypt
# potrafił skłamać "serwer nie wstał", choć wstawał sekundę później.
for _ in $(seq 1 20); do
  lsof -iTCP:8000 -sTCP:LISTEN -n >/dev/null 2>&1 && break
  sleep 1
done

if lsof -iTCP:8000 -sTCP:LISTEN -n >/dev/null 2>&1; then
  echo "✅ Serwer działa:  http://localhost:8000"
  echo "   (dla znajomych z internetu odpal osobno: ./tunnel.sh)"
else
  echo "❌ Serwer nie wstał — koniec server.log:"; tail -n 15 server.log
fi
