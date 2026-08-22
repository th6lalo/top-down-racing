# Wyścigi — etap: naprawa bugu, dźwięki (styl Forza), balans klas, karoserie 2.5D, ślady driftu

## Kontekst (NIE pisz gry od zera)
Projekt działa w `/Users/janek/Races`. Rozbudowujesz istniejący kod, nie zmieniasz stosu.

- `server.py` — FastAPI + uvicorn, jeden WebSocket `/ws` (JSON = gra, ramki binarne = głos).
  Fazy: `lobby` → `drawing` / `racing`. Lobby z gotowością, spectator, rozsyłka 30 Hz
  (równoległa, z pomijaniem zaległych klatek), przekaz głosu proximity, ping/pong.
- `track.py` — generatory: labirynt (meta w centrum), spirala, „węzeł" z WIADUKTAMI
  (mosty na samo-przecięciach), trasa z linii rysowanej przez gracza. `reachable()` = BFS
  dwupoziomowy (parter/most) z bramkami. Rozmiary map: mała/średnia/duża.
- `db.py` — SQLite: `results` (wyniki) + `tracks` (archiwum torów).
- `static/game.js` + `static/index.html` — Canvas 2D, widok „2.5D" (murki z cieniem, asfalt,
  wiadukty z filarami), fizyka z driftem (wektor prędkości, przyczepność boczna),
  kolizje ze ścianami per PIĘTRO (0/1/2) i auto-auto z masami karoserii, interpolacja ze
  snapshotów z buforem adaptacyjnym, dym, czat głosowy push-to-talk (V), telemetria (F3),
  auto-jakość (obniża efekty przy niskim FPS), 4 karoserie (sport/muscle/van/kart).
- `./run.sh` / `./stop.sh` / `./tunnel.sh` — JEDEN proces uvicorn, BEZ `--reload`.

Czego NIE wolno zepsuć: lobby z gotowością, wiadukty i pętle (BARDZO się podobają — nie
upraszczaj ich), meta w centrum, rysowanie tras, spectator, tabela wyników, czat głosowy,
telemetria, optymalizacje sieciowe i renderu.

---

## Cel 0 (NAJPIERW) — BUG: wyścig sam się kończy i wyrzuca do lobby
Objaw: podczas jazdy po torze, którego gracz NIE rysował (czyli tor generowany), wyścig
nagle się kończy i wszyscy lądują w lobby. Zdarzyło się co najmniej dwa razy.

Trop (sprawdź to w pierwszej kolejności, ale nie ograniczaj się do tego):
- `_back_to_lobby_soon()` jest tworzone jako `asyncio.create_task` po ogłoszeniu zwycięzcy
  i po ~8 s wywołuje `to_lobby()`. Jeśli w międzyczasie zaczęła się NOWA runda, stare zadanie
  nadal wypali i zakończy trwający wyścig. Brakuje anulowania/„pieczątki" rundy.
- `_draw_timeout()` ma podobny charakter (zadanie z poprzedniej fazy).
- Sprawdź też, czy `to_lobby()` / `start_round()` nie są wołane z rozłączeń graczy w złym momencie.

Wymagania:
1. Wprowadź identyfikator rundy (np. licznik `race_id`) i **odrzucaj skutki zadań ze starej rundy**.
2. Anuluj zaległe zadania przy każdej zmianie fazy.
3. Dodaj do serwera log powodu zakończenia wyścigu (kto/co go zakończyło) — żeby następnym
   razem dało się to udowodnić, a nie zgadywać.
4. **Napisz test**, który to odtwarza: wyścig → zwycięzca → natychmiastowy rewanż/nowa runda →
   sprawdź, że po 8+ s nowa runda NADAL trwa. Test ma failować na starym kodzie.

---

