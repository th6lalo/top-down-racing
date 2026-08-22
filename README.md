# 🏁 Wyścigi — gra multiplayer w przeglądarce

Wyścigi w czasie rzeczywistym dla kilku osób naraz. Serwer w Pythonie
(FastAPI + WebSocket), klient na czystym canvasie — bez silnika gry i bez
frameworka frontendowego. Sprint ze startu na metę, pierwszy wygrywa.

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./run.sh                      # http://localhost:8000
```

---

## Co jest w tym ciekawego

Trzy rzeczy, które odróżniają ten projekt od typowej gry-wprawki:

### 1. Generator torów, który potrafi odrzucić własny wynik

Wygenerowanie labiryntu to zadanie ze studiów. Znacznie trudniejsze jest
sprawdzenie, czy **da się nim przejechać autem o niezerowym promieniu** — po
dwóch piętrach, przez bramki wiaduktów, bez utykania w zakrętach.

`track.py` losuje kandydatów i **odrzuca te, które oblewają walidatory**:

| walidator | co sprawdza | dlaczego istnieje |
|---|---|---|
| `reachable()` | BFS po zrasteryzowanej mapie, osobno dla parteru i wiaduktu, z przejściami przez bramki | meta bywała odgrodzona murem |
| `centerline_ok()` | przejeżdża osią toru autem o realnym promieniu | korytarz bywał węższy niż auto |
| `bridges_ok()` | odrzuca wiadukty krzyżujące się ze sobą | dwa mosty na tym samym piętrze blokowały przejazd |
| `finish_clear()` | cały dojazd do mety musi być drożny | meta bywała zamurowana od strony dojazdu |
| `no_hairpins()` | czy zakręt mieści się w szerokości korytarza | zakręt 100° na krótkich odcinkach składał korytarz na siebie |

Ostatni jest najciekawszy. Przy szerokości korytarza `w` i kącie zakrętu `θ`
odcinki po obu stronach muszą mieć długość co najmniej `(w/2)·tan(θ/2)` —
inaczej zewnętrzna krawędź korytarza przecina samą siebie i powstaje ściana
w poprzek drogi. Zanim ten warunek powstał, auta potrafiły utknąć w miejscu,
które na mapie wyglądało poprawnie.

### 2. Tory wielopoziomowe

Trasa może się przecinać sama ze sobą — jedna nitka przechodzi **wiaduktem**
nad drugą. Każda ściana i każde auto mają swoje piętro, a kolizje liczone są
osobno dla każdego z nich. Wjazd i zjazd z mostu odbywa się przez **bramki**:
odcinki, które przełączają piętro auta w zależności od kierunku przejazdu.

### 3. Wydajność namierzona pomiarem, nie na wyczucie

Gracze zgłaszali skoki pingu do 1500 ms. Panel telemetrii (FPS, ping, ruch
sieciowy) pokazał, że skoki pokrywają się z generowaniem nowego toru —
600–800 ms pracy CPU **w pętli asyncio**, która przez ten czas nie obsługiwała
nikogo. Generowanie poszło do osobnego wątku, z pulą torów przygotowywanych
z wyprzedzeniem:

| | przed | po |
|---|---|---|
| **maksymalny ping** | 879 ms | **47 ms** |

Podobnie z ruchem sieciowym. Okazało się, że nick, kolor i karoseria — dane,
które nie zmieniają się przez cały wyścig — leciały w **każdym** pakiecie stanu,
30 razy na sekundę, do każdego gracza. Po przeniesieniu ich do osobnego
komunikatu wysyłanego przy zmianie składu:

| przy 8 graczach | przed | po |
|---|---|---|
| pakiet stanu | 1150 B | **550 B** |
| ruch wychodzący | 269 kB/s | **129 kB/s** |

---

## Architektura

```
server.py     WebSocket /ws, jeden pokój, cykl rundy (lobby → rysowanie → wyścig)
track.py      generatory torów + walidatory przejezdności
db.py         SQLite: wyniki i archiwum torów
static/
  game.js     klient: fizyka, sieć, dźwięk, czat głosowy, telemetria
  carart.js   wygląd aut (wspólny z tuner.html)
  index.html  interfejs
  tuner.html  strona do regulacji wyglądu aut
