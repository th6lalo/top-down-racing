# Raport z przeglądu kodu — gra wyścigowa multiplayer

Data przeglądu: 2026-08-22. Wszystkie liczby poniżej **zmierzyłem**, nie oszacowałem.
Gdzie czegoś nie sprawdziłem — piszę to wprost.

---

## ⛔ NAJPIERW: dziura, która działa TERAZ

**Endpoint `/proxy_audio` pozwala skanować Twoją sieć domową z internetu.**
Powaga: **krytyczna**. Działa w tej chwili, przez link, który wysłałeś znajomym.

Serwer pobiera **dowolny** adres podany przez klienta ([server.py:290](server.py:290)).
Jedyny warunek to `http://` lub `https://` na początku. Sprawdzenie typu pliku
następuje **po** pobraniu — czyli żądanie i tak wychodzi.

Odpalilem to na odizolowanym serwerze (port 8001). Trzy różne adresy dały trzy
różne komunikaty — i to jest gotowy skaner portów:

| adres | odpowiedź serwera | co z tego wynika |
|---|---|---|
| `http://127.0.0.1:8001/` | „to nie jest plik audio" | **usługa istnieje i odpowiada** |
| `http://127.0.0.1:9/` | „Connection refused" | **port zamknięty** |
| `http://192.168.1.1/` | „timed out" | **host istnieje, ale filtruje** |

Obcy człowiek z linkiem do gry może z tego zmapować Twój router, drukarkę, NAS,
panele administracyjne — wszystko, co masz w domowej sieci i co normalnie jest
niedostępne z zewnątrz. Twój laptop robi te żądania **w jego imieniu**.

**Co zrobić dziś:** albo usunąć `/proxy_audio` (nikt z niego realnie nie korzysta —
wgrywanie pliku z dysku działa niezależnie), albo dopuścić wyłącznie adresy z
białej listy domen i odrzucać adresy prywatne (`127.*`, `10.*`, `172.16-31.*`,
`192.168.*`, `169.254.*`) **po** rozwiązaniu DNS, zwracając zawsze ten sam
komunikat błędu.

---

## 1. Werdykt w trzech zdaniach

Projekt jest **wyraźnie powyżej przeciętnej gry-hobby**, ale w obecnym stanie
**nie nadaje się do pokazania rekruterowi** — nie z powodu kodu gry, tylko dlatego,
że nie ma repozytorium git, testów i ma opisaną wyżej dziurę bezpieczeństwa.
Największa siła to **generatory torów z prawdziwymi walidatorami przejezdności** —
to realna algorytmika, której w takich projektach się nie spotyka.
Największy wstyd to **całkowity brak weryfikacji tego, co mówi klient**: zmierzyłem,
że można wygrać wyścig w 0,33 s nie ruszając się z miejsca i wynik zapisuje się do bazy.

---

## 2. Co jest zrobione dobrze

**Walidatory przejezdności torów** ([track.py](track.py)) — to jest najlepsza rzecz
w projekcie. Wygenerowanie labiryntu to zadanie ze studiów. Sprawdzenie, czy da się
nim **przejechać autem o niezerowym promieniu, po dwóch piętrach, przez bramki
mostów** — to już inżynieria. `reachable()` robi BFS po zrasteryzowanej mapie z
uwzględnieniem pięter, `centerline_ok()` przejeżdża oś toru, `bridges_ok()` odrzuca
mosty krzyżujące się ze sobą, `no_hairpins()` liczy, czy zakręt mieści się w
szerokości korytarza. Generator, który potrafi **odrzucić własny wynik**, to coś,
czego nie widuje się w projektach portfolio.

**Tory wielopoziomowe z bramkami.** Kolizje liczone osobno dla parteru i wiaduktu,
bramki przełączające piętro po kierunku przejazdu. Rozwiązanie oczywiste to płaska
mapa — tu jest o poziom trudniej i działa.

