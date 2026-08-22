#!/usr/bin/env bash
# Odpala tunel Cloudflare (publiczny link dla znajomych). Działa na pierwszym planie —
# zobaczysz link, a Ctrl+C go zamyka. Wcześniej ubija stary tunel, żeby nie było dwóch.
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1
echo "Za chwilę pojawi się link https://...trycloudflare.com — to wyślij znajomym."
echo "Zostaw to okno otwarte podczas grania. Ctrl+C = koniec tunelu."
exec cloudflared tunnel --url http://localhost:8000
