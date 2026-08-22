# Plan naprawy — postęp prac

Ten plik jest **źródłem prawdy o postępie**. Jeśli praca zostanie przerwana,
zacznij od pierwszego niezaznaczonego punktu. Po każdym ukończonym etapie
odhaczam pozycje i dopisuję, co zostało zweryfikowane.

Zasada: **każdy etap kończy się działającą grą**. Żadnego zostawiania w połowie.

---

## Etap 1 — bezpieczeństwo i higiena repozytorium ✅
- [x] Załatać SSRF w `/proxy_audio` — adres rozwiązywany przed pobraniem, sieci
      prywatne odrzucane, przekierowania zablokowane, komunikaty ujednolicone
- [x] Dodać `LICENSE` (MIT + wzmianka o CC0 Kenneya)
- [x] Dodać `.gitignore` (bez `.venv` 37 MB i `races.db` 7 MB)
- [x] `git init` + pierwszy commit (`5b1e018`, 32 pliki)
- [x] Gra działa — localhost i tunel HTTP 200, poprawka wdrożona na żywym serwerze

**Zweryfikowane:** pięć sond SSRF (localhost, port zamknięty, router, `localhost`,
metadata 169.254) zwraca teraz IDENTYCZNY komunikat. Adresy publiczne
(example.com, kenney.nl) przechodzą walidację — funkcja nie została zepsuta.

## Etap 2 — serwer przestaje wierzyć klientowi ✅
- [x] `isfinite` + ograniczenie pozycji do rozmiaru mapy (#3)
- [x] Meta weryfikowana po stronie serwera (#2)
- [x] Utwardzone parsowanie punktów mapy + obcięcie PRZED konwersją (#7, #8)
- [x] Test dowodzący, że oszust już nie wygrywa

**Zweryfikowane** tym samym testem co w raporcie:
| | przed | po |
|---|---|---|
| serwer uznał metę | tak | **nie** |
| zwycięzca | „Oszust" | brak |
| w bazie | `('Oszust', 1, 0.33)` | **0 wierszy** |
| `NaN` w pakiecie stanu | `nan` | **nie przeszło** |
| 5 śmieciowych wejść mapy | 5 wyjątków | **0 wyjątków** |
| milion punktów | milion konwersji | 400 punktów w 0,1 ms |

## Etap 3 — limity, ruch sieciowy, baza ✅
- [x] Limity tempa i rozmiaru komunikatów (#4) — 150 tekstowych i 120 binarnych/s,
      64 KB tekst, 8 KB ramka głosu; uporczywy nadmiar = rozłączenie
- [x] Dane stałe wyjęte z pakietu stanu do komunikatu `roster` (#5)
- [x] Archiwum torów losowych przycięte do 50 (#6)
- [x] Pomiar przed/po

**Zmierzone:**
| | przed | po |
|---|---|---|
| pakiet stanu, 8 graczy | 1150 B | **550 B** |
| ruch wychodzący, 8 graczy | 269,5 kB/s | **128,9 kB/s** (−52%) |
| plik bazy | 6,12 MB | **3,80 MB** (−38%) |
| pola w pakiecie stanu | 9 | 5 (`id,x,y,angle,level`) |

Uwaga: raport przewidywał −60% ruchu, ale ta liczba zakładała też skrócenie
nazw pól. Nie zrobiłem tego — kod byłby mniej czytelny. Zmierzone: −52%.
Wyniki (298) i tory rysowane (89) nietknięte, kopia `races.db.backup-etap3-1918`.

## Etap 4 — testy i CI ✅
- [x] `pytest` + 10 testów walidatorów torów
- [x] 32 testy walidacji wejścia z Etapu 2
- [x] GitHub Actions (Python 3.11 i 3.13)

**Zweryfikowane:** `pytest tests/ -v` → **42 passed**. `conftest.py` przekierowuje
`RACES_DB` na plik tymczasowy przed importem, więc testy nie tykają prawdziwej bazy.
**Nie sprawdziłem:** czy workflow faktycznie przechodzi na GitHubie — nie ma
jeszcze zdalnego repozytorium.

## Etap 5 — README 👈 NASTĘPNY
- [ ] README z architekturą, tabelą przed/po, opisem walidatorów

## Etap 6 — podział `game.js` (duży, opcjonalny) ⏳
- [ ] net.js / physics.js / render.js / audio.js / ui.js

---

## Dziennik
(uzupełniany na bieżąco)

- **Etap 1** zamknięty. SSRF był realny — potwierdzony trzema sygnałami, teraz jednym.
- **Etap 2** zamknięty. Ranking przestał być fikcją.
- **Etap 3** zamknięty. Ruch sieciowy o połowę mniejszy, baza o 38%.
- **Etap 4** zamknięty. 42 testy, w tym regresje wszystkich napraw z Etapu 2.
