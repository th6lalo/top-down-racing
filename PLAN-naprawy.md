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

## Etap 5 — README ✅
- [x] README z architekturą, tabelą przed/po, opisem walidatorów

**Zweryfikowane:** każda ścieżka i komenda z README istnieje i działa.
Stary README opisywał grę sprzed wielu zmian (spacja jako gaz, widok 2D) —
wprowadzałby w błąd. **Brakuje zrzutów ekranu** — to jedyna rzecz, której
nie mogę zrobić za Janka sensownie; 2-3 obrazki bardzo wzmocniłyby README.

## Etap 6 — podział `game.js` ⏸️ ŚWIADOMIE ODŁOŻONY
- [ ] net.js / physics.js / render.js / audio.js / ui.js

**Dlaczego nie zrobione teraz — wynik analizy, nie brak czasu.**

Sprawdziłem granice bloku audio (najbardziej samodzielnego kandydata):
- nagłówek „===== Dźwięk silnika =====" w linii 1602 **kłamie** — zaraz po nim
  jest generator klucza gracza i `loadSettings`, nie audio. Ślepa ekstrakcja
  1602–2040 przeniosłaby wczytywanie ustawień do pliku audio i rozwaliła
  kolejność startu. Prawdziwy blok to 1658–2040.
- blok ma **37 odwołań do stanu gry**: `settings` ×14, `me` ×11, `othersById` ×3,
  `mode` ×3, `boosting` ×2, `bodyOf` ×2, `MAX_SPEED` ×2, `K` ×2, `DRIFT_MIN` ×2,
  `mySlip` ×1.

To odwrotna sytuacja niż przy `carart.js`, który nie potrzebował z gry prawie
niczego — i właśnie dlatego mógł go potem użyć `tuner.html`. Samo przeniesienie
linii dałoby zależność cykliczną i kruchą zależność od kolejności `<script>`,
czyli **plik mniejszy, ale nie rozprzęgnięty**.

**Jak to zrobić dobrze:** wprowadzić jawny interfejs — np. `updateEngines()`
przyjmuje obiekt stanu zamiast sięgać po globalne zmienne. To prawdziwa
refaktoryzacja obejmująca 37 miejsc, a nie przeniesienie pliku. Zasługuje na
własną sesję, przy wyłączonym tunelu, najlepiej po dopisaniu testów klienta
(dziś testy pokrywają tylko serwer).

**Ryzyko robienia tego teraz:** gra jest na żywo, grasz w nią ze znajomymi,
a po stronie klienta nie ma żadnych testów, które złapałyby regresję.

---

## Dziennik
(uzupełniany na bieżąco)

- **Etap 1** zamknięty. SSRF był realny — potwierdzony trzema sygnałami, teraz jednym.
- **Etap 2** zamknięty. Ranking przestał być fikcją.
- **Etap 3** zamknięty. Ruch sieciowy o połowę mniejszy, baza o 38%.
- **Etap 4** zamknięty. 42 testy, w tym regresje wszystkich napraw z Etapu 2.
- **Etap 5** zamknięty. README opisuje grę, która naprawdę istnieje.
- **Etap 6** odłożony świadomie: analiza pokazała, że tani podział byłby kosmetyką z zależnością cykliczną.
