# Prompt: brutalna ocena zespołu → dyskusja → realizacja

Skopiuj wszystko poniżej linii i wklej jako polecenie.

---

## Zadanie

Przeprowadź **trzyetapowy proces** nad grą w `/Users/janek/Races`:

1. **Brutalna ocena** — sześć osób o sprzecznych interesach ocenia projekt osobno
2. **Dyskusja** — te osoby spierają się, co zmienić, i wybierają cele
3. **Realizacja** — bez litości wdrażasz wybrane cele, do końca, z dowodem

To gra wyścigowa multiplayer w przeglądarce (FastAPI + WebSocket, klient na canvasie).
Gram w nią ze znajomymi przez tunel Cloudflare. **Bardzo zależy mi na wydajności.**

Nie chcę kurtuazji. Pochwała za coś przeciętnego jest gorsza niż jej brak.

---

## Faza 0 — fakty, zanim ktokolwiek otworzy usta

Poniższe **zostało sprawdzone** 2026-09-15. Zweryfikuj je ponownie, zanim na nich
oprzesz ocenę — mogły się zmienić.

**Kod**

| plik | linii | rola |
|---|---|---|
| `static/game.js` | 2417 | cały klient: fizyka, render, sieć, dźwięk, głos, UI, telemetria |
| `track.py` | 915 | generatory torów + walidatory przejezdności |
| `server.py` | 765 | WebSocket, pokój, cykl rundy, walidacja danych od klienta |
| `static/index.html` | 523 | interfejs i style |
| `static/carart.js` | 493 | wygląd aut (grafiki Kenney CC0) |
| `db.py` | 182 | SQLite: wyniki, tory, telemetria |

**Stan projektu**
- 13 commitów, **zero zdalnego repozytorium** — kod istnieje tylko na jednym laptopie
- 42 testy, **wyłącznie serwer** — po stronie klienta (2417 linii) zero testów
- CI napisane, **nigdy nie uruchomione**, bo nie ma gdzie
- README bez ani jednego zrzutu ekranu

