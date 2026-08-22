#!/usr/bin/env bash
# Nazwany tunel Cloudflare = STAŁY adres gry (w odróżnieniu od tunnel.sh,
# który losuje nowy adres przy każdym uruchomieniu).
#
# JEDNORAZOWA KONFIGURACJA (robisz raz, w tej kolejności):
#   1. Kup domenę i dodaj ją do swojego konta Cloudflare (to musisz zrobić Ty —
#      zakup i zakładanie konta to nie są rzeczy, które może za Ciebie zrobić Claude).
#   2. cloudflared tunnel login            # otworzy przeglądarkę, wybierz swoją domenę
#   3. cloudflared tunnel create wyscigi   # tworzy tunel o nazwie „wyscigi"
#   4. cloudflared tunnel route dns wyscigi gra.TWOJA-DOMENA.pl
#   5. wpisz swój adres w zmiennej ADRES poniżej
#
# Potem codziennie wystarczy: ./run.sh && ./tunnel-staly.sh
cd "$(dirname "$0")" || exit 1

ADRES="gra.TWOJA-DOMENA.pl"      # <<< ZMIEŃ na swój adres
TUNEL="wyscigi"

if [ "$ADRES" = "gra.TWOJA-DOMENA.pl" ]; then
  echo "❌ Najpierw wpisz swój adres w zmiennej ADRES w tym pliku."
  echo "   Instrukcja krok po kroku jest w komentarzu na górze pliku."
  exit 1
fi

if ! cloudflared tunnel list 2>/dev/null | grep -q "$TUNEL"; then
  echo "❌ Nie widzę tunelu „$TUNEL”. Zrób najpierw kroki 2-4 z komentarza na górze."
  exit 1
fi

pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

if ! lsof -iTCP:8000 -sTCP:LISTEN -n >/dev/null 2>&1; then
  echo "⚠️  Serwer gry nie działa — odpal najpierw ./run.sh"
  exit 1
fi

echo "✅ Stały adres gry:  https://$ADRES"
echo "   Ten adres się NIE zmienia, więc możesz go raz zarejestrować u Google"
echo "   i wysłać znajomym na stałe. Ctrl+C kończy tunel."
exec cloudflared tunnel run --url http://localhost:8000 "$TUNEL"