**Naprawa zatoru w rozgłaszaniu stanu.** Wysyłka do klientów idzie przez
`asyncio.gather` z pomijaniem zajętych odbiorców, zamiast sekwencyjnego `await`
na każdym. Bez tego jeden zamulony gracz opóźniał wszystkich — klasyczny
head-of-line blocking. To, że problem został znaleziony i naprawiony właściwie,
jest warte pokazania.

**Generowanie torów poza pętlą zdarzeń** (`asyncio.to_thread` + pula gotowych torów).
Generacja trwa 600–800 ms i blokowała cały serwer. Pomiar A/B pokazał spadek
maksymalnego pingu z **879 ms do 47 ms**. Świadomość, że praca CPU nie może siedzieć
w pętli asyncio, to rzecz, której wielu juniorów nie ma.

**Pieczątka rundy** (`race_id` + `cancel_round_tasks`). Zadania ze starej rundy nie
mogą zakończyć nowej. Rozwiązanie typowego, paskudnego błędu współbieżności.

**Dźwięk silnika liczony z fizyki**, nie dobierany na ucho: częstotliwość zapłonów
to `obroty/60 × cylindry/2`. Sprawdziłem — zgadza się co do dziesiątej herca dla
wszystkich czterech klas. Dzięki temu V8 i dwucylindrowy gokart różnią się z
konstrukcji, a nie z ręcznie ustawionego suwaka.

**SQL jest parametryzowany** w całym `db.py` — zero podatności na wstrzyknięcie.

---

## 3. Co jest zrobione źle

### Krytyczne

**1. SSRF w `/proxy_audio`** — opisane na górze raportu.

### Poważne

**2. Serwer wierzy klientowi, że ten dojechał do mety.** ([server.py:483](server.py:483))
Napisałem klienta testowego, który dołączył, nie wykonał **ani jednego ruchu** i
wysłał `{"type":"finish"}`. Wynik:

```
serwer_uznal_mete: True
miejsce: 1
czas: 0.33
zwyciezca: Oszust
```

a w bazie wylądowało: `('Oszust', 1, 0.33, 'oszustoszust…')`. Ranking można
wyzerować w kilka sekund. Serwer ma `current_track` i pozycje graczy — może
sprawdzić, czy gracz naprawdę jest w prostokącie mety i czy czas jest sensowny.

**3. Serwer przyjmuje pozycje `NaN` i `Infinity`.** ([server.py:456](server.py:456))
`float(msg.get("x"))` łyka `NaN` bez mrugnięcia. Sprawdziłem — wartość
**przechodzi do pakietu stanu rozsyłanego wszystkim**. Każde porównanie
odległości z `NaN` daje fałsz, więc psuje to zasięg czatu głosowego i kolizje u
wszystkich graczy naraz. Brakuje `math.isfinite()` i ograniczenia do rozmiaru mapy.

**4. Zero ograniczeń tempa i rozmiaru komunikatów.** Nie ma limitu liczby
wiadomości na sekundę ani rozmiaru ramki głosowej. Ramki binarne są rozsyłane
dalej bez sprawdzenia długości. Jeden złośliwy klient może zapchać łącze
wszystkim. *Nie zmierzyłem, jak szybko to położy serwer — nie robiłem testu
obciążeniowego.*

**5. Ruch sieciowy rośnie kwadratowo.** Zmierzone rozmiary pakietu stanu:

| graczy | pakiet | wychodzące przy 30 Hz |
|---|---|---|
| 2 | 380 B | 22 kB/s |
| 4 | 730 B | 86 kB/s |
| 8 | 1430 B | **335 kB/s** |

Do tego dochodzi głos. Przy 8 graczach na domowym łączu to zaczyna boleć.
**60% tego to dane, które się nie zmieniają** — `name`, `color`, `body`, `smoke`
lecą 30 razy na sekundę, choć są stałe od dołączenia. Wysyłanie ich raz przy
dołączeniu zbija 8 graczy z 269 do 109 kB/s.

