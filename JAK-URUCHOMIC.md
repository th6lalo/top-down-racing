# Jak odpalić i zatrzymać grę

Wszystkie komendy odpalasz w Terminalu. Zawsze zacznij od wejścia do katalogu gry:

```bash
cd /Users/janek/Races
```

---

## Gram sam

```bash
./run.sh
```

Otwórz **http://localhost:8000**. Tyle. Tunel jest niepotrzebny.

---

## Gram ze znajomymi

Potrzebne są **dwa okna Terminala**, bo tunel zajmuje swoje okno na stałe.

**Okno 1 — serwer:**

```bash
cd /Users/janek/Races && ./run.sh
```

**Okno 2 — tunel:**

```bash
cd /Users/janek/Races && ./tunnel.sh
```

Po kilku sekundach w oknie 2 pojawi się w ramce adres w rodzaju
`https://cos-tam-cos-tam.trycloudflare.com`. **Ten adres wysyłasz znajomym.**

⚠️ **Adres jest losowany za każdym razem.** Po każdym zatrzymaniu tunelu
poprzedni link przestaje działać i trzeba rozesłać nowy.

Okno 2 zostaw otwarte na czas grania. **Ctrl+C** w nim kończy tunel.

---

## Koniec grania

```bash
cd /Users/janek/Races && ./stop.sh
```

Zatrzymuje **i serwer, i tunel** naraz. Można to odpalić w każdej chwili,
nawet jeśli akurat nic nie działa — nic nie zepsuje.

---

## Sprawdzenie, czy coś działa

```bash
pgrep -fl "uvicorn server:app|cloudflared tunnel"
```

Pusto = nic nie działa. Dwie linijki = serwer i tunel chodzą.

Gdyby serwer nie wstał, `run.sh` sam pokaże koniec logu. Cały log:

```bash
tail -30 /Users/janek/Races/server.log
```

---

## Rzeczy, które warto wiedzieć

**Nie odpalaj serwera kilka razy „na zapas".** `run.sh` sam ubija starą
instancję przed startem, więc ponowne odpalenie jest bezpieczne — ale
uruchamianie uvicorna ręcznie, obok, potrafiło zamulić laptopa.

**Twój dostawca internetu nie rozwiązuje adresów `trycloudflare.com`.**
Sprawdzone: resolwer ISP zwraca NXDOMAIN, a 1.1.1.1 i 8.8.8.8 zwracają
poprawny adres. Znajomym link zadziała, ale **Tobie może nie** — wtedy albo
graj przez `localhost:8000`, albo włącz w Chrome bezpieczny DNS
(`chrome://settings/security` → na dole „Używaj bezpiecznego DNS" →
wybierz Cloudflare 1.1.1.1).

**Po zmianach w kodzie** wystarczy `./run.sh` — sam restartuje serwer.
Znajomi powinni odświeżyć stronę twardo: **Cmd+Shift+R** (Mac),
**Ctrl+Shift+R** (Windows).

---

## Testy (jeśli grzebiesz w kodzie)

```bash
cd /Users/janek/Races && ./.venv/bin/pytest tests/ -q
```

Powinno wyjść `42 passed`. Jeśli coś pada — coś się zepsuło w tym, co
testy pilnują (walidatory torów albo sprawdzanie danych od klienta).
