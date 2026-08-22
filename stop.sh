#!/usr/bin/env bash
# Zatrzymuje WSZYSTKO związane z grą (serwer + tunel). Bezpieczne do odpalenia w każdej chwili.
pkill -f "uvicorn server:app" 2>/dev/null && echo "🛑 serwer zatrzymany" || echo "· serwer i tak nie działał"
pkill -f "cloudflared tunnel" 2>/dev/null && echo "🛑 tunel zatrzymany"  || echo "· tunel i tak nie działał"