**6. Baza rośnie bez ograniczeń.** `races.db` waży 6,4 MB, z czego **6,16 MB to
JSON zapisanych torów** (301 torów, największy 68 KB). Każdy wygenerowany tor jest
zapisywany na zawsze, a prawie żaden nigdy nie zostanie odtworzony. Wyniki — czyli
to, co naprawdę cenne — zajmują ułamek tego.

### Drobne

**7. Parsowanie punktów mapy wywala się na błędnych danych.** ([server.py:478](server.py:478))
Sprawdziłem pięć wejść — wszystkie rzucają wyjątek:

```
[[1, 2, 3]]     -> ValueError: too many values to unpack
[['a', 'b']]    -> ValueError: could not convert string to float
[[None, None]]  -> TypeError: float() argument must be...
[5]             -> TypeError: cannot unpack non-iterable int
'tekst'         -> ValueError: not enough values to unpack
```

Waga jest **niska**, bo pętla komunikatów jest owinięta `try/except`
([server.py:154](server.py:154)) — ginie tylko to jedno połączenie, nie serwer.
Ale rysujący, któremu zerwie połączenie, zostawia rundę na łasce zegara.

**8. Obcięcie listy punktów następuje po konwersji**, nie przed
([server.py:478](server.py:478)): `[[float(a), float(b)] for a, b in pts][:400]`.
Klient wysyłający milion punktów wymusza milion konwersji, zanim cokolwiek
zostanie odrzucone. Zamiana kolejności to jedna linia.

**9. Brak licencji projektu** — bez pliku `LICENSE` nikt nie wie, czy może
tego kodu użyć. Grafiki Kenneya mają swoją licencję CC0 opisaną w `static/cars/`,
ale sam projekt nie ma żadnej.

---

## 4. Architektura

**Podział na pliki po stronie serwera jest dobry.** `server.py` (sieć i cykl gry),
`track.py` (generatory i walidatory), `db.py` (baza) — granice są w sensownych
miejscach i `track.py` dałoby się wyjąć jako samodzielną bibliotekę.

**`game.js` z 2195 liniami to realny problem, nie estetyka.** Nie dlatego, że
„długi plik = źle", tylko z konkretnych powodów: fizyka, render, sieć, dźwięk,
czat głosowy, interfejs i telemetria dzielą **ten sam zakres zmiennych globalnych**.
Zmiana czegokolwiek wymaga trzymania w głowie całości. Najdłuższe funkcje (miara
przybliżona — liczyłem odstępy między deklaracjami najwyższego poziomu, więc
liczby mogą być zawyżone): `sendPos` ~131 linii, `connect` ~118, `render` ~102.

Podział, który proponuję — **wzdłuż granic, które już istnieją w kodzie**:

| moduł | co zabiera |
|---|---|
| `net.js` | WebSocket, interpolacja, telemetria ruchu |
| `physics.js` | krok fizyki, kolizje, bramki pięter |
| `render.js` | kamera, tor, murki, mosty, minimapa |
| `audio.js` | silnik, efekty, czat głosowy |
| `ui.js` | ekran wejścia, lobby, ustawienia, sterowanie dotykiem |
| `carart.js` | **już wydzielony** — dowód, że to działa |

`carart.js` jest tu ważnym argumentem: wydzieliłeś go i nic się nie zepsuło,
a dzięki temu powstał `tuner.html`, który rysuje **tym samym kodem co gra**.
To jest namacalna korzyść z modularyzacji, nie teoria.

**Co pęknie jako pierwsze:** dodanie drugiego pokoju gry. Cały stan serwera
(`players`, `phase`, `current_track`, `race_id`) to zmienne globalne modułu.
Dwa pokoje wymagają opakowania tego w klasę `Room` — i to jest jedyna zmiana
architektoniczna, która naprawdę coś odblokowuje.

---

## 5. Ocena pod portfolio i CV

