"""
Serwer wyścigów multiplayer. FastAPI + uvicorn. Front statyczny + WebSocket /ws.

Przebieg rundy (jeden wspólny pokój):
  faza "drawing" — losowy gracz rysuje linię trasy, reszta czeka;
  faza "racing"  — jazda po torze, pierwszy na mecie wygrywa.
Źródło mapy zmienia się NA PRZEMIAN: raz rysowana przez gracza, raz losowa.
Kto dołączy w trakcie wyścigu — jest widzem (spectator) i wchodzi do gry
dopiero w następnej rundzie.

Model nieautorytatywny, oparty na zaufaniu (świadomie — to hobby).
"""

import asyncio
import itertools
import json
import os
import math
import random
import ssl
import re
import time
import ipaddress
import socket
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager

import certifi

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import db
from track import (random_track, track_from_line, reachable, centerline_ok,
                   dodaj_panele, WORLD)

players: dict[int, dict] = {}
connections: dict[int, WebSocket] = {}
_id = itertools.count(1)

phase = "idle"              # "idle" | "drawing" | "racing"
current_track: dict | None = None
drawer_id: int | None = None
winner: dict | None = None
drawn_next = False          # PIERWSZA runda nowej sesji to WYŚCIG, nie rysowanie —
                            # nowy gracz najpierw musi zrozumieć, że to gra wyścigowa
                            # (potem naprzemiennie: wyścig, rysowanie, wyścig...)
_draw_task: asyncio.Task | None = None
_lobby_task: asyncio.Task | None = None
race_id = 0                 # „pieczątka" rundy — zadania ze starej rundy są ignorowane
race_started_at = 0.0       # monotoniczny czas startu wyścigu (do liczenia czasów)
finish_order: list[int] = []  # kolejność dojazdów do mety w bieżącym wyścigu
lock = asyncio.Lock()

BROADCAST_HZ = 30
PERF = os.environ.get("RACES_PERF") == "1"   # pomiar wydajności rozgłaszania
_perf = {"ms": [], "bytes": 0, "since": None}
# Górna granica przekazywania głosu. MUSI być >= maksimum suwaka „zasięg głosu"
# u klienta (2200 px), inaczej serwer uciąłby głos, który klient chciałby jeszcze
# słyszeć — i wyszłoby „czasem słychać, czasem nie" bez widocznej przyczyny.
VOICE_MAX_DIST = 2200
VOICE_MAX_DIST_SQ = VOICE_MAX_DIST ** 2
DRAW_SECONDS = 45           # ile czasu ma rysujący


def drawer_name() -> str:
    p = players.get(drawer_id or -1)
    return p["name"] if p else f"Gracz{drawer_id}"


def spawn(p: dict):
    if current_track:
        s = current_track["start"]
        p["x"], p["y"], p["angle"] = s["x"], s["y"], s["angle"]
    else:
        p["x"], p["y"], p["angle"] = 0, 0, 0


busy: set[int] = set()          # zaległa wysyłka STANU (pomijanie starych klatek)
voice_busy: set[int] = set()    # zaległa wysyłka GŁOSU — osobno, żeby stan gry
                                # (30 pakietów/s) nie kasował próbek dźwięku


async def _send_one(pid: int, ws: WebSocket, msg: dict, drop_if_busy: bool):
    """Wyślij do jednego gracza. Wolny klient NIE blokuje pozostałych —
    zaległe pakiety stanu są pomijane (i tak byłyby nieaktualne)."""
    if drop_if_busy and pid in busy:
        return
    busy.add(pid)
    try:
        await ws.send_json(msg)
    except Exception:
        connections.pop(pid, None)
        players.pop(pid, None)
    finally:
        busy.discard(pid)


async def _send_bytes_one(pid: int, ws: WebSocket, data: bytes):
    voice_busy.add(pid)
    try:
        await ws.send_bytes(data)
    except Exception as e:
        # Wcześniej gracz znikał tu po cichu i nie było jak dojść, dlaczego
        # komuś „urwało głos" — a to jedyne miejsce, gdzie odpada przez głos.
        print(f"[głos] utracono połączenie {pid}: {type(e).__name__}", flush=True)
        connections.pop(pid, None)
        players.pop(pid, None)
    finally:
        voice_busy.discard(pid)


