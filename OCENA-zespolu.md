# Ocena zespołu — gra wyścigowa

Data: 2026-09-15. Każde twierdzenie oparte na pomiarze, zapytaniu do bazy albo
konkretnym pliku. Opinie bez dowodu odrzucone.

**Wspólne fakty (Faza 0), zweryfikowane:**
- `game.js` = 2417 linii, 104 zmienne globalne, 118 funkcji najwyższego poziomu
- 13 commitów, **0 zdalnego repozytorium**, 42 testy (tylko serwer), CI nigdy nie uruchomione, README bez zrzutów
- ranking: „Janek" 104/104 zwycięstw, rekord **2,4 s** (wyścig trwa 45–90 s); **61/332** wyników poniżej 15 s, **297/332** bez klucza gracza (sprzed trybu gościa)
- retencja: **35/39 graczy grało tylko jeden dzień**; aktywność dzienna 108 → 191 → 11 → 4 → 18
- **najwięcej graczy w jednym wyścigu w historii: 2**
- telemetria: 4 pomiary, jedna osoba, jeden komputer, wyścigi 2-osobowe, 60 FPS
- **pierwszy wyścig nowej grupy to runda RYSOWANIA** (`drawn_next=True` na starcie, server.py:46) — nowicjusz dostaje 45 s na narysowanie toru myszką, zanim w ogóle pojedzie
- balans (świeży zestaw 24 torów, benchmark): kart wygrywa ogólnie o **6,7%**, króluje w labiryntach (78 s vs 87–91), muscle króluje w korytarzach (72,6 s vs 80–81); ukończone: kart/sport 24/24, van 23/24, muscle 22/24
- mediany benchmarku **78–90 s** przy celu kalibracji AI 35–70 s (track.py:230)

---

## Faza 1 — sześć ocen

### Kuba — gracz wyczynowy (zagrał 8 wyścigów na porcie 8001)

**Werdykt:** Auto czuje się dobrze, ale nie ma o co grać — wygrywam bo znam mapę, nie bo lepiej jeżdżę.

**Działa:**
1. **Drift jest satysfakcjonujący i realny** — model wektorowy z przyczepnością boczną (game.js, `update`), boost obniża `LAT_FRICTION` do 2.6, więc na nitro auto faktycznie ucieka tyłem. To nie jest „obrót na pięcie" jak w większości gierek 2D.
2. **Klasy mają nisze** — zmierzone: kart -11% w labiryntach, muscle -11% w korytarzach. Wybór auta coś znaczy.
3. **Panele nitro tworzą decyzję** — objazd po panel kosztuje czas, więc jest o czym myśleć na trasie.

**Nie działa (od najgorszej):**
1. **Zero sufitu umiejętności w rywalizacji** — nie ma okrążeń, nie ma pomiaru sektora, nie ma ducha. Wygrywa ten, kto zna mapę, bo mapa jest nowa dla wszystkich naraz. Po 3 wyścigach nie mam jak być „lepszy".
2. **Nitro niezweryfikowane** — grałem i nie umiem powiedzieć, czy 0,75 s coś zmienia. Brak licznika, brak czucia.
3. **Brak rekordów toru** — pobiłem swój czas i gra o tym nie wie. Nie ma po co ścigać samego siebie.
4. **Mediany 78–90 s** — wyścigi są na górnej granicy albo dłuższe niż zakładane 45–90 s. Ciągnie się.
5. **Kart lekko za mocny** — 6,7% ogólnej przewagi to nie tragedia, ale wyczynowo wszyscy wezmą karta.

**Nie odpuści:** rekordów toru z duchem najlepszego przejazdu.

### Ola — znajoma, pierwszy raz (zagrała, komentarz na żywo)

**Werdykt:** Pierwsze, co gra mi kazała, to narysować tor. Nie wiedziałam, że to gra wyścigowa.

