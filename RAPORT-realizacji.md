# Raport z realizacji — cele 1, 2, 3

Data: 2026-09-15. Cel 4 wstrzymany na życzenie autora.

## 1. Tabela celów

| cel | kryterium | przed | po | spełniony |
|---|---|---|---|---|
| **1. Harness wydajności** | ≥6 klientów, zmierzone med/p95 broadcast + kB/s | gra nigdy nie miała >2 graczy; „8 graczy" = arytmetyka | 8 botów zmierzone: broadcast p95 **1,87 ms**, kB/s **119,6** | ✅ |
| **2. Pierwszy wyścig = wyścig** | świeża sesja od toru generowanego; podpowiedź sterowania | pierwsza runda = rysowanie toru w 45 s | `drawn_next=False`; podpowiedź na ekranie auta; 3 testy | ✅ |
| **3. Rekordy per tor** | serwer zapisuje najlepszy czas po kluczu; gracz widzi rekord na starcie | wygrana nie zostawiała śladu | tabela `records`, `record_info`/`record_result`, 6 testów | ✅ |

Testy: **45 → 51** (dodane 3 + 6). Wszystkie zielone.

## 2. Czego NIE zrobiłem (wprost)

- **Cel 4 (higiena rankingu + repo)** — wstrzymany na Twoje polecenie. Ranking wciąż
  pokazuje 297 wierszy sprzed trybu gościa, w tym „Janek 104/104, rekord 2,4 s".
- **Nie połączyłem rekordów z rankingiem** — rekordy per tor żyją obok globalnej
  tabeli wyników, która nadal jest zaśmiecona (to Cel 4).

## 3. Czego NIE zweryfikowałem

- **Cel 1 mierzy tylko localhost.** Nie mierzy tunela Cloudflare, realnej sieci ani
  telefonów. Dowodzi jednego: serwerowe rozgłaszanie nie zatyka się przy 8 graczach.
  Prawdziwym ograniczeniem będzie łącze (120 kB/s × odbiorcy z domowego up-linku).
- **Część gap p95 ~58 ms to konkurencja botów o pętlę harnessu**, nie wina serwera —
  wszystkie boty w jednym procesie. Prawdziwi gracze mają osobne maszyny.
- **Rekordów nie widziałem w grze wizualnie** — potwierdzone przez WS (bot dostał
  `record_info` i `record_result`), ale nie oglądałem toastów na ekranie.
- **Podpowiedzi sterowania nie testowałem na telefonie** — tylko desktop.

## 4. Co przegrało w dyskusji, a warto wrócić

- **Duch najlepszego przejazdu (Kuba)** — odrzucony jako drogi i ryzykowny wydajnościowo.
  Teraz, gdy rekordy per tor istnieją, duch jest naturalnym następnym krokiem.
- **Podział `game.js` + testy klienta (Ewa)** — najdroższy, odłożony. Wciąż realny
  hamulec: plik ma 2417+ linii i zero testów. Każdy kolejny cel dokłada do niego.
- **Biblioteka narysowanych torów (Marek)** — wycofana, za dużo klienta.

## 5. Jedno zdanie od każdej osoby

- **Kuba:** „Rekordy dają mi wreszcie z kim się ścigać — ze sobą; teraz chcę ducha."
- **Ola:** „Pierwszy ekran to już wyścig i wiem, którym klawiszem jadę — zostałabym."
- **Marek:** „Rekord to pierwszy ślad, który przeżywa wyścig; retencji jeszcze nie
  udowodniliśmy, ale jest fundament."
- **Ewa:** „Cele zrobione głównie na serwerze, `game.js` nietknięty — dobrze, ale
  dług klienta rośnie i kiedyś trzeba go spłacić."
- **Tomek:** „Pierwszy raz mamy LICZBY zamiast domysłów: serwer trzyma 8 graczy z
  zapasem. Teraz chcę to samo zmierzone przez tunel."
- **Agnieszka:** „Harness i rekordy to dobry materiał na rozmowę — ale dopóki nie ma
  repo na GitHubie (Cel 4), rekruter tego nie zobaczy."