**Czy rekruter uzna projekt za mocny? Co pomyśli w pierwszej minucie?**
W obecnym stanie — **nie**, i to nie z powodu kodu. Pierwsza minuta rekrutera to
GitHub: patrzy na historię commitów, README i czy są testy. U Ciebie nie ma
**żadnej z tych trzech rzeczy**. Zobaczy zrzut kodu bez historii i pomyśli
„nie wiem, czy to pisał on, czy skądś skopiował". To nie jest ocena Twoich
umiejętności — to ocena tego, co widać. Po dodaniu gita z sensownymi commitami,
README z opisem architektury i garści testów ten sam projekt broni się dobrze.

**Czym realnie się wyróżnia, a co jest zwyczajne?**

Wyróżnia się **trzema rzeczami**:
1. **Generator torów, który waliduje własny wynik.** Odrzucanie wygenerowanej mapy,
   bo auto o danym promieniu nie zmieści się w zakręcie — to prawdziwa algorytmika.
2. **Tory wielopoziomowe z kolizjami per piętro.** Większość gier 2D jest płaska.
3. **Diagnostyka i pomiary.** Panel telemetrii i to, że problemy z pingiem zostały
   *zmierzone* i naprawione u źródła (879 ms → 47 ms), a nie „poprawione na oko".
   Na rozmowie to najlepszy materiał na opowieść.

Zwyczajne i widziane sto razy: sam pomysł na wyścigi 2D z góry, render na canvasie,
lobby, ranking, czat. Sto projektów ma dokładnie to samo. **Czat głosowy proximity
jest ładny, ale w portfolio nie zaimponuje** — to relay PCM, nie inżynieria audio;
prawdziwym atutem jest tu raczej syntezowany dźwięk silnika.

**Trzy rzeczy do wyeksponowania w README:**
1. Walidatory przejezdności — z **obrazkiem** odrzuconego i przyjętego toru
2. Historia optymalizacji pingu — wykres albo tabela przed/po, to sprzedaje się najlepiej
3. Tory wielopoziomowe — krótki gif z przejazdem wiaduktem

**Czego brak najbardziej rzuci się w oczy zawodowcowi:**
Kolejność jest bezlitosna: **brak gita** (natychmiast), **brak testów**
(w drugiej minucie), **dziura SSRF** (jeśli zajrzy do kodu sieciowego — a zajrzy,
bo to gra sieciowa), **brak walidacji danych od klienta** (jw.).

**Na jakie stanowiska pasuje, a na jakie nie:**
Wystarczy na **junior backend / Python** i **junior full-stack** — asyncio,
WebSockety, SQLite i świadomość, gdzie tkwią wąskie gardła, są tu widoczne.
**Nie wystarczy** na gamedev (brak silnika, brak grafiki 3D, gra jest prosta),
ani na stanowiska security (kod ma dziury, które sam pokazuję w tym raporcie).
Na frontend — słabo: `game.js` to jeden plik bez frameworka i bez testów.

**Zdanie do CV** (prawdziwe, sprawdzalne, bez ściemy):

> Przeglądarkowa gra wyścigowa multiplayer (Python/FastAPI + WebSocket, canvas):
> proceduralny generator torów wielopoziomowych z walidacją przejezdności
> (BFS + symulacja przejazdu), synchronizacja 30 Hz z interpolacją; diagnostyka
> wydajności obniżyła maksymalny ping z 879 ms do 47 ms.

---

## 6. Co dodać — lista priorytetowa

Posortowane po stosunku wpływu do nakładu.

