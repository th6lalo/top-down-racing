"""Wspólna konfiguracja testów.

Najważniejsze: ustawiamy RACES_DB na plik tymczasowy ZANIM cokolwiek
zaimportuje `db` albo `server`. Bez tego testy pisałyby do prawdziwej bazy
z wynikami graczy.
"""
import os
import sys
import tempfile

KATALOG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KATALOG)

os.environ.setdefault("RACES_DB", os.path.join(tempfile.gettempdir(), "races-test.db"))

# Świeża, pusta baza testowa przy każdym uruchomieniu + utworzenie schematu.
# Bez tego testy tykające tabele (rekordy) padały na braku schematu, a stara
# zawartość mogła fałszować wyniki.
_p = os.environ["RACES_DB"]
if os.path.exists(_p):
    os.remove(_p)
import db
db.init()