## Cel 1 — Dźwięk: całkowita przebudowa silnika + nowe efekty
Obecny syntezowany silnik brzmi źle („mikrofalówka"). Przebuduj go, inspiracja: Forza Horizon /
Forza Motorsport (to ma być inspiracja brzmieniem, NIE kopiowanie ich plików — nie pobieraj
cudzych nagrań; zostaje synteza + opcja wgrania własnej próbki, która już jest w kodzie).

Silnik — wymagania techniczne (Web Audio):
- Model wielowarstwowy zamiast jednego oscylatora: osobno **dolot/ssanie**, **wydech**,
  **mechanika/turbo**, każdy z własnym filtrem i głośnością.
- Dźwięk oparty o **częstotliwość zapłonów** liczoną z obrotów i liczby cylindrów
  (klasa auta = inny układ: V8 dla muscle, R4 turbo dla sport/kart, diesel dla van).
- **Harmoniczne rzędowe** (kilka oscylatorów w stosunkach zależnych od układu cylindrów),
  lekki detune i mikro-fluktuacja obrotów, żeby nie brzmiało syntetycznie.
- **Symulacja biegów**: obroty rosną, przy progu następuje „zmiana biegu" (spadek obrotów),
  słyszalny podbicie/odcięcie. Na hamowaniu — spadek obrotów, opcjonalne strzały w wydechu.
- **Filtr zależny od obciążenia** (gaz wciśnięty vs wybieg) — na gazie jaśniej i agresywniej.
- Osobne brzmienie **na boostcie** (turbo whistle / blow-off).
- Głośność zależna od prędkości i odległości (proximity) — jak dziś.

Nowe efekty dźwiękowe:
- **Uderzenie w ścianę** — impuls zależny od siły uderzenia (prędkość w normalną ściany):
  lekkie muśnięcie = cichy szur, mocny wjazd = głośny łomot. Bez spamu przy ślizganiu się
  wzdłuż bandy (throttling/histereza).
- **Drift/pisk opon** — pętla, której głośność i barwa zależą od kąta poślizgu i prędkości;
  narastanie/wyciszanie płynne, nie skokowe.
- **Zderzenie auto-auto** — wyraźniejsze niż o ścianę, zależne od mas obu aut.
- Wszystko pod kontrolą suwaka głośności i wyłącznika w ⚙️ Ustawieniach (osobno: silnik, efekty).

Uwaga o weryfikacji: nie możesz tego odsłuchać. Dlatego:
- udokumentuj parametry (częstotliwości, filtry, zakresy) w komentarzach,
- dodaj w Ustawieniach **panel testowy** z przyciskami „zagraj: uderzenie / drift / silnik na
  obrotach X" oraz suwakami kluczowych parametrów, żeby użytkownik mógł to dostroić uchem,
- napisz wprost w raporcie, że brzmienie wymaga oceny użytkownika.

---

## Cel 2 — Balans klas: wybór karoserii ma NAPRAWDĘ zmieniać grę
Dziś klasy różnią się masą i osiągami, ale za mało to czuć. Zrób z tego realny wybór taktyczny.

- Nadaj każdej klasie wyrazistą tożsamość i **wymierne** różnice:
  przyspieszenie, prędkość maksymalna, siła skrętu, przyczepność boczna (drift), masa
  (odrzut w kolizjach), pojemność i moc boostu, promień kolizji.
- Zaproponuj sensowne niszę dla każdej: np. kart = zwrotny sprinter słaby w kontakcie,
  van = taran wolny na prostej, muscle = najszybszy ale ślizgowy, sport = uniwersalny.
- **Zweryfikuj balans symulacją**: przejazd każdej klasy po tych samych torach
  (labirynt ciasny, tor z długimi prostymi, tor z wiaduktami) — pokaż tabelę czasów.
  Żadna klasa nie może wygrywać wszędzie; różnice mają być widoczne (kilka-kilkanaście %),
  ale nie miażdżące.
- Pokaż statystyki klas na ekranie wyboru (paski: przyspieszenie / prędkość / skręt / masa).

---

## Cel 3 — Wygląd 2.5D: auta mają wyglądać na bryły, nie na prostokąty z góry
Dziś to czysty rzut z góry i „body 3D" auta nie jest widoczne.

- Narysuj auta jako **bryły z wysokością**: widoczny bok/próg od strony przeciwnej do światła,
  zaokrąglony dach, szyby (przednia i tylna), maska i bagażnik, lampy (przód białe, tył czerwone),
  lusterka, wyraźniejsze koła z oponą i felgą.
- Zachowaj **stały kierunek światła** (jak murki i wiadukty — cień w prawo-dół), żeby scena
  była spójna. Wysokość bryły i długość cienia zależne od klasy (van wyższy niż kart).
- Auta mają wyglądać różnie **zależnie od kąta obrotu** (przy jeździe w bok widać więcej boku).
  Może to być tanie „udawane 3D" (skalowanie/offset paneli), byle czytelne i szybkie.
- **Wydajność**: to ma działać przy kilkunastu autach na słabym laptopie — rozważ rysowanie
  auta raz do offscreen canvas per (klasa, kolor) i obracanie gotowej bitmapy, zamiast
  rysowania kilkunastu kształtów co klatkę dla każdego auta.
- Zachowaj obecną spójność z 2.5D otoczenia (murki, wiadukty, cienie).

---

## Cel 4 — Ślady driftu (styl Need for Speed)
- Podczas poślizgu auto zostawia na asfalcie **ślady opon** (dwa pasy, od tylnych kół),
  które **zanikają w czasie** (kilka-kilkanaście sekund).
- Intensywność i szerokość śladu zależne od kąta poślizgu i prędkości; brak śladów przy
  normalnej jeździe.
- Do tego **dym spod kół** przy driftu (osobno od istniejącego dymu z rury) — gęstszy przy
  mocniejszym poślizgu.
- Ślady innych graczy też widoczne (na podstawie ich stanu z sieci).
- **Wydajność**: ślady rysuj do warstwy/offscreen canvas albo trzymaj mocno ograniczoną
  listę segmentów z limitem; nie może to zabić FPS na słabym sprzęcie ani przy wielu autach.
  Przy auto-jakości „min" ślady mogą być wyłączone.

---

## Twarde ograniczenia
- Wydajność: część graczy ma ~12–20 FPS. Każdy nowy efekt musi mieć limit i respektować
  istniejący system auto-jakości. Zmierz koszt (telemetria F3 pokazuje FPS i najgorszą klatkę).
- Sieć: nie zwiększaj ruchu bez potrzeby; nie cofaj optymalizacji (nieblokująca rozsyłka,
  pomijanie zaległych klatek, wysyłka pozycji z kroku fizyki).
- Uruchamianie: dokładnie JEDEN proces uvicorn, bez `--reload`; po testach sprzątaj procesy.
- Po każdej zmianie klienta podbij `game.js?v=N` w `index.html`.
- Nie pobieraj cudzych nagrań dźwiękowych (prawa autorskie) — synteza albo pliki użytkownika.

## Jak masz pracować
1. Kolejność: **Cel 0 (bug) → Cel 2 (balans) → Cel 3 (karoserie) → Cel 4 (ślady) → Cel 1 (dźwięk)**.
   Bug jest najważniejszy, bo psuje rozgrywkę; dźwięk na koniec, bo wymaga oceny uchem.
2. Rób etapami, testuj po każdym, nie wrzucaj wszystkiego naraz.
3. Testuj realnie: skrypty symulacyjne (czasy klas, przejezdność), symulacja klientów przez
   websockets (bug z lobby!), załadowanie strony i sprawdzenie konsoli (ZERO błędów),
   zrzuty ekranu do oceny wyglądu.
4. Po każdym etapie napisz krótko: co zrobione, co ZWERYFIKOWANE (jak) i CZEGO nie dało się
   sprawdzić. Nie pisz „działa", jeśli tego nie sprawdziłeś.
5. Jeśli coś okaże się złym pomysłem (np. udawane 3D zabija FPS) — powiedz to wprost
   i zaproponuj prostszą wersję zamiast udawać, że jest dobrze.
