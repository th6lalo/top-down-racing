# Prompt: pełny przegląd kodu + ocena projektu pod portfolio

Skopiuj wszystko poniżej linii i wklej jako polecenie.

---

## Kim jesteś i co masz zrobić

Jesteś doświadczonym inżynierem, który robi **rzetelny przegląd kodu** oraz
**ocenę projektu pod kątem portfolio/CV**. Nie jesteś tu po to, żeby mnie
chwalić. Jestem początkujący i potrzebuję prawdy, nie kurtuazji — pochwała
za coś przeciętnego zaszkodzi mi na rozmowie rekrutacyjnej bardziej niż
szczera krytyka teraz.

Projekt: **przeglądarkowa gra wyścigowa multiplayer** w katalogu `/Users/janek/Races`.
Gram w nią ze znajomymi przez tunel Cloudflare.

## Co tu jest (stan faktyczny, sprawdzony)

| plik | linii | rozmiar | rola |
|---|---|---|---|
| `server.py` | 551 | 21 KB | FastAPI + uvicorn, WebSocket `/ws`, jeden wspólny pokój, cykl rundy |
| `track.py` | 792 | 33 KB | generatory torów (labirynt, spirala, pętle z wiaduktami) + walidatory przejezdności |
| `db.py` | 104 | 4 KB | SQLite: tabele `results` i `tracks` |
| `static/game.js` | 2195 | 94 KB | cały klient: fizyka, render, sieć, dźwięk, czat głosowy, telemetria |
| `static/carart.js` | 479 | 23 KB | wygląd aut (grafiki Kenney CC0 + wariant rysowany kodem) |
| `static/index.html` | 518 | 27 KB | interfejs i style |
| `static/tuner.html` | 215 | 9 KB | strona do regulacji wyglądu aut |
| `run.sh` `stop.sh` `tunnel.sh` `tunnel-staly.sh` | — | — | uruchamianie serwera i tunelu |

Baza: 298 wyników, 301 zapisanych torów, plik `races.db` waży **6,4 MB**.

**Czego NIE ma, a wiem o tym:**
- brak repozytorium **git** (żadnej historii zmian)
- brak testów w projekcie — testy pisane w trakcie budowy lądowały w `/tmp` i przepadły
- brak CI, brak konteneryzacji, brak pliku licencji projektu

Nie musisz tych trzech odkrywać — masz je ocenić: jak bardzo bolą i co z nimi zrobić najpierw.

## Co gra już potrafi

- multiplayer w czasie rzeczywistym, 30 Hz stanu, interpolacja z adaptacyjnym buforem
- fizyka wektorowa z driftem, ślizg po ścianie, kolizje aut zależne od masy
- **tory wielopoziomowe**: wiadukty z bramkami przełączającymi piętro, kolizje liczone per piętro
- generatory torów z **walidatorami przejezdności** (BFS po dwóch piętrach, przejazd osią toru, kontrola ostrych zakrętów i krzyżujących się mostów)
- lobby z gotowością wszystkich graczy, rysowanie własnej mapy myszką
- 4 klasy pojazdów o różnej masie, przyczepności i skrzyni biegów
- **proximity chat głosowy** (przekaźnik PCM po tym samym WebSocket, głośność zależna od odległości, push-to-talk)
- **syntezowany dźwięk silnika** — częstotliwość zapłonów liczona fizycznie (`obroty/60 × cylindry/2`), warstwy wydech/dolot/turbo, skrzynia biegów z histerezą
- ślady driftu blaknące w czasie, dym spod kół, tryb 2.5D
- gra na telefonie (dotykowe sterowanie, responsywny układ)
- panel telemetrii (FPS, ping, ruch sieciowy, liczba cząstek)
- tryb gościa: wyniki zapisują się tylko graczom, którzy tego chcą; ranking liczony po trwałym kluczu z przeglądarki, nie po nicku

## Zasady pracy — to jest najważniejsza część promptu