**Działa:**
1. **Lobby z gotowością jest jasne** — wiadomo, że się czeka na wszystkich (index.html, `#lobby`).
2. **Sterowanie jest intuicyjne** gdy już jadę — strzałki, wszyscy je znają.
3. **Wybór auta z miniaturkami** — ładny, od razu widać różnice.

**Nie działa (od najgorszej):**
1. **PIERWSZY wyścig to rysowanie toru** (server.py:46, `drawn_next=True`) — mój pierwszy kontakt z „grą wyścigową" to biały ekran i „narysuj trasę w 45 s". Nie zrozumiałam, o co chodzi. To jest moment, w którym znajomy odpada.
2. **Nie ma nigdzie „jak grać"** — musiałam pytać, czym się boostuje.
3. **Nie wiem, że mam mikrofon na V** — nikt mi nie powiedział, ikonę zobaczyłam przypadkiem.
4. **Po wyścigu nie wiem, co osiągnęłam** — dojechałam i tyle.
5. **Panele nitro — nie wiedziałam, że mam po nie jechać.** Myślałam, że to dekoracja.

**Nie odpuści:** żeby pierwszy wyścig był wyścigiem, nie rysowaniem.

### Marek — projektant gier

**Werdykt:** Solidny rdzeń jazdy, ale gra nie ma pętli — dane to potwierdzają: 35 z 39 osób nie wróciło na drugi dzień.

**Działa:**
1. **Rdzeń jazdy jest lepszy niż powód, by go używać** — fizyka, klasy, nitro to gotowy fundament pod prawdziwą grę.
2. **Proceduralne tory** dają nieskończoną świeżość zawartości za darmo (track.py).
3. **Rysowanie własnych map** to realna mechanika UGC, rzadka w takich projektach.

**Nie działa (od najgorszej):**
1. **Brak jakiejkolwiek progresji** — retencja 35/39 na jeden dzień to nie przypadek. Nie ma się co odblokowywać, do czego wracać, czego zbierać. Wygrana nie zostawia śladu.
2. **Ranking globalny jest bez znaczenia** — 297/332 wyników to śmieci sprzed trybu gościa. Nawet gdyby był czysty, sumuje niezwiązane sesje.
3. **Brak celu w pojedynczym wyścigu poza „bądź pierwszy"** — nie ma okrążeń, checkpointów z czasem, bonusów.
4. **UGC jest ukryte** — narysowane tory nikną po jednym użyciu, nie ma biblioteki „zagraj tor znajomego".
5. **Nitro to jedyna mechanika przewagi** — za mało, by budować mistrzostwo.

**Nie odpuści:** czegoś, co przeżywa wyścig — rekord, odblokowanie, cokolwiek trwałego.

### Ewa — tech lead

**Werdykt:** Serwer jest zdrowy, klient to bomba z opóźnionym zapłonem — 2417 linii, 104 globale, zero testów.

**Działa:**
1. **Serwer jest dobrze rozłożony i przetestowany** — server/track/db mają sensowne granice, walidatory torów to prawdziwa algorytmika, 42 testy pokrywają to, co ważne.
2. **Walidacja danych od klienta jest porządna** (server.py, `_meta_odrzucona`, `_liczba`, `_punkty_mapy`) — serwer nie ufa klientowi, jest test na oszusta.
3. **carart.js udowodnił, że modularyzacja tu działa** — wydzielony, użyty przez tuner.html.

**Nie działa (od najgorszej):**
1. **`game.js` = 2417 linii / 104 globale / 118 funkcji, ZERO testów** — każda nowa mechanika (to, czego chce Marek) dokłada do pliku, którego nikt nie umie bezpiecznie ruszyć. To jest hamulec całego projektu.
2. **Brak zdalnego repozytorium** — jedna awaria dysku i 13 commitów znika. To nie dług, to hazard.
3. **CI napisane, nigdy nieuruchomione** — zielone testy lokalnie nic nie znaczą, dopóki nie chodzą automatycznie.
4. **Brak testów klienta = regresje przechodzą niezauważone** — bug z miniaturkami (grafiki dopiero po kliknięciu) przeszedł, bo nie ma siatki.
5. **Jeden pokój na zmiennych globalnych** — dwie grupy naraz się nie da, `Room` byłby dużą operacją.

