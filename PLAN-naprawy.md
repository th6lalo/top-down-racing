# Plan naprawy — postęp prac

Ten plik jest **źródłem prawdy o postępie**. Jeśli praca zostanie przerwana,
zacznij od pierwszego niezaznaczonego punktu. Po każdym ukończonym etapie
odhaczam pozycje i dopisuję, co zostało zweryfikowane.

Zasada: **każdy etap kończy się działającą grą**. Żadnego zostawiania w połowie.

---

## Etap 1 — bezpieczeństwo i higiena repozytorium ⏳
- [ ] Załatać SSRF w `/proxy_audio` (raport: krytyczne)
- [ ] Dodać `LICENSE` (MIT)
- [ ] Dodać `.gitignore`
- [ ] `git init` + pierwszy commit
- [ ] Sprawdzić, że gra nadal działa

## Etap 2 — serwer przestaje wierzyć klientowi ⏳
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