tests/        42 testy (pytest)
```

**Protokół.** Jeden WebSocket niesie i grę, i głos. Ramki tekstowe to JSON
(dołączenie, gotowość, pozycja, meta), ramki binarne to surowy PCM czatu
głosowego z doklejonym identyfikatorem nadawcy. Stan gry leci 30 razy na
sekundę, a klient wygładza ruch innych aut interpolacją z buforem
dopasowującym się do jakości łącza.

**Głos jest bramkowany odległością** — serwer nie rozsyła próbki do graczy,
którzy i tak nic nie usłyszą, bo ich auta są za daleko. Oszczędza to łącze
i nie opóźnia pakietów pozycji.

**Cykl rundy jest stemplowany.** Każda runda dostaje numer, a zadania z
poprzedniej są anulowane. Bez tego opóźnione zadanie ze starego wyścigu
potrafiło zakończyć nowy — klasyczny błąd współbieżności, trudny do
odtworzenia i łatwy do przeoczenia.

---

## Bezpieczeństwo

Serwer **nie wierzy klientowi**, bo klient liczy własną fizykę:

- pozycje są sprawdzane (`NaN` i nieskończoność odrzucane — inaczej trafiały
  do pakietu rozsyłanego wszystkim i psuły porównania odległości u każdego)
  i ograniczane do rozmiaru mapy
- zgłoszenie mety jest weryfikowane: gracz musi faktycznie być w prostokącie
  mety, a czas nie może być krótszy, niż fizycznie da się przejechać dystans
- rozmiar i tempo komunikatów są limitowane per połączenie
- pobieranie pliku audio z linku sprawdza adres **przed** pobraniem i odrzuca
  sieci prywatne; wszystkie błędy zwracają identyczny komunikat, żeby
  odpowiedzi serwera nie dało się użyć do skanowania sieci lokalnej

To nie jest pełny antycheat — ten wymagałby liczenia fizyki na serwerze.
Podnosi jednak poprzeczkę z „wyślij jeden pakiet" do „napisz bota, który
symuluje wiarygodny przejazd".

---

## Sterowanie

| klawisz | działanie |
|---|---|
| **W** / ↑ | gaz |
| **S** / ↓ | hamulec i wsteczny (W+S naraz = mocne hamowanie) |
| **A** **D** / ← → | skręt, proporcjonalny do prędkości |
| **Spacja** | boost — na starcie pusty, ładuje się w trakcie jazdy |
| **V** | mów (push-to-talk w czacie głosowym) |

Na telefonie sterowanie dotykowe pojawia się automatycznie.

---

## Rozgrywka

- **Lobby z gotowością** — wyścig rusza, gdy wszyscy klikną „jestem gotowy"
- **Cztery klasy pojazdów** różniące się masą, przyczepnością, przyspieszeniem
  i liczbą biegów; van rozpycha karta, kart wygrywa w ciasnych labiryntach
- **Rysowanie własnej mapy** myszką — trasa jest walidowana tak samo jak losowa
- **Czat głosowy proximity** — słychać tym głośniej, im bliżej macie auta
- **Tryb gościa** — można grać bez zapisywania wyników; ranking liczy się po
  trwałym identyfikatorze przeglądarki, nie po nicku, więc nie da się przejąć
  cudzych statystyk wpisując jego nazwę
- **Trzy rozmiary map**: 4200×2400, 6800×3600, 9200×4800 pikseli

---

## Testy

```bash
./.venv/bin/pip install -r requirements-dev.txt
./.venv/bin/pytest tests/ -v
```

42 testy. Testy walidacji pilnują błędów, które w tej grze naprawdę wystąpiły —
jeśli któryś zacznie padać, znaczy że błąd wrócił. Przykłady:

- rozmiar toru musi być **kopią**, nie referencją do współdzielonego słownika
  (przez ten błąd gracz spawnował się poza mapą, a kamera zacinała się na krawędzi)
- `reachable()` musi **odrzucić** zamurowaną metę — walidator, który zawsze
  mówi „tak", niczego nie waliduje
- milion punktów rysowanej mapy musi zostać obcięty **przed** konwersją

Testy działają na tymczasowej bazie i nigdy nie dotykają prawdziwych wyników.

---

## Gra przez internet

Serwer słucha na `0.0.0.0:8000`, więc w sieci lokalnej wystarczy IP hosta.
Dla znajomych spoza sieci — tunel Cloudflare:

```bash
./run.sh        # serwer
./tunnel.sh     # publiczny adres (losowy, zmienia się przy każdym uruchomieniu)
```

`tunnel-staly.sh` obsługuje nazwany tunel ze **stałym** adresem — wymaga
własnej domeny podpiętej do Cloudflare. Instrukcja jest w komentarzu w pliku.

---

## Licencja

Kod: [MIT](LICENSE).
Grafiki pojazdów: [Kenney Racing Pack](https://kenney.nl/assets/racing-pack) — CC0.