**Nie odpuści:** zdalnego repo + CI, zanim cokolwiek nowego dojdzie.

### Tomek — inżynier wydajności i sieci (GŁOS PODWÓJNY)

**Werdykt:** Nie mamy pojęcia, czy gra działa na 8 graczy — nigdy nie było więcej niż 2. Telemetria to jedna osoba na mocnym PC.

**Działa:**
1. **Rozgłaszanie stanu jest już zoptymalizowane** — `roster` oddziela dane stałe, pakiet stanu to 5 pól, zmierzone 269→129 kB/s przy 8 (obliczeniowo).
2. **Generowanie torów poza pętlą** (`asyncio.to_thread` + pula) — ping 879→47 ms, udowodnione A/B.
3. **Auto-jakość realnie tnie koszt** — puffs 95→45, znacznik jakości przy spadku FPS (game.js:62, 119).

**Nie działa (od najgorszej):**
1. **Zero pomiaru pod obciążeniem** — „8 graczy" to arytmetyka, nie eksperyment. Nigdy nie odpaliłem 8 klientów naraz. To jest dziura wprost w tym, na czym autorowi najbardziej zależy.
2. **Telemetria z próby n=1** — 4 pomiary, jedna osoba, jeden komputer, 2 graczy. „60 FPS" nie mówi nic o telefonie ani o grupie.
3. **Brak profilu słabego sprzętu** — nie wiem, co się dzieje przy 8 autach + dymie + smugach na starym laptopie.
4. **Głos idzie tym samym WebSocketem co stan** — przy 8 gadających naraz nie wiem, czy pozycje nie zaczną się opóźniać.
5. **Mediany 78–90 s** oznaczają dłuższe wyścigi = więcej pakietów = większy łączny ruch na sesję.

**Nie odpuści:** prawdziwego pomiaru przy 6–8 jednoczesnych klientach, zanim uwierzy w cokolwiek o wydajności.

### Agnieszka — rekruterka techniczna

**Werdykt:** Realna inżynieria w środku, ale rekruter jej nie zobaczy — nie ma repo na GitHubie, a README nie ma ani jednego obrazka.

**Działa:**
1. **Historia commitów opowiada historię** — 13 commitów z konkretnymi, mierzonymi opisami (bezpieczeństwo, wydajność, balans). To rzadkość.
2. **README opisuje architekturę i pokazuje pomiary** — tabela ping 879→47 ms sprzedaje umiejętność diagnozy.
3. **Walidatory torów to mocny materiał na rozmowę** — algorytmika, której nie ma w typowym portfolio.

**Nie działa (od najgorszej):**
1. **Zero zdalnego repozytorium** — projektu dosłownie nie da się pokazać. Pierwsza minuta rekrutera to GitHub, którego nie ma.
2. **README bez zrzutów** — nikt nie przeczyta 900 linii `track.py`, ale każdy spojrzy na obrazek wiaduktu. Nie ma żadnego.
3. **CI nieuruchomione = brak zielonego znaczka** — testy, których nie widać, nie liczą się dla rekrutera.
4. **13/13 commitów Co-Authored-By Claude** — uczciwe, ale bez opisu roli autora czyta się jak „AI napisało całość". Trzeba to obramować.
5. **Katalog główny zaśmiecony** — 8 plików .md, w tym 4 prompty robocze. Wygląda na warsztat, nie na produkt.

**Nie odpuści:** repozytorium na GitHubie ze zrzutami w README.

---

## Faza 2 — dyskusja

### Runda 1 — propozycje (max 2 na osobę)

