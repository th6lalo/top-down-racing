"""Harness obciążeniowy: N botów WebSocket gra jednocześnie, mierzymy serwer.

Cel 1 z OCENA-zespolu.md. Bez tego wszystko o „8 graczach" było arytmetyką —
gra nigdy nie widziała więcej niż 2. Boty dołączają, klikają gotów, jadą i wysyłają
pozycje z realistyczną częstotliwością (~31/s, jak sendPos w kliencie: co 32 ms).

Pomiar dwustronny:
- SERWER: /perf zwraca medianę/p95 czasu rozgłoszenia klatki stanu (env RACES_PERF)
- KLIENT: odstępy między odebranymi pakietami 'state' (jitter) i RTT ping/pong

Pułapka, której unikam (z listy w prompcie): pomiar w warunkach, które kłamią.
Bot NIE robi ciężkiej pracy per pakiet — tylko liczy czas — żeby nie zawyżać
opóźnień własnym obciążeniem. Serwer w osobnym procesie.
"""
import asyncio, json, time, statistics as st, urllib.request
import websockets

# URUCHOMIENIE:
#   RACES_PERF=1 RACES_DB=/tmp/perf.db ./.venv/bin/uvicorn server:app --port 8001 &
#   ./.venv/bin/python harness-obciazenie.py
# Serwer MUSI mieć RACES_PERF=1, inaczej /perf nie zbiera pomiarów.
URL = "ws://127.0.0.1:8001/ws"
PERF_URL = "http://127.0.0.1:8001/perf"


def czytaj_perf():
    with urllib.request.urlopen(PERF_URL, timeout=5) as r:
        return json.load(r)


async def bot(nr, sekundy, wynik):
    gaps, rtt = [], []
    ostatni_state = None
    async with websockets.connect(URL, max_size=2**20) as ws:
        mid = None
        await ws.send(json.dumps({"type": "join", "name": f"Bot{nr}", "color": "#38f",
                                  "body": "sport", "smoke": "#ccc", "guest": True,
                                  "klucz": f"bot{nr:02d}" + "x" * 16}))
        x = y = 500.0 + nr * 40
        jade = False
        t_koniec = time.monotonic() + sekundy + 8
        ostatni_ping = 0.0
        ostatni_pos = 0.0
        while time.monotonic() < t_koniec:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.05)
                if isinstance(raw, (bytes, bytearray)):
                    pass
                else:
                    m = json.loads(raw); t = m.get("type")
                    if t == "welcome":
                        mid = m.get("id")
                    elif t in ("joined", "lobby_state") and m.get("phase") in ("lobby", "idle"):
                        await ws.send(json.dumps({"type": "ready", "ready": True}))
                    elif t == "draw_start" and m.get("drawer_id") == mid:
                        await ws.send(json.dumps({"type": "map", "points": []}))
                    elif t == "race_start":
                        jade = True
                        tor = m.get("track") or {}
                        s = tor.get("start") or {}
                        x, y = s.get("x", x), s.get("y", y)
                    elif t == "pong":
                        rtt.append((time.monotonic() - m["t"]) * 1000.0)
                    elif t == "state":
                        teraz = time.monotonic()
                        if ostatni_state is not None:
                            gaps.append((teraz - ostatni_state) * 1000.0)
                        ostatni_state = teraz
            except asyncio.TimeoutError:
                pass

            teraz = time.monotonic()
            if jade and teraz - ostatni_pos >= 0.032:      # ~31/s jak w kliencie
                ostatni_pos = teraz
                x += 6.0; y += 2.0
                await ws.send(json.dumps({"type": "pos", "x": round(x, 1),
                                          "y": round(y, 1), "angle": 0.3, "level": 0}))
            if teraz - ostatni_ping >= 2.0:
                ostatni_ping = teraz
                await ws.send(json.dumps({"type": "ping", "t": teraz}))
    wynik[nr] = {"gaps": gaps, "rtt": rtt}   # (i tak zostawiamy — bot kończy sam)


async def przebieg(n, sekundy=12):
    wynik = {}
    boty = [asyncio.create_task(bot(i, sekundy, wynik)) for i in range(n)]
    # czekamy aż wszystkie zaczną jechać (lobby→[rysowanie]→wyścig)
    await asyncio.sleep(6)
    czytaj_perf()                        # RESET okna pomiaru serwera
    t0 = time.monotonic()
    await asyncio.sleep(sekundy)          # WŁAŚCIWE okno pomiaru
    perf = czytaj_perf()                  # odczyt serwera
    await asyncio.gather(*boty, return_exceptions=True)   # boty kończą SAME (t_koniec), zapisują wynik

    gaps = [g for w in wynik.values() for g in w["gaps"]]
    rtt = [r for w in wynik.values() for r in w["rtt"]]
    return {
        "n": n,
        "serwer_broadcast_ms_med": perf.get("broadcast_ms_med"),
        "serwer_broadcast_ms_p95": perf.get("broadcast_ms_p95"),
        "serwer_broadcast_ms_max": perf.get("broadcast_ms_max"),
        "serwer_kB_s": perf.get("kB_s"),
        "klient_state_gap_med": round(st.median(gaps), 1) if gaps else None,
        "klient_state_gap_p95": round(sorted(gaps)[int(len(gaps)*0.95)], 1) if len(gaps) > 3 else None,
        "klient_rtt_med": round(st.median(rtt), 1) if rtt else None,
        "klient_rtt_p95": round(sorted(rtt)[int(len(rtt)*0.95)], 1) if len(rtt) > 3 else None,
        "probek_gap": len(gaps), "probek_perf": perf.get("probek"),
    }


async def main():
    print(f"{'N':>3} | {'broadcast med':>13} | {'p95':>7} | {'max':>7} | {'serwer kB/s':>11} "
          f"| {'gap med':>7} | {'gap p95':>7} | {'RTT med':>7} | {'RTT p95':>7}")
    print("-" * 100)
    for n in (2, 4, 6, 8):
        w = await przebieg(n)
        print(f"{w['n']:>3} | {str(w['serwer_broadcast_ms_med']):>13} | "
              f"{str(w['serwer_broadcast_ms_p95']):>7} | {str(w['serwer_broadcast_ms_max']):>7} | "
              f"{str(w['serwer_kB_s']):>11} | {str(w['klient_state_gap_med']):>7} | "
              f"{str(w['klient_state_gap_p95']):>7} | {str(w['klient_rtt_med']):>7} | "
              f"{str(w['klient_rtt_p95']):>7}")
        await asyncio.sleep(1)
    print("\nCel 30 Hz => idealny odstęp pakietów stanu to 33,3 ms.")

asyncio.run(main())