| # | co | wpływ | nakład | CV czy rozgrywka |
|---|---|---|---|---|
| 1 | **git + sensowne commity + `.gitignore`** | ogromny | 1 h | **CV** |
| 2 | **Załatać SSRF** (usunąć endpoint albo biała lista) | ogromny | 30 min | jedno i drugie |
| 3 | **README z architekturą, zrzutami i historią optymalizacji** | ogromny | 3 h | **CV** |
| 4 | **Walidacja danych od klienta** (`isfinite`, granice mapy, meta po stronie serwera) | duży | 3 h | jedno i drugie |
| 5 | **Testy w projekcie** — walidatory torów to idealny materiał, są czystymi funkcjami | duży | 4 h | **CV** |
| 6 | Wyrzucić stałe pola z pakietu stanu (−60% ruchu) | duży | 2 h | rozgrywka |
| 7 | `LICENSE` (MIT) | średni | 5 min | **CV** |
| 8 | Ograniczenie tempa komunikatów | średni | 2 h | jedno i drugie |
| 9 | Sprzątanie starych torów w bazie (limit, np. 50 ostatnich) | średni | 1 h | rozgrywka |
| 10 | Podział `game.js` na moduły | średni | 1–2 dni | **CV** |
| 11 | GitHub Actions: uruchamianie testów przy każdym commicie | średni | 2 h | **CV** |
| 12 | Dockerfile | średni | 2 h | **CV** |
| 13 | Wiele pokoi gry (klasa `Room`) | duży | 2–3 dni | rozgrywka |
| 14 | Logowanie Google + trwałe konta | średni | 1 dzień | jedno i drugie |
| 15 | Tryb czasówki / duchy najlepszych przejazdów | średni | 2 dni | rozgrywka |

**Tanie, a robią duże wrażenie na rekruterze:** pozycje **1, 3, 5, 7, 11**.
Razem to jakieś **10 godzin**, a zmieniają odbiór projektu bardziej niż
kolejny miesiąc dokładania funkcji do gry. To jest najważniejsze zdanie w
całym raporcie.

---

## 7. Pierwsze pięć kroków

1. **Załataj SSRF.** Dlaczego teraz: to jedyna rzecz w tym raporcie, która
   naraża Cię realnie **dziś**, przy każdym uruchomieniu tunelu.

2. **Załóż repozytorium git.** Dlaczego teraz: każda kolejna zmiana bez historii
   to zmarnowany dowód Twojej pracy. Im wcześniej zaczniesz, tym więcej
   prawdziwej historii uzbierasz do momentu wysyłania CV.

3. **Napraw zaufanie do klienta** — meta sprawdzana po stronie serwera,
   `isfinite` na pozycjach. Dlaczego teraz: bez tego ranking jest fikcją, a to
   właśnie ranking chcesz pokazywać jako działającą funkcję.

4. **Napisz testy walidatorów torów.** Dlaczego teraz: to najłatwiejsze testy w
   całym projekcie (czyste funkcje, żadnej sieci) i dotyczą części, którą chcesz
   się chwalić. Testy, które sprawdzają Twoją najlepszą algorytmikę, są w portfolio
   warte więcej niż testy interfejsu.

5. **Napisz README z prawdziwą treścią** — architektura, zrzuty, tabela
   przed/po z optymalizacji pingu. Dlaczego teraz: rekruter przeczyta README
   i nie przeczyta kodu. To jedyny tekst, który na pewno zostanie przeczytany.

---

## Czego w tym przeglądzie NIE sprawdziłem

Uczciwie, żebyś nie brał tego raportu za pełniejszy niż jest:

- **nie robiłem testu obciążeniowego** — nie wiem, ilu graczy naprawdę wytrzyma
  serwer ani jak szybko położy go złośliwy klient
- **nie audytowałem `game.js` linia po linii** — 2195 linii; przejrzałem sieć,
  fizykę i wejście danych, ale nie cały interfejs
- **nie sprawdzałem gry na prawdziwym telefonie** — tylko w emulacji przeglądarki
- **nie weryfikowałem zachowania przy zerwaniu połączenia w trakcie wyścigu**
  ani przy jednoczesnym wejściu wielu graczy
- **liczby długości funkcji są przybliżone** — mierzyłem odstępy między
  deklaracjami najwyższego poziomu, co przy funkcjach zagnieżdżonych zawyża wynik