async def broadcast(msg: dict, drop_if_busy: bool = False):
    """Rozsyłka RÓWNOLEGŁA — jeden zapchany klient nie zatrzymuje reszty."""
    conns = list(connections.items())
    if not conns:
        return
    if PERF:
        t0 = time.perf_counter()
    await asyncio.gather(
        *[_send_one(pid, ws, msg, drop_if_busy) for pid, ws in conns],
        return_exceptions=True,
    )
    if PERF:
        # Pomiar TYLKO gdy RACES_PERF=1 — na produkcji ta gałąź się nie wykonuje.
        # Mierzy realny czas rozgłoszenia jednej klatki stanu do wszystkich klientów.
        _perf["ms"].append((time.perf_counter() - t0) * 1000.0)
        try:
            _perf["bytes"] += len(json.dumps(msg)) * len(conns)
        except Exception:
            pass


def cancel_round_tasks(reason: str = ""):
    """Anuluj zadania z poprzedniej fazy (powrót do lobby, limit rysowania)."""
    global _draw_task, _lobby_task
    for name in ("_draw_task", "_lobby_task"):
        t = globals()[name]
        if t and not t.done():
            t.cancel()
        globals()[name] = None
    if reason:
        print(f"[runda {race_id}] anulowano zaległe zadania: {reason}", flush=True)


def new_round(reason: str) -> int:
    """Rozpocznij nową rundę: nowa pieczątka + sprzątnięcie starych zadań."""
    global race_id
    race_id += 1
    cancel_round_tasks(reason)
    print(f"[runda {race_id}] START: {reason}", flush=True)
    return race_id


# Generowanie toru trwa ~0,5-0,8 s. Liczone w pętli zdarzeń ZAMRAŻA cały serwer
# (ping graczy skakał do sekund). Dlatego: liczymy w wątku i trzymamy pulę gotowych.
track_pool: list = []
POOL_SIZE = 2
_pool_task: asyncio.Task | None = None


async def refill_pool():
    """Dogeneruj tory w tle, żeby start rundy był natychmiastowy."""
    while len(track_pool) < POOL_SIZE:
        t = await asyncio.to_thread(random_track)
        track_pool.append(t)


def ensure_pool():
    global _pool_task
    if _pool_task is None or _pool_task.done():
        _pool_task = asyncio.create_task(refill_pool())


async def next_track():
    """Weź gotowy tor z puli (natychmiast) albo wygeneruj w wątku (bez blokowania)."""
    if track_pool:
        t = track_pool.pop(0)
        ensure_pool()
        return t
    t = await asyncio.to_thread(random_track)
    ensure_pool()
    return t


def joined_ids():
    return [pid for pid, p in players.items() if p.get("joined")]


def lobby_payload():
    return {
        "type": "lobby_state",
        "phase": phase,
        "players": [
            {"id": p["id"], "name": p["name"], "color": p["color"],
             "body": p.get("body", "sport"), "smoke": p.get("smoke", "#cfcfcf"),
             "ready": bool(p.get("ready"))}
            for p in players.values() if p.get("joined")
        ],
    }


def roster_payload():
    """Dane graczy, które SIĘ NIE ZMIENIAJĄ w trakcie wyścigu. Wcześniej leciały
    w każdym pakiecie stanu — 30 razy na sekundę, do każdego gracza. Przy ośmiu
    graczach to była większość ruchu sieciowego, całkowicie niepotrzebnie."""
    return {
        "type": "roster",
        "players": [
            {"id": p["id"], "name": p["name"], "color": p["color"],
             "body": p.get("body", "sport"), "smoke": p.get("smoke", "#cfcfcf")}
            for p in players.values() if p.get("joined")
        ],
    }


async def send_roster():
    await broadcast(roster_payload())


async def send_lobby():
    await broadcast(lobby_payload())