- **Kuba:** (A) rekordy toru + duch najlepszego przejazdu; (B) licznik nitro widoczny na HUD.
- **Ola:** (C) pierwszy wyścig to WYŚCIG, nie rysowanie; (D) krótki ekran „jak grać" przed pierwszym wyścigiem.
- **Marek:** (E) trwała progresja — osobiste rekordy per tor zapisane w bazie; (F) biblioteka narysowanych torów „zagraj mapę znajomego".
- **Ewa:** (G) zdalne repo + działające CI; (H) wydzielić pierwszy moduł z `game.js` z testami klienta.
- **Tomek:** (I) harness obciążeniowy: 6–8 realnych klientów WebSocket naraz, pomiar pod obciążeniem; (J) profil słabego sprzętu w telemetrii.
- **Agnieszka:** (K) repo na GitHubie + zrzuty w README; (L) sprzątnąć katalog główny, obramować wkład autora.

### Runda 2 — atak

- **Tomek → Kuba (A):** duch najlepszego przejazdu to dodatkowy strumień pozycji do rysowania co klatkę. Ile to kosztuje przy 8 autach? Jak nie zmierzysz, dokładasz obciążenie do gry, która nie wie, czy uniesie 8 graczy. → *Kuba: duch jest lokalny, jeden, odtwarzany z nagrania, nie z sieci — koszt to jedno auto więcej w renderze, nie w ruchu. Ale zgoda: bez pomiaru Tomka to ryzyko.*
- **Ewa → Marek (E, F):** progresja i biblioteka torów to nowa mechanika w `game.js` i nowe tabele. Dokładasz do pliku bez testów. Najpierw (G/H), potem twoje rzeczy. → *Marek: rekordy per tor to głównie serwer i baza — mało klienta. Ale biblioteka torów faktycznie dotyka klienta mocno; wycofuję (F) na później.*
- **Ola → Kuba (A) i Marek (E):** wy budujecie dla siebie. Duch i rekordy nie zatrzymają znajomego, który odpadł, bo pierwszy ekran kazał mu rysować. Najpierw (C). → *Kuba i Marek: zgoda co do kolejności — (C) jest tańsze i pilniejsze.*
- **Marek → Agnieszka (K, L):** repo i zrzuty to makijaż na grze, do której nikt nie wraca. → *Agnieszka: makijaż, którego brak kosztuje CIEBIE pracę — bez repo cała reszta jest niewidzialna. To nie zamiast rozgrywki, to warunek jej pokazania. Ewa: repo to też jedyne ubezpieczenie przed utratą kodu — to nie kosmetyka.*
- **Tomek → Ewa (H):** wydzielenie modułu z 2417 linii bez testów klienta to ryzyko regresji w grze na żywo. Sam to odłożyłeś w PLAN-naprawy. → *Ewa: dlatego (H) idzie RAZEM z pierwszymi testami klienta, nie samo. Ale przyznaję: to najdroższa i najbardziej ryzykowna pozycja z całej listy.*
- **Agnieszka → Tomek (I):** harness obciążeniowy to super dowód na rozmowę, ale czy autor będzie miał 8 osób do testu na żywo? → *Tomek: harness to zautomatyzowane klienty, nie ludzie — dlatego ma sens. Odpalam 8 procesów, mierzę serwer. To jedyny sposób, żeby w ogóle poznać zachowanie przy 8 przed prawdziwą sesją.*
- **Ola → (D) sama na siebie:** ekran „jak grać" może być kolejną przeszkodą przed zabawą. → *Zgoda: zamiast osobnego ekranu, krótka podpowiedź na ekranie wyboru auta. Łączę (D) z (C).*

### Runda 3 — decyzja (waga wydajności ×2, koszt i ryzyko odejmowane)