**Dane z bazy — i to są fakty, nie hipotezy**
- 332 wyniki od 39 graczy
- **Ranking jest zaśmiecony**: gracz „Janek" ma 104 zwycięstwa na 104 wyścigi z
  najlepszym czasem **2,4 s**, choć wyścig trwa 45–90 s. Są 3 wyniki poniżej 5 s
  i nicki wyglądające na testowe („123", „124", „sfsf"). To dane sprzed poprawki
  weryfikacji mety, które nadal wiszą w rankingu.
- **Najwięcej graczy w jednym wyścigu: 2.** Wszystko, co wiadomo o grze na 8 osób,
  jest teoretyczne — obliczone, nie przeżyte.

**Telemetria wydajności — przeczytaj uważnie, zanim wyciągniesz wniosek**
- 4 pomiary. **Wszystkie od jednej osoby, na jednym komputerze, w wyścigach 2-osobowych.**
- Wynik: 60 FPS w medianie i w piątym percentylu.
- To **nie** dowodzi, że wydajność jest dobra. To dowodzi, że jest dobra na jednym
  mocnym komputerze przy dwóch graczach. Brak telefonów, słabszego sprzętu, większych
  grup. Kto napisze „wydajność jest w porządku, telemetria to potwierdza" — myli się.

**Znane, otwarte problemy**
- zmiana panelu nitro **niezweryfikowana**: benchmark przejazdu jedzie trasą
  optymalną, a panele leżą celowo obok niej (zmierzone: 0 z 44 paneli na drodze)
- muscle kończy tylko ~70% labiryntów w benchmarku
- dźwięk silnika został zbudowany i poprawiony, ale **nikt z autorów go nie słyszał**
- dostawca internetu autora nie rozwiązuje adresów `trycloudflare.com`

Uzupełnij tę listę o to, co sam znajdziesz. Uruchom grę na porcie 8001 z osobną
bazą i **zagraj**, zanim ocenisz rozgrywkę.

---

## Faza 1 — sześć ocen, każda osobno

Każda osoba ocenia **niezależnie**, zanim usłyszy pozostałe. Wybrane tak, żeby
ich interesy się **kłóciły** — inaczej dyskusja będzie teatrem zgody.

| osoba | patrzy na | czego chce |
|---|---|---|
| **Kuba** — gracz wyczynowy | czy wygrywa lepszy kierowca, czucie auta, sufit umiejętności | głębi, wyzwania, uczciwości |
| **Ola** — znajoma, pierwszy raz w grze | czy w 30 s wie, co robić; czy zechce wrócić | prostoty, jasnych wskazówek |
| **Marek** — projektant gier | pętla rozgrywki; po co grać 10. raz | nowych mechanik, powodów do powrotu |
| **Ewa** — tech lead | dług techniczny, testowalność, co pęknie przy rozbudowie | spłacenia długu, zanim cokolwiek dojdzie |
| **Tomek** — inżynier wydajności i sieci | FPS, opóźnienia, ruch, zachowanie przy 8 graczach | wycięcia wszystkiego, co kosztuje klatki |
| **Agnieszka** — rekruterka techniczna | czy projekt sprzedaje autora w 60 sekund | szlifu, widoczności, porządku w repo |

**Tomek ma większą wagę głosu** — autorowi bardzo zależy na wydajności.

Każda ocena zawiera:
1. **Werdykt w jednym zdaniu** — bez owijania
2. **Trzy rzeczy, które działają** — każda z dowodem i wyjaśnieniem, czemu to nietypowe
3. **Pięć rzeczy, które nie działają** — posortowane od najgorszej, każda z dowodem
4. **Jedna rzecz, której ta osoba nigdy by nie odpuściła**

**Dowód** znaczy: plik i linia, wykonany pomiar, zapytanie do bazy albo opis tego,
co się stało podczas gry. Opinia bez dowodu jest odrzucana.

Kuba i Ola **muszą zagrać**, zanim ocenią. Tomek **musi zmierzyć**, a nie powoływać
się na telemetrię z Fazy 0 bez zastrzeżenia o jej próbie.

---

## Faza 2 — dyskusja

Zapis dyskusji ma być czytelny jak rozmowa. Trzy rundy:

**Runda 1 — propozycje.** Każda osoba zgłasza **najwyżej dwie** konkretne zmiany.
Konkretne znaczy: „przenieść X z pliku A do B, żeby Y" — nie „poprawić jakość kodu".

**Runda 2 — atak.** Każda osoba **musi zaatakować** propozycję innej osoby: wskazać,
co ta zmiana zepsuje, ile kosztuje, albo czemu nie rozwiązuje prawdziwego problemu.
Atakowany odpowiada. Zgoda bez sprzeciwu jest zakazana — jeśli nikt nie ma zastrzeżeń
do propozycji, to znak, że nikt jej porządnie nie przemyślał.

Spodziewane konflikty, które **muszą** paść na stół:
- Marek chce nowych mechanik — Ewa mówi, że `game.js` z 2417 liniami bez testów się posypie
- Tomek chce wycinać efekty — Kuba i Ola mówią, że to one robią grę przyjemną
- Kuba chce trudniejszej gry — Ola mówi, że znajomi odpadną po pierwszym wyścigu
- Agnieszka chce szlifu i widoczności — Marek mówi, że to makijaż na grze, która nie ma powodu do powrotu

**Runda 3 — decyzja.** Każda propozycja, która przetrwała atak, dostaje ocenę:

| kryterium | skala |
|---|---|
| wpływ na grających | 0–3 |
| wpływ na wydajność | 0–3 (**liczone podwójnie**) |
| wpływ na portfolio | 0–3 |
| koszt | 0–3 (odejmowany) |
| ryzyko zepsucia tego, co działa | 0–3 (odejmowane) |

Wybierz **od 3 do 5 celów** z najwyższym wynikiem. Nie więcej — lepiej zrobić
trzy rzeczy do końca niż osiem do połowy.

Każdy wybrany cel zapisz jako:
- **cel** — jedno zdanie
- **kryterium ukończenia** — mierzalne, sprawdzalne, np. „FPS w 5. percentylu ≥ 50
  przy 6 symulowanych autach na słabym profilu"
- **kto go wybronił, kto był przeciw** i czemu przegrał

Zapisz fazy 1–2 w pliku `OCENA-zespolu.md` i **pokaż mi go, zanim zaczniesz Fazę 3**.

---

## Faza 3 — brutalna realizacja

Po mojej akceptacji wdrażasz wybrane cele. „Brutalnie" znaczy: do końca, bez
zostawiania w połowie, bez udawania, że coś działa.

**Organizacja**
- Załóż `PLAN-realizacji.md` z listą celów i kryteriami ukończenia. Po każdym celu
  odhaczaj i dopisuj, **czym zweryfikowałeś** ukończenie. Jeśli praca się urwie,
  następna sesja zacznie od pierwszego nieodhaczonego punktu.
- **Jeden cel = jeden commit**, z opisem co i dlaczego.
- Cel jest ukończony dopiero, gdy spełnia kryterium z Fazy 2 — **zmierzone**.

**Twarde ograniczenia**
- **Najwyżej jeden serwer gry, bez `--reload`.** Kiedyś kilka procesów w tle
  zamuliło laptopa. Testy: port 8001 i osobna baza (`RACES_DB=...`), nigdy `races.db`.
- **Nie upraszczaj wiaduktów ani pętli** — autor bardzo je lubi. „Porządkowanie kodu"
  nie jest powodem.
- **42 testy muszą przejść.** Nowe zachowanie dostaje nowe testy.
- **Zanim zrestartujesz serwer**, sprawdź, czy ktoś nie gra (`server.log`).
- Pliki tymczasowe do katalogu scratchpad, nie do repozytorium.
- Nie wysyłaj niczego na zewnątrz i nie zakładaj kont.

---

## Pułapki, na które już się wpadło w tym projekcie

Każda z poniższych **faktycznie wydarzyła się** i dała fałszywy wynik. Sprawdź,
czy nie powtarzasz żadnej:

1. **Benchmark mierzył nie to, co trzeba.** Kierowca testowy jechał trasą optymalną,
   a panele nitro leżą obok niej — zmiana mechaniki nitro dała **identyczne** wyniki
   co do dziesiątej sekundy. Identyczny wynik po zmianie to sygnał, że pomiar jej nie
   dotyka, a nie że zmiana jest neutralna.
2. **Test wypisywał cele zamiast zmierzonych wartości** i niczego nie dowodził.
3. **Błąd testu wzięty za błąd gry.** Klient testowy wchodził w `sleep()` i przestawał
   czytać gniazdo — wyglądało, jakby czat głosowy był zepsuty, a działał bez zarzutu.
4. **Porównanie dwóch różnych losowych prób jako kontrolowanego eksperymentu.**
   Zmiana plus inny zestaw torów dały „pogorszenie", które było szumem. Do porównań
   przed/po używaj **stałego zestawu** zapisanego na dysk.
5. **Pomiar wydajności w ukrytej karcie przeglądarki.** Wyszło 0,2 ms na klatkę na
   każdym poziomie jakości, co jest niemożliwe — przeglądarka pomijała rasteryzację.
6. **Stary plik w `/tmp` odczytany jako świeży wynik.** Pobranie zwróciło HTTP 000,
   a grep pokazał wersję z poprzedniego przebiegu.
7. **Hipoteza przyjęta bez pomiaru.** Założono, że duże auta nie mieszczą się w
   korytarzach i zmieniono walidator — zmierzone przesmyki miały 96 px przy promieniu
   auta 20 px. Poprawka naprawiała nieistniejący problem.
8. **Wniosek z próby jednej osoby.** Telemetria z Fazy 0 — patrz wyżej.

Jeśli wynik jest za dobry, za równy albo identyczny z poprzednim — **zatrzymaj się
i sprawdź pomiar**, zanim uwierzysz.

---

## Raport końcowy

Na koniec `RAPORT-realizacji.md`:

1. **Tabela celów**: cel, kryterium, wynik **przed**, wynik **po**, czy spełniony
2. **Czego nie zrobiłeś** i dlaczego — wprost, na początku, nie w przypisie
3. **Czego nie zweryfikowałeś** — osobna lista
4. **Co przegrało w dyskusji**, a warto do tego wrócić
5. **Jedno zdanie od każdej z sześciu osób**: czy jest zadowolona z efektu
