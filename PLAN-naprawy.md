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

## Etap 2 — serwer przestaje wierzyć klientowi 🔨 w toku
- [ ] `isfinite` + ograniczenie pozycji do rozmiaru mapy (raport: poważne #3)
- [ ] Meta weryfikowana po stronie serwera (raport: poważne #2)
- [ ] Utwardzić parsowanie punktów mapy + obciąć listę PRZED konwersją (#7, #8)
- [ ] Test dowodzący, że oszust już nie wygrywa

## Etap 3 — limity, ruch sieciowy, baza ⏳
- [ ] Ograniczenie tempa i rozmiaru komunikatów (#4)
- [ ] Wyrzucić stałe pola z pakietu stanu, −60% ruchu (#5)
- [ ] Sprzątanie starych torów w bazie (#6)
- [ ] Pomiar przed/po

## Etap 4 — testy i CI ⏳
- [ ] `pytest` + testy walidatorów torów
- [ ] Testy walidacji wejścia z Etapu 2
- [ ] GitHub Actions

## Etap 5 — README ⏳
- [ ] README z architekturą, tabelą przed/po, opisem walidatorów

## Etap 6 — podział `game.js` (duży, opcjonalny) ⏳
- [ ] net.js / physics.js / render.js / audio.js / ui.js

---

## Dziennik
(uzupełniany na bieżąco)

- **Etap 1** zamknięty. SSRF był realny — potwierdzony trzema sygnałami, teraz jednym.