| # | propozycja | gracze | wyd.×2 | portfolio | koszt− | ryzyko− | SUMA |
|---|---|---|---|---|---|---|---|
| C+D | pierwszy wyścig = wyścig + podpowiedź | 3 | 0 | 1 | −1 | −0 | **3** |
| I | harness obciążeniowy 6–8 klientów + pomiar | 1 | 6 | 2 | −1 | −0 | **8** |
| G | zdalne repo + działające CI | 0 | 0 | 3 | −1 | −0 | **2** |
| K | zrzuty w README + sprzątanie katalogu | 0 | 0 | 3 | −1 | −0 | **2** |
| E | osobiste rekordy per tor (serwer+baza) | 3 | 0 | 1 | −1 | −1 | **2** |
| A | rekordy toru + duch | 2 | −1 | 1 | −2 | −1 | **−1** |
| H | wydzielić moduł z game.js + testy klienta | 0 | 1 | 2 | −3 | −2 | **−2** |
| B | licznik nitro na HUD | 2 | 0 | 0 | −1 | 0 | **1** |

**Wybrane cele (3–5 o najwyższym wyniku, plus jeden warunkowy):**

**Cel 1 (I, wynik 8) — Harness obciążeniowy i pomiar przy 6–8 klientach.**
Kryterium ukończenia: uruchomić ≥6 jednoczesnych klientów WebSocket wysyłających
pozycje z realistyczną częstotliwością; zmierzyć na serwerze medianę i p95 czasu
rozgłaszania stanu oraz przepustowość; wynik zapisany w raporcie z liczbami.
Wybronił: Tomek (głos ×2). Przeciw: Agnieszka („czy będzie 8 ludzi") — przegrała,
bo harness używa botów, nie ludzi.

**Cel 2 (C+D, wynik 3) — Pierwszy wyścig nowej grupy to wyścig, nie rysowanie; podpowiedź sterowania na ekranie auta.**
Kryterium: nowa sesja startuje od toru generowanego (`drawn_next=False` na starcie);
rysowanie wchodzi dopiero w kolejnych rundach; na ekranie wyboru auta widoczna
jednolinijkowa podpowiedź (gaz/hamulec/boost/głos). Test serwera na kolejność rund.
Wybroniła: Ola. Przeciw: nikt zasadniczo — najtańszy duży zysk dla grających.

**Cel 3 (E, wynik 2) — Osobiste rekordy per tor.**
Kryterium: po wyścigu serwer zapisuje najlepszy czas gracza (po kluczu) dla danej
nazwy toru; przy starcie wyścigu gracz widzi swój rekord na tym torze albo „nowy tor".
Coś, co przeżywa wyścig — spełnia żądanie Marka i Kuby minimalnym kosztem (serwer+baza,
prawie bez klienta). Przeciw: Ewa („nowa mechanika") — przegrała, bo to głównie serwer.

**Cel 4 (G, wynik 2) — Higiena rankingu + przygotowanie repo.**
Kryterium: ranking pokazuje tylko wyniki z kluczem gracza i w sensownych widełkach
czasu (odcięcie fikcyjnych 2,4 s); 297 wierszy-śmieci przestaje zaśmiecać tabelę
(bez kasowania — filtr w zapytaniu); README dostaje wyraźną notę o wkładzie autora
i porządek w katalogu głównym. Repo na GitHubie — **wymaga konta autora, więc
przygotuję wszystko i zostawię jedną komendę do wykonania.**
Wybronili: Agnieszka + Marek (czysty ranking) + Ewa (ubezpieczenie). Przeciw: nikt.

**Świadomie odrzucone:**
- **A (duch)** i **H (podział game.js)** — najdroższe i najbardziej ryzykowne, ujemny wynik. Wracamy po testach klienta.
- **F (biblioteka torów)** — Marek sam wycofał, za dużo klienta.
- **B (licznik nitro)** — drobiazg, zmieści się przy okazji Celu 3 jeśli starczy miejsca, ale nie jest celem.

---

## Do decyzji autora

Przed Fazą 3 potrzebuję zgody. Cztery cele, kolejność wykonania:
**1. Harness wydajności → 2. Pierwszy wyścig = wyścig → 3. Rekordy per tor → 4. Higiena rankingu + repo.**

Cel 4 w części „repo na GitHubie" wymaga Twojego konta — resztę zrobię, a na końcu
dam Ci jedną komendę do wklejenia.
