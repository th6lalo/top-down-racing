# Wyścigi — następny etap: tory piętrowe (mosty), meta w środku, lobby z gotowością

## Kontekst (NIE pisz gry od zera)
Projekt już działa w `/Users/janek/Races`. Rozbudowujesz istniejący kod, nie zaczynasz od nowa
i nie zmieniasz stosu technologicznego.

- `server.py` — FastAPI + uvicorn, jeden WebSocket `/ws` (JSON = gra, ramki binarne = głos),
  fazy rundy: `drawing` / `racing`, rozsyłka stanu 30 Hz, spectator, rewanż.
- `track.py` — generator torów (labirynty + trasy z linii), `reachable()` sprawdza przejezdność BFS-em.
- `db.py` — SQLite (`races.db`): tabele `results` (wyniki) i `tracks` (archiwum torów).
- `static/game.js` + `static/index.html` — klient: Canvas 2D w stylu 2.5D (murki z cieniem, asfalt),
  fizyka z driftem (wektor prędkości), kolizje ze ścianami i auto-auto z masami karoserii,
  interpolacja ze snapshotów, dym, czat głosowy proximity (push-to-talk V), telemetria (F3).
- `./run.sh` / `./stop.sh` / `./tunnel.sh` — uruchamianie (JEDEN proces uvicorn, BEZ `--reload`).

Działające rzeczy, których nie wolno zepsuć: rysowanie trasy przez losowego gracza, naprzemienność
map, spectator, tabela wyników, dźwięk silnika, czat głosowy, telemetria, odliczanie 3-2-1,
boost zerowany na starcie, karoserie (sport/muscle/van/kart) z masą i osiągami.

## Cel 1 — Tory piętrowe (mosty) 2.5D
Dziś tor jest płaski, więc trasa nie może się przeciąć — to blokuje pętle i serpentyny.
Dodaj poziomy wysokości:

- Każdy segment toru i każda ściana dostaje `level` (0 = parter, 1 = most).
- Auto ma swój `level`. Kolizje ze ścianami liczą się TYLKO w obrębie tego samego poziomu.
- Najazd/zjazd (`ramp`) płynnie zmienia `level` auta, gdy je przejedzie.
- Render kolejnością poziomów: najpierw parter, potem cień mostu rzucany na parter, potem filary,
  potem jezdnia mostu. Most ma być czytelnie „nad" trasą (cień + wyraźna krawędź + filary).
- Auta rysowane razem ze swoim poziomem (auto na moście zasłania trasę pod spodem).
- Generator: gdy trasa chce przeciąć samą siebie, zamiast tego buduje most (rampa → przęsło → rampa).
  Dzięki temu pętle i serpentyny są przejezdne.

Kryteria odbioru: wygeneruj 20 torów z pętlami/serpentynami — wszystkie przejezdne wg
`reachable()` rozszerzonego o poziomy; auto nie zderza się ze ścianą trasy z innego poziomu.

## Cel 2 — Meta w środku, większe i różne rozmiary map
- META ma być w CENTRUM mapy (wyraźna, w szachownicę), a tor labiryntem prowadzącym do środka
  (spirala/labirynt zbiegający do centrum), nie sprintem z rogu do rogu.
- Rozmiary map: mała / średnia / duża (parametr generatora). Duża wyraźnie większa niż obecne 6800x3600.
- Czas przejazdu ma zostać w przedziale ~45–90 s — zweryfikuj symulacją jazdy po torze
  (taki skrypt był już używany w projekcie: autopilot z prawdziwą fizyką mierzy czas).
- Labirynty zostają jako główny klimat (są fajne), ale wzbogacone o mosty i metę w centrum.

## Cel 3 — Rysowanie trasy bez samo-nakładania
Gdy gracz rysuje serpentynę/zawijas, linia potrafi nałożyć się na siebie i tor staje się nieprzejezdny.
Wybierz JEDNO z dwóch (uzasadnij wybór) i zaimplementuj porządnie:
- (a) blokada: pędzel nie pozwala zbliżyć się do już narysowanej trasy (jest zalążek tego w kodzie),
      z czytelnym sygnałem wizualnym, że tu nie można rysować;
- (b) most automatyczny: przecięcie własnej linii tworzy most (spójne z Celem 1) — preferowane,
      jeśli Cel 1 już działa.
Kryterium odbioru: narysowana gęsta serpentyna i „ósemka" dają tor przejezdny wg `reachable()`.

## Cel 4 — Lobby z gotowością
Zamiast wpadać prosto do wyścigu:
1. Wejście linkiem → ekran wyboru: nick, karoseria, kolor auta, kolor dymu → „Dołącz".
2. Ekran LOBBY: lista wszystkich graczy — nick + miniatura JEGO karoserii w JEGO kolorze
   + status „Gotowy / Niegotowy". Aktualizowana na żywo (dołączenia i wyjścia).
3. Przycisk „Gotowy" (przełącznik) dla siebie.
4. Wyścig startuje dopiero, gdy WSZYSCY obecni klikną „Gotowy" (min. 1 gracz, żeby dało się testować solo).
5. Gdy ktoś dołączy w trakcie lobby — gotowości nie resetuj mu innym bez potrzeby, ale start ma czekać
   na nowego. Gdy ktoś wyjdzie — sprawdź warunek startu ponownie.
6. Po wyścigu wracamy do lobby (zamiast obecnego „Nowy wyścig"), gotowości wyzerowane.
7. Zachowaj obecną naprzemienność map (raz rysowana przez losowego gracza, raz generowana).

Protokół: dopisz wiadomości `lobby_state` (lista graczy + gotowości), `ready` (klient→serwer).
Zachowaj wsteczną zgodność z resztą protokołu.

## Twarde ograniczenia
- Wydajność: gra ma chodzić na słabym laptopie (~12–20 FPS u części graczy). Nie dokładaj ciężkiego
  renderu; korzystaj z istniejących optymalizacji (culling ścian, broad-phase kolizji, cache minimapy)
  i rozszerz je na nowe elementy (mosty!).
- Sieć: rozsyłka musi zostać nieblokująca (równoległa, z pomijaniem zaległych klatek) — nie cofaj tego.
- Uruchamianie: dokładnie JEDEN proces uvicorn, bez `--reload`, po testach sprzątaj procesy.
- Nie psuj istniejących funkcji wymienionych w Kontekście.
- Po każdej zmianie klienta podbij `game.js?v=N` w `index.html` (cache-busting).

## Jak masz pracować
1. Rozbij pracę na etapy (mosty → meta w centrum/rozmiary → rysowanie → lobby) i rób je po kolei,
   testując każdy, zamiast wrzucać wszystko naraz.
2. Testuj realnie, nie deklaratywnie:
   - generator: skrypty sprawdzające przejezdność i czas przejazdu na wielu losowych torach,
   - serwer: symulacja klientów przez websockets (lobby, gotowość, start, spectator),
   - klient: załaduj stronę i sprawdź konsolę — ZERO błędów; zrób zrzut ekranu i obejrzyj wynik.
3. Po każdym etapie napisz krótko: co zrobione, co zweryfikowane i CZEGO nie udało się sprawdzić.
4. Jeśli coś okaże się złym pomysłem (np. mosty rozwalą wydajność), powiedz to wprost
   i zaproponuj prostszą wersję zamiast udawać, że działa.