async def to_lobby(reason: str = "?"):
    """Wróć do lobby i wyzeruj gotowości (po wyścigu albo gdy nie ma z kim grać)."""
    global phase, winner, drawer_id
    print(f"[runda {race_id}] KONIEC WYŚCIGU -> lobby, powód: {reason}", flush=True)
    cancel_round_tasks("powrót do lobby")
    phase = "lobby"
    winner = None
    drawer_id = None
    for p in players.values():
        p["ready"] = False
        p["active"] = False
        p["spectator"] = False
    await send_lobby()


async def _back_to_lobby_soon(rid: int, delay: float = 8.0):
    """Po ogłoszeniu zwycięzcy pokaż chwilę wynik, potem wróć do lobby.
    Działa TYLKO dla swojej rundy — inaczej stare zadanie ubiłoby nową."""
    try:
        await asyncio.sleep(delay)
    except asyncio.CancelledError:
        return
    async with lock:
        if rid != race_id:
            print(f"[runda {race_id}] zignorowano powrót do lobby ze starej rundy {rid}", flush=True)
            return
        if phase == "racing":
            await to_lobby(f"koniec rundy {rid} po ogłoszeniu zwycięzcy")


async def maybe_start():
    """Start dopiero, gdy WSZYSCY obecni w lobby są gotowi (min. 1 gracz)."""
    ids = joined_ids()
    if not ids:
        return False
    if all(players[i].get("ready") for i in ids):
        await start_round()
        return True
    return False


async def start_round():
    """Zdecyduj o źródle mapy (naprzemiennie) i rozpocznij rundę."""
    global drawn_next, phase
    if not joined_ids():
        phase = "idle"
        return
    do_draw = drawn_next
    drawn_next = not drawn_next
    if do_draw:
        await start_drawing()
    else:
        await start_race(await next_track())


async def start_drawing():
    global phase, drawer_id, winner, _draw_task
    ids = joined_ids()
    if not ids:
        phase = "idle"
        return
    winner = None
    new_round("rysowanie trasy")
    phase = "drawing"
    drawer_id = random.choice(ids)
    await broadcast({
        "type": "draw_start",
        "drawer_id": drawer_id,
        "drawer_name": drawer_name(),
        "world": WORLD,
        "seconds": DRAW_SECONDS,
    })
    _draw_task = asyncio.create_task(_draw_timeout(race_id))


async def _draw_timeout(rid: int):
    """Rysujący nie zdążył → awaryjnie mapa losowa (tylko dla swojej rundy)."""
    try:
        await asyncio.sleep(DRAW_SECONDS + 2)
    except asyncio.CancelledError:
        return
    async with lock:
        if rid != race_id or phase != "drawing":
            return
        await start_race(await next_track())


async def start_race(track: dict):
    global phase, current_track, winner, drawer_id, _draw_task, race_started_at, finish_order
    if phase != "drawing":          # przy mapie rysowanej pieczątkę nadał start_drawing
        new_round("wyścig na torze generowanym")
    else:
        cancel_round_tasks("start wyścigu")
    current_track = track
    winner = None
    drawer_id = None
    phase = "racing"
    finish_order = []
    race_started_at = time.monotonic()
    db.save_track(track, "drawn" if track.get("name") == "Rysowana" else "random")  # archiwum torów
    for p in players.values():          # wszyscy ZALOGOWANI wchodzą do wyścigu
        if p.get("joined"):
            p["active"], p["spectator"], p["done"] = True, False, False
            spawn(p)
        else:
            p["active"] = False
    await send_roster()          # świeży skład zanim polecą pakiety stanu
    await broadcast({"type": "race_start", "track": track})


# Pola, które klient mierzy u siebie. Reszta kolumn pochodzi z serwera.
_TEL_OD_KLIENTA = ("czas_s", "fps_med", "fps_p05", "fps_min", "klatka_max",
                   "zaciec", "zaciec_min", "ping_med", "ping_p95", "ping_max",
                   "jitter", "kbps_in", "kbps_out", "jakosc_min", "jakosc_sr",
                   "mobil", "rdzenie", "ekran", "przegladarka")
