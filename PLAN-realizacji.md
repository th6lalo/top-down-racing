# Plan realizacji — cele z OCENA-zespolu.md

Źródło prawdy o postępie. Przerwana praca → zacznij od pierwszego nieodhaczonego.
Cel ukończony DOPIERO gdy spełnia kryterium — zmierzone. Jeden cel = jeden commit.

## Cel 1 — Harness obciążeniowy i pomiar przy 6–8 klientach ✅
Kryterium: ≥6 jednoczesnych klientów WS wysyła pozycje z realistyczną częstotliwością;
zmierzona mediana i p95 czasu rozgłaszania stanu + przepustowość; liczby w raporcie.
- [x] instrumentacja /perf za env RACES_PERF (commit b12a33f)
- [x] harness-obciazenie.py — N botów WS, pomiar dwustronny
- [x] N=2,4,6,8 zmierzone: broadcast p95 <2 ms przy 8, kB/s 120 — serwer nie jest wąskim gardłem

## Cel 2 — Pierwszy wyścig = wyścig, nie rysowanie + podpowiedź sterowania ✅
Kryterium: nowa sesja startuje od toru generowanego; rysowanie w kolejnych rundach;
podpowiedź na ekranie auta. Test serwera na kolejność rund.

## Cel 3 — Osobiste rekordy per tor ✅
Kryterium: serwer zapisuje najlepszy czas gracza (po kluczu) dla nazwy toru;
przy starcie gracz widzi swój rekord albo „nowy tor".

## Cel 4 — WSTRZYMANY na życzenie autora.

## Dziennik

- **Cel 1** (b12a33f): serwer p95 <2 ms przy 8 graczach. Localhost — nie tunel/telefon.
- **Cel 2** (caad1a7): świeża sesja od wyścigu; podpowiedź sterowania; 3 testy.
- **Cel 3** (aed16c5): rekordy per tor, 6 testów, 51 razem.