1. **Sprawdzaj, nie zgaduj.** Każde twierdzenie o wydajności, złożoności czy
   błędzie poprzyj czymś wykonanym: uruchomionym fragmentem kodu, pomiarem,
   zapytaniem do bazy. Jeśli czegoś nie zmierzyłeś — napisz wprost
   „nie sprawdziłem" zamiast szacować i podawać to jako fakt.
2. **Odróżniaj fakt od opinii.** „Funkcja ma 180 linii" to fakt. „Jest
   nieczytelna" to opinia — uzasadnij ją.
3. **Nie przepisuj kodu na tym etapie.** To przegląd, nie refaktoryzacja.
   Zmiany w plikach tylko wtedy, gdy poproszę osobno.
4. **Nie chwal na wyrost.** Jeśli coś jest przeciętne, napisz „przeciętne".
   Jeśli coś jest naprawdę dobre — też to napisz, ale uzasadnij czym.
5. **Ograniczenia sprzętowe:** wolno uruchomić **najwyżej jeden** serwer gry
   i **bez** `--reload`. Kiedyś kilka procesów w tle plus przeładowywanie
   zawiesiło mi laptopa. Do testów używaj portu 8001 i osobnej bazy
   (`RACES_DB=/tmp/…`), nigdy `races.db`.
6. **Nie psuj tego, co działa.** Wiadukty i pętle bardzo mi się podobają —
   nie proponuj ich upraszczania jako „porządkowania kodu".

## Raport — taki ma być układ

Zapisz go jako `RAPORT-przeglad.md` w katalogu projektu.

### 1. Werdykt w trzech zdaniach
Bez owijania: czy to dobry projekt, czy nadaje się do CV, co jest jego
największą siłą i największym wstydem.

### 2. Co jest zrobione dobrze
Konkretnie, z odwołaniem do pliku i linii. Przy każdym punkcie napisz,
**dlaczego** to dobre — czym różni się od rozwiązania oczywistego.

### 3. Co jest zrobione źle
To samo, z powagą błędu: **krytyczne / poważne / drobne**. Interesują mnie
zwłaszcza: błędy bezpieczeństwa, sytuacje wyścigu w kodzie sieciowym, rzeczy
które wywrócą się przy 8 graczach, miejsca gdzie klient ufa danym z sieci
bez sprawdzenia, i miejsca gdzie serwer ufa klientowi.

### 4. Architektura
Czy podział na pliki ma sens. `game.js` ma 2195 linii i robi wszystko —
oceń, czy to realny problem czy tylko estetyka, i **na jakie moduły** to
rozbić. Powiedz, co pęknie jako pierwsze przy dalszej rozbudowie.

### 5. Ocena pod portfolio i CV
Odpowiedz osobno na każde pytanie:
- Czy rekruter techniczny uzna ten projekt za mocny? Co pomyśli w pierwszej minucie?
- Czym ten projekt **realnie** się wyróżnia na tle setek innych gier-hobby na GitHubie — a co jest w nim zwyczajne i widziane sto razy?
- Które **trzy** rzeczy najlepiej pokazują umiejętności i warto je wyeksponować w README?
- Czego brak najbardziej rzuci się w oczy zawodowcowi?
- Na jakie stanowiska ten projekt pasuje, a na jakie nie wystarczy?
- Jak sformułować **jedno zdanie o tym projekcie do CV**, żeby było prawdziwe i mocne?

### 6. Co dodać — lista priorytetowa
Dla każdej pozycji podaj: **wpływ** (duży/średni/mały), **nakład pracy**
(godziny/dni), i **czy poprawia CV czy tylko rozgrywkę**. Posortuj po
stosunku wpływu do nakładu. Osobno zaznacz rzeczy, które są tanie a robią
duże wrażenie na rekruterze.

### 7. Pierwsze pięć kroków
Dokładnie pięć, w kolejności, od jutra. Każdy z krótkim uzasadnieniem
„dlaczego akurat to teraz".

## Na koniec

Jeśli w trakcie znajdziesz błąd, który psuje grę **teraz** — napisz o nim od
razu na początku raportu, wyraźnie, zanim przejdziesz do reszty. Nie chowaj
go w środku listy.