_TEL_TEKST = ("ekran", "przegladarka")


def _liczba(v, domyslna):
    """Zamień na float tylko jeśli wynik jest skończoną liczbą. NaN i nieskończoność
    odrzucamy — inaczej trafiają do pakietu stanu i psują matematykę u wszystkich."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return float(domyslna)
    return f if math.isfinite(f) else float(domyslna)


def _punkty_mapy(surowe, limit=400):
    """Punkty rysowanej trasy od klienta. Obcinamy PRZED konwersją (inaczej milion
    punktów to milion konwersji), a błędne wpisy pomijamy zamiast wywracać
    obsługę połączenia."""
    if not isinstance(surowe, list):
        return []
    out = []
    for para in surowe[:limit]:
        if not isinstance(para, (list, tuple)) or len(para) != 2:
            continue
        x, y = _liczba(para[0], float("nan")), _liczba(para[1], float("nan"))
        if math.isfinite(x) and math.isfinite(y):
            out.append([x, y])
    return out


def _meta_odrzucona(p):
    """Czy zgłoszenie mety jest wiarygodne? Zwraca powód odrzucenia albo None.

    Serwer wierzył wcześniej na słowo — klient testowy wygrywał w 0,33 s nie
    ruszając się z miejsca. Sprawdzamy dwie rzeczy, których nie da się obejść
    samym wysłaniem komunikatu:
      1. gracz musi FAKTYCZNIE stać w prostokącie mety (wg pozycji, którą sam
         raportował — a ta jest już ograniczona do rozmiaru mapy),
      2. czas nie może być krótszy, niż fizycznie da się przejechać dystans
         start-meta przy maksymalnej prędkości z boostem.

    To nie jest pełny antycheat — ten wymagałby liczenia fizyki na serwerze.
    Podnosi jednak poprzeczkę z „wyślij jeden pakiet" do „symuluj wiarygodny przejazd".
    """
    if not current_track:
        return "brak toru"
    f = current_track.get("finish") or {}
    mgn = 90.0                       # zapas na promień auta i opóźnienie sieci
    x, y = p.get("x", 0.0), p.get("y", 0.0)
    if not (f["x"] - mgn <= x <= f["x"] + f["w"] + mgn and
            f["y"] - mgn <= y <= f["y"] + f["h"] + mgn):
        return f"gracz nie jest przy mecie ({x:.0f},{y:.0f})"
    st = current_track.get("start") or {}
    dyst = math.hypot(f["x"] + f["w"] / 2 - st.get("x", 0), f["y"] + f["h"] / 2 - st.get("y", 0))
    min_czas = dyst / 1000.0         # 1000 px/s = hojnie powyżej maksimum z boostem
    uplynelo = time.monotonic() - race_started_at
    if uplynelo < min_czas:
        return f"czas {uplynelo:.2f}s poniżej fizycznego minimum {min_czas:.2f}s"
    return None


def build_drawn_track(pts):
    """Zbuduj i zwaliduj trasę z rysunku gracza. None = odrzucona."""
    if len(pts) < 2:
        return None
    t = track_from_line("Rysowana", pts)
    if not reachable(t) or not centerline_ok(t):
        return None
    return dodaj_panele(t, random.Random())   # trasy rysowane też dostają panele nitro


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    task = asyncio.create_task(state_broadcaster())
    ensure_pool()                      # przygotuj tory zawczasu
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def no_cache(request, call_next):
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp


async def state_broadcaster():
    interval = 1.0 / BROADCAST_HZ
    while True:
        if not connections:            # nikt nie gra → budź się rzadko, nie 30x/s
            await asyncio.sleep(0.5)
            continue
        await asyncio.sleep(interval)
        # drop_if_busy: gracz z zapchanym łączem opuszcza klatkę stanu zamiast
        # budować kolejkę (stara pozycja i tak jest bezużyteczna).
        await broadcast({
            "type": "state",
            "players": [
                # tylko dane ZMIENNE — reszta przychodzi raz, w komunikacie "roster"
                {"id": p["id"], "level": p.get("level", 0),
                 "x": round(p["x"], 1), "y": round(p["y"], 1), "angle": round(p["angle"], 3)}
                for p in players.values() if p.get("active")
            ],
        }, drop_if_busy=True)


@app.get("/perf")
async def perf_stats():
    """Statystyki rozgłaszania od ostatniego odczytu. Działa tylko z RACES_PERF=1."""
    import statistics
    ms = _perf["ms"]
    now = time.monotonic()
    okno = (now - _perf["since"]) if _perf["since"] else None
    out = {
        "aktywne": PERF,
        "probek": len(ms),
        "klientow": len(connections),
        "okno_s": round(okno, 2) if okno else None,
        "broadcast_ms_med": round(statistics.median(ms), 3) if ms else None,
        "broadcast_ms_p95": round(sorted(ms)[int(len(ms)*0.95)], 3) if len(ms) > 3 else None,
        "broadcast_ms_max": round(max(ms), 3) if ms else None,
        "kB_s": round(_perf["bytes"] / 1024 / okno, 1) if okno else None,
    }
    _perf["ms"] = []; _perf["bytes"] = 0; _perf["since"] = now
    return JSONResponse(out)


@app.get("/track")
async def get_track():
    return JSONResponse(current_track or {})


MAX_AUDIO = 15 * 1024 * 1024   # limit 15 MB

# Limity na JEDNEGO klienta. Pozycja leci ~60/s z kroku fizyki, ramka głosu
# ~50/s (20 ms PCM 16 kHz = 640 B), więc progi są z zapasem ponad normalną grę.
MAX_TEKST = 64 * 1024          # największy sensowny komunikat to mapa z 400 punktami
MAX_GLOS = 8 * 1024            # ramka głosu; normalna ma ~640 B
MAX_TEKST_NA_SEK = 150
MAX_BIN_NA_SEK = 120
PROG_ROZLACZENIA = 40          # tyle przekroczeń z rzędu i połączenie leci
_ssl_ctx = ssl.create_default_context(cafile=certifi.where())


@app.get("/proxy_audio")
async def proxy_audio(url: str):
    """Pobierz plik audio z BEZPOŚREDNIEGO linku (omija CORS przeglądarki).

    BEZPIECZEŃSTWO: bez sprawdzania adresu ten endpoint był skanerem sieci
    lokalnej — obcy człowiek z linkiem do gry mógł kazać temu serwerowi pukać
    do routera czy NAS-a w domu, a różne komunikaty błędu zdradzały, co tam żyje.
    Dlatego teraz:
      1. adres musi być http/https,
      2. nazwa hosta jest rozwiązywana i KAŻDY otrzymany adres IP musi być
         publiczny (odpada localhost, 10.*, 172.16-31.*, 192.168.*, 169.254.* itd.),
      3. przekierowania są zablokowane — inaczej publiczny adres mógłby
         przekierować na 127.0.0.1 już po sprawdzeniu,
      4. każdy błąd zwraca DOKŁADNIE TEN SAM komunikat, żeby odpowiedzi
         serwera nie dało się użyć do zgadywania, co działa w sieci.
    Zostaje teoretyczne ryzyko DNS rebinding (adres zmieniony między
    sprawdzeniem a połączeniem) — przy grze dla znajomych uznaję je za akceptowalne.
    """
    BLAD = {"error": "nie udało się pobrać pliku audio z tego adresu"}

    def adres_publiczny(host: str) -> bool:
        try:
            infos = socket.getaddrinfo(host, None)
        except Exception:
            return False
        if not infos:
            return False
        for info in infos:
            try:
                ip = ipaddress.ip_address(info[4][0])
            except ValueError:
                return False
            if (ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_multicast or ip.is_reserved or ip.is_unspecified):
                return False
        return True

    class BezPrzekierowan(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **kw):
            return None            # przekierowanie = koniec, nie idziemy dalej

    try:
        u = urllib.parse.urlparse(url)
    except Exception:
        return JSONResponse(BLAD, status_code=400)
    if u.scheme not in ("http", "https") or not u.hostname:
        return JSONResponse(BLAD, status_code=400)

    if not await asyncio.to_thread(adres_publiczny, u.hostname):
        print(f"[proxy_audio] odrzucony adres nie-publiczny: {u.hostname}", flush=True)
        return JSONResponse(BLAD, status_code=400)

    def fetch():
        opener = urllib.request.build_opener(BezPrzekierowan)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with opener.open(req, timeout=15) as r:
            return r.headers.get("Content-Type", ""), r.read(MAX_AUDIO + 1)

    try:
        ct, data = await asyncio.to_thread(fetch)
    except Exception:
        return JSONResponse(BLAD, status_code=502)          # bez szczegółów!
    if len(data) > MAX_AUDIO:
        return JSONResponse({"error": "plik za duży (>15 MB)"}, status_code=413)
    if not any(t in ct.lower() for t in ("audio", "octet-stream", "video/ogg", "video/mp4")):
        return JSONResponse(BLAD, status_code=415)
    return Response(content=data, media_type=ct or "audio/mpeg")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    global winner, phase, drawer_id, drawn_next, _lobby_task
    await ws.accept()
    pid = next(_id)
    connections[pid] = ws

    # Na razie tylko obserwator na ekranie wejścia — rola przyznawana przy "join".
    players[pid] = {"id": pid, "name": f"Gracz{pid}", "color": "#ff5555",
                    "body": "sport", "smoke": "#cfcfcf", "level": 0,
                    "joined": False, "active": False, "spectator": False,
                    "x": 0, "y": 0, "angle": 0}
    await ws.send_json({"type": "welcome", "id": pid})

    # Limity ruchu od JEDNEGO klienta. Bez nich jeden złośliwy gracz zapycha
    # łącze wszystkim: ramki głosowe są rozsyłane dalej, więc jego nadmiar
    # zamienia się w nadmiar u każdego. Liczniki zerują się co sekundę.
    okno = time.monotonic()
    ile_tekst = ile_bin = 0
    nadmiar = 0

    try:
        while True:
            raw = await ws.receive()
            if raw["type"] == "websocket.disconnect":
                break

            teraz = time.monotonic()
            if teraz - okno >= 1.0:
                # Licznik nadmiaru MUSI zerować się razem z oknem. Wcześniej tylko
                # rósł, więc 40 przekroczeń rozrzuconych przez całą sesję (np. przy
                # chwilowych skokach sieci) kończyło się rozłączeniem gracza,
                # który niczego złego nie robił.
                okno, ile_tekst, ile_bin, nadmiar = teraz, 0, 0, 0

            if raw.get("bytes") is not None:
                ile_bin += 1
                if len(raw["bytes"]) > MAX_GLOS or ile_bin > MAX_BIN_NA_SEK:
                    nadmiar += 1
                    if nadmiar > PROG_ROZLACZENIA:
                        print(f"[limit] rozłączam {pid} — uporczywy nadmiar", flush=True)
                        break
                    continue                       # pomiń tę ramkę, nie karz od razu
            elif raw.get("text") is not None:
                ile_tekst += 1
                if len(raw["text"]) > MAX_TEKST or ile_tekst > MAX_TEKST_NA_SEK:
                    nadmiar += 1
                    if nadmiar > PROG_ROZLACZENIA:
                        print(f"[limit] rozłączam {pid} — uporczywy nadmiar", flush=True)
                        break
                    continue
            # Głos = ramka binarna (surowy PCM). Doklej id nadawcy i roześlij dalej.
            b = raw.get("bytes")
            if b is not None:
                me_p = players.get(pid)
                if me_p and me_p.get("joined"):
                    out = pid.to_bytes(2, "little") + b
                    targets = []
                    for opid, ows in list(connections.items()):
                        if opid == pid:
                            continue
                        op = players.get(opid)
                        if not op or not op.get("joined"):
                            continue
                        # Wysyłaj tylko do tych w zasięgu słyszalności — reszta i tak
                        # nic nie usłyszy, a to zapycha łącze i opóźnia pozycje aut.
                        if phase == "racing":
                            dx = op.get("x", 0) - me_p.get("x", 0)
                            dy = op.get("y", 0) - me_p.get("y", 0)
                            if dx * dx + dy * dy > VOICE_MAX_DIST_SQ:
                                continue
                        if opid in voice_busy:  # poprzednia próbka jeszcze leci —
                            continue            # pomiń tę, ale NIE przez ruch stanu gry
                        targets.append((opid, ows))
                    if targets:
                        await asyncio.gather(
                            *[_send_bytes_one(op, ow, out) for op, ow in targets],
                            return_exceptions=True,
                        )
                continue
            txt = raw.get("text")
            if txt is None:
                continue
            msg = json.loads(txt)
            t = msg.get("type")

            if t == "join":
                p = players[pid]
                p["name"] = str(msg.get("name", p["name"]))[:20]
                p["color"] = str(msg.get("color", p["color"]))[:16]
                body = str(msg.get("body", "sport"))[:12]
                p["body"] = body if body in ("sport", "muscle", "van", "kart") else "sport"
                p["smoke"] = str(msg.get("smoke", p.get("smoke", "#cfcfcf")))[:16]
                # Tryb gościa: gra normalnie, ale jego wyniki NIE trafiają do bazy.
                # „klucz" to trwały identyfikator z przeglądarki gracza — dzięki niemu
                # ranking liczy się per gracz, a nie per nick (nick da się podszyć).
                p["gosc"] = bool(msg.get("guest", True))
                klucz = str(msg.get("klucz", ""))[:64]
                p["klucz"] = klucz if re.fullmatch(r"[A-Za-z0-9_-]{8,64}", klucz) else None
                if p["klucz"] is None:
                    p["gosc"] = True          # brak poprawnego klucza = gość, bez zapisu
                async with lock:
                    p["joined"] = True
                    p["ready"] = False
                    if phase == "racing":               # w trakcie wyścigu → widz
                        p["active"], p["spectator"] = False, True
                        await ws.send_json({"type": "joined", "phase": "racing",
                                            "spectator": True, "track": current_track,
                                            "winner": winner})
                    elif phase == "drawing":            # ktoś rysuje → czekaj na wyścig
                        p["active"], p["spectator"] = True, False
                        await ws.send_json({"type": "joined", "phase": "drawing",
                                            "spectator": False, "drawer_id": drawer_id,
                                            "drawer_name": drawer_name(), "world": WORLD,
                                            "draw_seconds": DRAW_SECONDS})
                    else:                               # idle/lobby → do LOBBY
                        phase = "lobby"
                        p["active"], p["spectator"] = False, False
                        await ws.send_json({"type": "joined", "phase": "lobby",
                                            "spectator": False})
                    await ws.send_json({"type": "leaderboard", "top": db.leaderboard(10)})
                    await send_lobby()
                    await send_roster()

            elif t == "pos":
                p = players.get(pid)
                if p and p.get("active") and phase == "racing":
                    # Klient podaje własną pozycję, więc MUSI być sprawdzona.
                    # float("nan") i float("inf") przechodzą bez mrugnięcia, a potem
                    # każde porównanie odległości z NaN daje fałsz — psuje to zasięg
                    # czatu i kolizje WSZYSTKIM graczom, nie tylko oszustowi.
                    x = _liczba(msg.get("x"), p["x"])
                    y = _liczba(msg.get("y"), p["y"])
                    a = _liczba(msg.get("angle"), p["angle"])
                    rozm = (current_track or {}).get("size") or WORLD
                    p["x"] = min(max(x, -200.0), float(rozm["w"]) + 200.0)
                    p["y"] = min(max(y, -200.0), float(rozm["h"]) + 200.0)
                    p["angle"] = a % (2 * math.pi)
                    p["level"] = 1 if msg.get("level") else 0

            elif t == "map":
                async with lock:
                    if phase == "drawing" and pid == drawer_id:
                        pts = _punkty_mapy(msg.get("points"))
                        # budowa i walidacja trasy z rysunku też potrafi potrwać — do wątku
                        t = await asyncio.to_thread(build_drawn_track, pts)
                        if t is None:
                            print("[mapa] rysowana trasa odrzucona -> tor generowany", flush=True)
                            t = await next_track()
                        await start_race(t)

            elif t == "telemetry":
                # Telemetria wydajności po wyścigu — wyłącznie na życzenie gracza.
                # Kontekst wyścigu (tor, liczba graczy) wypełnia SERWER, bo to
                # jego fakty; od klienta bierzemy tylko jego własne pomiary.
                p = players.get(pid)
                if p and p.get("joined") and current_track:
                    d = {k: _liczba(msg.get(k), None) if k not in _TEL_TEKST else
                         (str(msg.get(k))[:80] if msg.get(k) is not None else None)
                         for k in _TEL_OD_KLIENTA}
                    d.update({
                        "track": current_track.get("name"),
                        "track_typ": "labirynt" if current_track.get("maze") else "korytarz",
                        "mosty": int(current_track.get("bridges") or 0),
                        "graczy": sum(1 for q in players.values() if q.get("active")),
                        "nick": p["name"],
                        "klucz": p.get("klucz"),
                        "karoseria": p.get("body"),
                    })
                    await asyncio.to_thread(db.save_telemetry, d)
                    print(f"[telemetria] {p['name']}: FPS med {d.get('fps_med')}, "
                          f"zacięć {d.get('zaciec')}", flush=True)

            elif t == "finish":
                async with lock:
                    p = players.get(pid)
                    if p and p.get("active") and not p.get("done") and phase == "racing":
                        powod = _meta_odrzucona(p)
                        if powod:
                            print(f"[meta] odrzucona dla {p['name']}: {powod}", flush=True)
                            continue
                        p["done"] = True
                        finish_order.append(pid)
                        place = len(finish_order)
                        elapsed = round(time.monotonic() - race_started_at, 2)
                        tname = current_track.get("name") if current_track else None
                        if not p.get("gosc") and p.get("klucz"):
                            db.record(tname, p["name"], place, elapsed, p["klucz"])
                        else:
                            print(f"[gość] {p['name']} — wynik NIE zapisany", flush=True)
                        await broadcast({"type": "finished", "name": p["name"],
                                         "place": place, "time": elapsed})
                        if place == 1:
                            winner = {"id": pid, "name": p["name"]}
                            await broadcast({"type": "winner", **winner, "time": elapsed})
                            _lobby_task = asyncio.create_task(_back_to_lobby_soon(race_id))
                        await broadcast({"type": "leaderboard", "top": db.leaderboard(10)})

            elif t == "ready":
                async with lock:
                    p = players.get(pid)
                    if p and p.get("joined") and phase in ("lobby", "idle"):
                        p["ready"] = bool(msg.get("ready"))
                        await send_lobby()
                        await maybe_start()

            elif t == "ping":
                # Pomiar opóźnienia (telemetria) — odbij znacznik czasu klienta.
                try:
                    await ws.send_json({"type": "pong", "t": msg.get("t")})
                except Exception:
                    pass

            elif t == "reset":
                async with lock:
                    if phase == "racing":
                        await to_lobby(f"gracz {pid} kliknął powrót do lobby")


    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        was_drawer = (pid == drawer_id)
        connections.pop(pid, None)
        players.pop(pid, None)
        if not joined_ids():
            phase = "idle"
            winner = None
            drawer_id = None
            drawn_next = False         # świeża sesja zaczyna od WYŚCIGU (patrz komentarz u góry)
        elif was_drawer and phase == "drawing":
            async with lock:
                if phase == "drawing":
                    await start_race(await next_track())   # rysujący wyszedł → mapa losowa
        elif phase in ("lobby", "idle"):
            async with lock:                            # ktoś wyszedł z lobby —
                await send_lobby()                      # odśwież listę i sprawdź start
                await send_roster()
                await maybe_start()


app.mount("/", StaticFiles(directory="static", html=True), name="static")
