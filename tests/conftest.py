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
