"""
Trasy jako dane. Dwa źródła map (na przemian w rozgrywce):

1) LOSOWA  — proceduralny labirynt (recursive-backtracker + braiding + „jitter"
   wierzchołków, żeby nie wyglądał idealnie kratkowo).
2) RYSOWANA — gracz rysuje jedną linię trasy; początek = START, koniec = META.
   Program obudowuje linię ścianami po obu stronach → korytarz (zawsze przejezdny).

Format toru:
  name, size{w,h}, start{x,y,angle}, finish{x,y,w,h}, walls[[x1,y1,x2,y2], ...]
"""

import math
import os
import random
from collections import deque

W, H = 6800, 3600      # większy świat — wyścigi ~45-90 s
M = 40
WORLD = {"w": W, "h": H}

_NAMES = ["Zaułki", "Stare Miasto", "Kanały", "Fabryka", "Wiadukt", "Katakumby",
          "Kręte Uliczki", "Pętla Widmo", "Doki", "Ronda", "Podziemia", "Obwodnica"]


def _frame():
    return [
        [M, M, W - M, M], [W - M, M, W - M, H - M],
        [W - M, H - M, M, H - M], [M, H - M, M, M],
    ]


def reachable(t, clr=24, cell=28):
    """Czy META jest osiągalna ze STARTU (z zapasem szerokości auta)?
    Uwzględnia MOSTY: BFS biegnie po dwóch poziomach (parter/most), a bramki
    przy rampach pozwalają przejść z jednego na drugi."""
    walls, f = t["walls"], t["finish"]
    gw = int(W / cell) + 1
    gh = int(H / cell) + 1
    blocked = [bytearray(gw * gh), bytearray(gw * gh)]     # [poziom0, poziom1]
    rad = max(1, int(math.ceil(clr / cell)))

    def mark(grid, px, py):
        gx, gy = int(px / cell), int(py / cell)
        for oy in range(-rad, rad + 1):
            for ox in range(-rad, rad + 1):
                cx, cy = gx + ox, gy + oy
                if 0 <= cx < gw and 0 <= cy < gh:
                    grid[cy * gw + cx] = 1

    for w in walls:
        x1, y1, x2, y2 = w[0], w[1], w[2], w[3]
        lv = w[4] if len(w) > 4 else 2                      # brak = blokuje zawsze
        grids = [blocked[0], blocked[1]] if lv == 2 else [blocked[lv]]
        d = math.hypot(x2 - x1, y2 - y1)
        steps = int(d / (cell * 0.5)) + 1
        for i in range(steps + 1):
            tt = i / steps
            for g in grids:
                mark(g, x1 + (x2 - x1) * tt, y1 + (y2 - y1) * tt)

    # bramki: komórki, w których wolno zmienić poziom
    switch = set()
    for g in t.get("gates", []):
        mx, my = (g["x1"] + g["x2"]) / 2, (g["y1"] + g["y2"]) / 2
        switch.add((int(mx / cell), int(my / cell)))

    sc = (int(t["start"]["x"] / cell), int(t["start"]["y"] / cell))
    gc = (int((f["x"] + f["w"] / 2) / cell), int((f["y"] + f["h"] / 2) / cell))
    if blocked[0][sc[1] * gw + sc[0]] or blocked[0][gc[1] * gw + gc[0]]:
        return False
    seen = [bytearray(gw * gh), bytearray(gw * gh)]
    seen[0][sc[1] * gw + sc[0]] = 1
    q = deque([(sc[0], sc[1], 0)])
    while q:
        cx, cy, lv = q.popleft()
        if (cx, cy) == gc and lv == 0:
            return True
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < gw and 0 <= ny < gh:
                k = ny * gw + nx
                if not seen[lv][k] and not blocked[lv][k]:
                    seen[lv][k] = 1
                    q.append((nx, ny, lv))
        if (cx, cy) in switch:                              # rampa: zmiana poziomu
            ol = 1 - lv
            k = cy * gw + cx
            if not seen[ol][k] and not blocked[ol][k]:
                seen[ol][k] = 1
                q.append((cx, cy, ol))
    return False


# ---------- 1) Losowy labirynt ----------

def _gen_maze(cols, rows, braid, jitter, rnd):
    key = lambda a, b: (a, b) if a <= b else (b, a)
    visited = [[False] * cols for _ in range(rows)]
    passages = set()
    NB = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    stack = [(0, rows - 1)]
    visited[rows - 1][0] = True
    while stack:
        cx, cy = stack[-1]
        opts = [(cx + dx, cy + dy) for dx, dy in NB
                if 0 <= cx + dx < cols and 0 <= cy + dy < rows and not visited[cy + dy][cx + dx]]
        if opts:
            nx, ny = rnd.choice(opts)
            passages.add(key((cx, cy), (nx, ny)))
            visited[ny][nx] = True
            stack.append((nx, ny))
        else:
            stack.pop()
    for cy in range(rows):
        for cx in range(cols):
            deg = sum(1 for dx, dy in NB
                      if 0 <= cx + dx < cols and 0 <= cy + dy < rows
                      and key((cx, cy), (cx + dx, cy + dy)) in passages)
            if deg <= 1 and rnd.random() < braid:
                closed = [(cx + dx, cy + dy) for dx, dy in NB
                          if 0 <= cx + dx < cols and 0 <= cy + dy < rows
                          and key((cx, cy), (cx + dx, cy + dy)) not in passages]
                if closed:
                    passages.add(key((cx, cy), rnd.choice(closed)))

    cw = (W - 2 * M) / cols
    ch = (H - 2 * M) / rows
    jmax = min(cw, ch) * jitter
    vj = {}

    def V(ix, iy):
        if (ix, iy) not in vj:
            if ix in (0, cols) or iy in (0, rows):
                vj[(ix, iy)] = (0.0, 0.0)      # brzegowe wierzchołki bez jittera
            else:
                vj[(ix, iy)] = (rnd.uniform(-jmax, jmax), rnd.uniform(-jmax, jmax))
        dx, dy = vj[(ix, iy)]
        return [M + ix * cw + dx, M + iy * ch + dy]

    walls = _frame()
    for cy in range(rows):
        for cx in range(cols - 1):
            if key((cx, cy), (cx + 1, cy)) not in passages:
                a, b = V(cx + 1, cy), V(cx + 1, cy + 1)
                walls.append([a[0], a[1], b[0], b[1]])
    for cy in range(rows - 1):
        for cx in range(cols):
            if key((cx, cy), (cx, cy + 1)) not in passages:
                a, b = V(cx, cy + 1), V(cx + 1, cy + 1)
                walls.append([a[0], a[1], b[0], b[1]])

    # META w CENTRUM labiryntu, START w losowym rogu (najdalej od środka).
    fcx, fcy = cols // 2, rows // 2
    scx, scy = rnd.choice([(0, 0), (cols - 1, 0), (0, rows - 1), (cols - 1, rows - 1)])
    sx, sy = M + (scx + 0.5) * cw, M + (scy + 0.5) * ch
    # zwróć auto w stronę otwartego przejścia z komórki startowej
    ang = 0.0
    for (dx, dy, a) in ((1, 0, 0.0), (-1, 0, math.pi), (0, 1, math.pi / 2), (0, -1, -math.pi / 2)):
        if 0 <= scx + dx < cols and 0 <= scy + dy < rows and \
           key((scx, scy), (scx + dx, scy + dy)) in passages:
            ang = a
            break
    start = {"x": round(sx), "y": round(sy), "angle": round(ang, 4)}
    fw, fh = cw * 0.5, ch * 0.5
    finish = {"x": round(M + fcx * cw + (cw - fw) / 2),
              "y": round(M + fcy * ch + (ch - fh) / 2), "w": round(fw), "h": round(fh)}
    # size to KOPIA — WORLD jest mutowany w miejscu przy każdej kolejnej generacji,
    # a tory z puli powstają z wyprzedzeniem i inaczej „przejęłyby" cudzy rozmiar.
    return {"name": None, "size": dict(WORLD), "start": start, "finish": finish,
            "walls": [w + [2] for w in walls],       # murki labiryntu blokują na każdym piętrze
            "maze": {"cols": cols, "rows": rows, "cw": cw, "ch": ch,
                     "start_cell": [scx, scy], "finish_cell": [fcx, fcy],
                     "passages": [[a[0], a[1], b[0], b[1]] for a, b in passages]}}



def maze_solve(t):
    """Najkrótsza trasa przez labirynt jako lista komórek (od startu do mety).
    Używane dwa razy: do oszacowania czasu wyścigu i do rozmieszczenia paneli
    nitro OBOK tej trasy — panel na trasie optymalnej byłby darmowy."""
    m = t.get("maze")
    if not m:
        return None
    P = set()
    for a, b, c, d in m["passages"]:
        P.add(((a, b), (c, d)))
        P.add(((c, d), (a, b)))
    cols, rows, cw, ch = m["cols"], m["rows"], m["cw"], m["ch"]
    s0, g0 = tuple(m["start_cell"]), tuple(m["finish_cell"])
    prev = {s0: None}
    q = deque([s0])
    while q:
        cur = q.popleft()
        if cur == g0:
            break
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (cur[0] + dx, cur[1] + dy)
            if 0 <= n[0] < cols and 0 <= n[1] < rows and (cur, n) in P and n not in prev:
                prev[n] = cur
                q.append(n)
    if g0 not in prev:
        return None
    cells, c = [], g0
    while c:
        cells.append(c)
        c = prev[c]
    cells.reverse()
    return cells


def maze_path_len(t):
    """Długość najkrótszej trasy przez labirynt (px) — do oszacowania czasu wyścigu."""
    cells = maze_solve(t)
    if not cells:
        return None
    m = t["maze"]
    return (len(cells) - 1) * (m["cw"] + m["ch"]) / 2   # średni krok między komórkami


AI_SPEED = 503          # px/s — zmierzona średnia prędkość przejazdu (kalibracja)
TARGET_S = (35, 70)     # czas AI; gracze są ~25-45% wolniejsi -> ~45-90 s


def _maze_track(rnd):
    # Siatka dobierana do rozmiaru mapy: komórka ~230 px (wygodny korytarz),
    # NIEPARZYSTE wymiary → komórka centralna dokładnie na środku mapy.
    odd = lambda v: v if v % 2 else v - 1
    cols = max(11, odd(int((W - 2 * M) / 230)))
    rows = max(7, odd(int((H - 2 * M) / 230)))
    name = rnd.choice(_NAMES)
    best, best_est = None, 1e9
    for _ in range(30):
        # mniej „splatania" = mniej skrótów = dłuższa wymuszona trasa do centrum
        t = _gen_maze(cols, rows, rnd.uniform(0.12, 0.35), rnd.uniform(0.04, 0.12), rnd)
        t["name"] = name
        if not reachable(t):
            continue
        L = maze_path_len(t)
        if L is None:
            continue
        est = L / AI_SPEED
        if TARGET_S[0] <= est <= TARGET_S[1]:      # tor w widełkach czasowych
            t["est_s"] = round(est)
            return t
        best = t if best is None or abs(est - 52) < abs(best_est - 52) else best
        best_est = min(abs(est - 52), best_est) if best is not t else abs(est - 52)
    if best is not None:
        best["name"] = name
        return best
    t["name"] = name
    return t


def _winding_points(rnd):
    """Kręta ścieżka start→meta z zakrętami pod RÓŻNYMI kątami (nie tylko 90°),
    o różnej długości i rozpiętości (różne rozmiary torów)."""
    m = 220
    corners = [(m, H - m), (m, m), (W - m, m), (W - m, H - m)]
    si = rnd.randrange(4)
    fi = (si + rnd.choice([1, 2, 3])) % 4
    sx, sy = corners[si]
    fx, fy = corners[fi]
    L = math.hypot(fx - sx, fy - sy) or 1
    ux, uy = (fx - sx) / L, (fy - sy) / L
    px, py = -uy, ux                        # kierunek prostopadły do osi start-meta
    n = rnd.randint(9, 16)                    # dużo zakrętów → dłuższe, bardziej kręte, wymagające
    fwd = L / n
    # krok boczny < postępu do przodu → trasa nie zawraca (brak samoprzecięć,
    # zawsze przejezdna i szybka do wygenerowania), a przy n=16 i tak mocno kręta.
    step = fwd * rnd.uniform(0.55, 0.85)
    max_lat = rnd.uniform(340, 950)           # większa rozpiętość → różne rozmiary
    ctrl = [[sx, sy]]
    lat = 0.0
    for i in range(1, n):
        t = i / n
        bx, by = sx + (fx - sx) * t, sy + (fy - sy) * t
        lat += rnd.uniform(-1, 1) * step
        lat = max(-max_lat, min(max_lat, lat))
        x = max(m * 0.5, min(W - m * 0.5, bx + px * lat))
        y = max(m * 0.5, min(H - m * 0.5, by + py * lat))
        ctrl.append([x, y])
    ctrl.append([fx, fy])
    return _catmull(ctrl)                     # wygładź w płynne łuki (nie kanciaste)


def _catmull(pts, steps=14):
    """Gładka krzywa Catmulla-Roma przez punkty kontrolne — płynne, przeciągłe łuki."""
    if len(pts) < 3:
        return pts
    P = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(steps):
            t = k / steps
            t2, t3 = t * t, t * t * t
            x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t
                       + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                       + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t
                       + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                       + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append([x, y])
    out.append(pts[-1])
    return out


# Długa trasa serpentynowa wypełniająca świat — kontrolowana długość → 45-90 s.
def _long_points(rnd):
    m = 340
    lane_len = W - 2 * m
    target = rnd.uniform(16000, 27000)                 # px → różne długości, wyścig ~45-90 s
    lanes = max(3, min(4, round(target / lane_len)))   # 3-4 pasy → gracze ~55-85 s
    lane_gap = min(460, (H - 2 * m) / max(1, lanes - 1))
    span = (lanes - 1) * lane_gap
    y0 = (H - span) / 2
    tilt = rnd.uniform(-0.05, 0.05)                     # lekki przechył całości
    pts = []
    for i in range(lanes):
        y = y0 + i * lane_gap
        xa, xb = (m, W - m) if i % 2 == 0 else (W - m, m)
        steps = 8
        for k in range(steps + 1):
            t = k / steps
            x = xa + (xb - xa) * t
            yy = y + tilt * (x - W / 2) + rnd.uniform(-55, 55)
            pts.append([max(m * 0.6, min(W - m * 0.6, x)),
                        max(m * 0.6, min(H - m * 0.6, yy))])
    return _catmull(pts, steps=10)



# ---------- Spirala do centrum (pętle + mosty + META w środku) ----------

SIZES = {"mała": (4200, 2400), "średnia": (6800, 3600), "duża": (9200, 4800)}


def set_world(w, h):
    """Ustaw rozmiar świata dla kolejnego generowanego toru."""
    global W, H
    W, H = w, h
    WORLD["w"], WORLD["h"] = w, h      # mutacja, nie podmiana (serwer trzyma referencję)


def _spiral_points(rnd):
    """Trasa wijąca się od krawędzi do CENTRUM. Meandry sprawiają, że sąsiednie
    zwoje czasem się przecinają — te miejsca stają się mostami."""
    cx, cy = W / 2, H / 2
    turns = rnd.uniform(3.0, 4.3)
    phase = rnd.uniform(0, math.tau)
    sgn = rnd.choice((1, -1))
    R = min(W, H) * 0.40
    ax = (W * 0.44) / R                      # rozciągnięcie do prostokąta mapy
    ay = (H * 0.44) / R
    wob_f = rnd.uniform(3.5, 7.5)            # ile meandrów
    wob_a = rnd.uniform(0.26, 0.46)          # jak głębokie (ułamek promienia)
    steps = 210
    pts = []
    for i in range(steps + 1):
        t = i / steps
        ang = phase + sgn * t * turns * math.tau
        r = R * (1 - t) + 150
        rr = r * (1 + math.sin(t * math.pi * wob_f) * wob_a)
        x = cx + math.cos(ang) * rr * ax
        y = cy + math.sin(ang) * rr * ay
        pts.append([max(M + 60, min(W - M - 60, x)), max(M + 60, min(H - M - 60, y))])
    pts.append([cx, cy])                     # META dokładnie w centrum
    return pts


def spiral_track(rnd=None, size=None):
    """Tor: spirala do centrum z mostami w miejscach skrzyżowań."""
    rnd = rnd or random.Random()
    size = size or rnd.choice(list(SIZES))
    set_world(*SIZES[size])
    name = rnd.choice(_NAMES)
    # szerokość drogi proporcjonalna do mapy — na małej mapie szeroka droga
    # nie mieści zwojów spirali i tor robi się nieprzejezdny
    wmin, wmax = {"mała": (165, 205), "średnia": (225, 285), "duża": (260, 320)}[size]
    fallback = None
    for _ in range(18):
        width = rnd.uniform(wmin, wmax)
        t = track_from_line(f"{name} ({size})", _spiral_points(rnd), width)
        if (t.get("badcross") or not t.get("bridges_ok") or not t.get("finish_clear")
                or not t.get("no_hairpins") or not centerline_ok(t)):
            continue                      # styczne przecięcia, mosty na sobie albo blokada bandą
        if not reachable(t):
            continue                      # nieprzejezdny — odrzuć bez litości
        if t.get("bridges"):
            return t                      # przejezdny I z mostami — ideał
        fallback = fallback or t           # przejezdny bez mostów — zapas
    return fallback or _maze_track(rnd)    # ostatecznie labirynt (zawsze przejezdny)




def _round_corners(poly, radius, steps=7):
    """Zaokrągl narożniki łamanej (fillet). Cięciwy zostają PROSTE — dzięki temu
    przecinają się pod prawdziwym, dużym kątem (czytelne wiadukty), a same zakręty
    są łagodne i mieszczą się w szerokości drogi."""
    out = [poly[0]]
    for i in range(1, len(poly) - 1):
        p0, p1, p2 = poly[i - 1], poly[i], poly[i + 1]
        v1 = (p0[0] - p1[0], p0[1] - p1[1])
        v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1 = math.hypot(*v1) or 1.0
        l2 = math.hypot(*v2) or 1.0
        r = min(radius, l1 * 0.45, l2 * 0.45)
        a = [p1[0] + v1[0] / l1 * r, p1[1] + v1[1] / l1 * r]
        b = [p1[0] + v2[0] / l2 * r, p1[1] + v2[1] / l2 * r]
        out.append(a)
        for k in range(1, steps):                 # kwadratowa Béziera a->p1->b
            t = k / steps
            u = 1 - t
            out.append([u * u * a[0] + 2 * u * t * p1[0] + t * t * b[0],
                        u * u * a[1] + 2 * u * t * p1[1] + t * t * b[1]])
        out.append(b)
    out.append(poly[-1])
    return out


def _knot_points(rnd, width=260):
    """Trasa-„węzeł": wierzchołki na elipsie łączone co k-ty (gwiazda {n/k}).
    Cięciwy PROSTE — przecinają się pod dużym kątem, więc powstają czytelne
    wiadukty. Kombinacje (n,k) dobrane tak, żeby cięciwy omijały środek mapy,
    bo tam jest META i dojazd musi być wolny."""
    cx, cy = W / 2, H / 2
    kandydaci = [(n, k) for n in (7, 9, 11, 13) for k in range(2, 7)
                 if math.gcd(n, k) == 1
                 and math.cos(math.pi * k / n) >= 0.32          # środek wolny
                 and 35 <= math.degrees(min(2 * math.pi * k / n,
                                            math.pi - 2 * math.pi * k / n) if
                                        2 * math.pi * k / n < math.pi else
                                        math.pi - 2 * math.pi * k / n) or False]
    if not kandydaci:
        kandydaci = [(7, 2), (9, 2), (11, 3)]
    n, k = rnd.choice(kandydaci)
    rx, ry = W * 0.40, H * 0.40
    phase = rnd.uniform(0, math.tau)
    ring = []
    for i in range(n):
        a = phase + i * math.tau / n
        wob = rnd.uniform(0.93, 1.07)
        ring.append([cx + math.cos(a) * rx * wob, cy + math.sin(a) * ry * wob])
    order, idx = [], 0
    for _ in range(n):
        order.append(ring[idx])
        idx = (idx + k) % n
    order.append(order[0])                       # domknij gwiazdę
    order.append([cx, cy])                       # dojazd do METY w centrum
    pts = _round_corners(order, radius=max(240.0, width * 1.1))
    return [[max(M + 70, min(W - M - 70, x)), max(M + 70, min(H - M - 70, y))] for x, y in pts]



def _loop_points(rnd, width=260):
    """Trasa z KONTROLOWANYMI wiaduktami: gładka spirala do centrum + 1-3 pętle,
    z których każda przecina trasę dokładnie raz, pod dużym kątem.
    (Gwiazda dawała ~18 przypadkowych skrzyżowań — nieczytelna plątanina.)"""
    base = _spiral_points(rnd)
    n = len(base)
    ile = rnd.randint(1, 3)
    # miejsca pętli: rozrzucone, z dala od startu i mety
    moznaod, doko = int(n * 0.18), int(n * 0.80)
    miejsca = sorted(rnd.sample(range(moznaod, doko), ile)) if doko > moznaod else []
    r_max = min(W, H) * 0.13
    r = max(width * 1.35, min(r_max, width * 2.1))
    out = []
    last = 0
    for idx in miejsca:
        out.extend(base[last:idx])
        p = base[idx]
        q = base[min(idx + 1, n - 1)]
        dx, dy = q[0] - p[0], q[1] - p[1]
        L = math.hypot(dx, dy) or 1.0
        dx, dy = dx / L, dy / L
        nx, ny = -dy, dx                       # w bok od trasy
        sgn = rnd.choice((1, -1))
        cxp, cyp = p[0] + nx * r * sgn, p[1] + ny * r * sgn
        a0 = math.atan2(p[1] - cyp, p[0] - cxp)
        for k in range(1, 25):                 # pełne kółko wracające na trasę
            a = a0 + sgn * k * math.tau / 24
            x = cxp + math.cos(a) * r
            y = cyp + math.sin(a) * r
            out.append([max(M + 90, min(W - M - 90, x)),
                        max(M + 90, min(H - M - 90, y))])
        last = idx
    out.extend(base[last:])
    return out


def knot_track(rnd=None, size=None):
    """Tor z pętlami i wiaduktami, meta w centrum."""
    rnd = rnd or random.Random()
    size = size or rnd.choice(list(SIZES))
    set_world(*SIZES[size])
    wmin, wmax = {"mała": (150, 185), "średnia": (200, 250), "duża": (240, 290)}[size]
    name = rnd.choice(_NAMES)
    fallback = None
    for _ in range(60):        # pula generuje w tle, więc możemy próbować dłużej
        width = rnd.uniform(wmin, wmax)
        t = track_from_line(f"{name} ({size})", _loop_points(rnd, width), width)
        if (t.get("badcross") or not t.get("bridges_ok") or not t.get("finish_clear")
                or not t.get("no_hairpins") or not centerline_ok(t) or not reachable(t)):
            continue
        if t.get("bridges"):
            return t
        fallback = fallback or t
    return fallback or spiral_track(rnd, size)


PANEL_R = 58            # promień panelu w px — trafialny, ale nie automatyczny


def _panele_labirynt(t, rnd, ile=6):
    """Panele w komórkach SĄSIADUJĄCYCH z trasą optymalną, ale na niej nieleżących.
    Wjazd po panel to zawsze objazd (wjedź i wróć), więc panel kosztuje czas —
    inaczej byłby tylko ładowaniem biernym w przebraniu."""
    m = t.get("maze")
    trasa = maze_solve(t)
    if not m or not trasa:
        return []
    na_trasie = set(map(tuple, trasa))
    przejscia = set()
    for a, b, c, d in m["passages"]:
        przejscia.add(((a, b), (c, d)))
        przejscia.add(((c, d), (a, b)))
    kandydaci = []
    for cel in trasa[1:-1]:                       # pomijamy komórkę startu i mety
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (cel[0] + dx, cel[1] + dy)
            if (0 <= n[0] < m["cols"] and 0 <= n[1] < m["rows"]
                    and n not in na_trasie and (cel, n) in przejscia):
                kandydaci.append(n)
    rnd.shuffle(kandydaci)
    wybrane, uzyte = [], set()
    for c in kandydaci:
        if c in uzyte:
            continue
        uzyte.add(c)
        wybrane.append({"x": round(M + (c[0] + 0.5) * m["cw"]),
                        "y": round(M + (c[1] + 0.5) * m["ch"])})
        if len(wybrane) >= ile:
            break
    return wybrane


def _panele_korytarz(t, rnd, ile=5):
    """Panele na ZEWNĘTRZNEJ linii zakrętu. Tor korytarzowy ma jedną drogę, więc
    panel kosztuje nie objazd, tylko gorszą linię przejazdu — trzeba rozszerzyć
    łuk zamiast ciąć go po wewnętrznej."""
    P = t.get("path")
    if not P or len(P) < 12:
        return []
    pol = (t.get("width", 200) / 2) * 0.62        # jak daleko od osi w stronę zewnętrzną
    zakrety = []
    for i in range(4, len(P) - 4):
        ax, ay = P[i][0] - P[i - 3][0], P[i][1] - P[i - 3][1]
        bx, by = P[i + 3][0] - P[i][0], P[i + 3][1] - P[i][1]
        la, lb = math.hypot(ax, ay), math.hypot(bx, by)
        if la < 1 or lb < 1:
            continue
        skret = (ax * by - ay * bx) / (la * lb)   # iloczyn wektorowy = jak ostry zakręt
        if abs(skret) > 0.25:
            zakrety.append((abs(skret), i, skret, bx / lb, by / lb))
    zakrety.sort(reverse=True)
    wybrane, uzyte = [], []
    # Trasa narysowana łagodnym łukiem może nie mieć ANI JEDNEGO ostrego zakrętu.
    # Bez zabezpieczenia zostałaby zupełnie bez nitro, bo ładowanie bierne jest
    # przycięte. Wtedy rozkładamy panele równomiernie, na przemian po bokach.
    if len(zakrety) < ile:
        krok = max(6, (len(P) - 10) // (ile + 1))
        for n in range(1, ile + 1):
            i = 5 + n * krok
            if i >= len(P) - 5:
                break
            dx, dy = P[i + 2][0] - P[i - 2][0], P[i + 2][1] - P[i - 2][1]
            dl = math.hypot(dx, dy) or 1.0
            bok = 1 if n % 2 else -1
            wybrane.append({"x": round(P[i][0] - dy / dl * pol * bok),
                            "y": round(P[i][1] + dx / dl * pol * bok)})
        return wybrane
    for _, i, skret, dx, dy in zakrety:
        if any(abs(i - j) < 6 for j in uzyte):    # nie kupkuj paneli obok siebie
            continue
        uzyte.append(i)
        nx, ny = (-dy, dx) if skret < 0 else (dy, -dx)   # normalna na ZEWNĄTRZ łuku
        wybrane.append({"x": round(P[i][0] + nx * pol), "y": round(P[i][1] + ny * pol)})
        if len(wybrane) >= ile:
            break
    return wybrane


def dodaj_panele(t, rnd):
    """Panele nitro doklejone do gotowego, zwalidowanego toru."""
    t["pads"] = _panele_labirynt(t, rnd) if t.get("maze") else _panele_korytarz(t, rnd)
    t["pad_r"] = PANEL_R
    return t


def random_track():
    """Losowy tor z panelami nitro. Opakowanie zamiast łatania każdego z kilku
    punktów wyjścia niżej — dzięki temu ŻADNA ścieżka nie odda toru bez paneli."""
    t = _losuj_tor()
    return dodaj_panele(t, random.Random())


def _losuj_tor():
    """Losowy tor: spirala do centrum z mostami albo labirynt (oba klimaty)."""
    rnd = random.Random()
    forced = os.environ.get("RACES_FORCE_TRACK")     # tryb testowy
    if forced:
        kind, _, sz = forced.partition(":")
        sz = sz or None
        if kind == "knot":
            return knot_track(rnd, sz)
        if kind == "spiral":
            return spiral_track(rnd, sz)
        if kind == "maze":
            set_world(*SIZES[sz or "średnia"])
            return _maze_track(rnd)
    r = rnd.random()
    if r < 0.4:
        return knot_track(rnd)                   # pętle + wiadukty, meta w centrum
    if r < 0.7:
        return spiral_track(rnd)                 # kręta spirala do centrum
    set_world(*SIZES[rnd.choice(list(SIZES))])
    return _maze_track(rnd)


# ---------- Mosty: wykrywanie samo-przecięć i nadawanie poziomów ----------

def _segments_cross(a1, a2, b1, b2):
    """Czy odcinki a i b się przecinają (bez wspólnych końców)."""
    def cr(o, p, q):
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    d1, d2 = cr(b1, b2, a1), cr(b1, b2, a2)
    d3, d4 = cr(a1, a2, b1), cr(a1, a2, b2)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def _assign_levels(pts, span=2):
    """Znajdź miejsca, gdzie trasa przecina samą siebie i wynieś PÓŹNIEJSZY
    przejazd na most (level 1). Zwraca (levels, crossings, bad).
    `bad` = przecięcia pod bardzo małym kątem (jazda prawie po sobie) — z nich nie
    da się zrobić czytelnego wiaduktu, więc taki tor lepiej odrzucić."""
    n = len(pts)
    levels = [0] * n
    crossings = []
    bad = []
    for i in range(n - 1):
        for j in range(i + 3, n - 1):
            if not _segments_cross(pts[i], pts[i + 1], pts[j], pts[j + 1]):
                continue
            ax, ay = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
            bx, by = pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]
            la = math.hypot(ax, ay) or 1.0
            lb = math.hypot(bx, by) or 1.0
            cos = abs((ax * bx + ay * by) / (la * lb))
            if cos > 0.95:            # < ~18 stopni: praktycznie po sobie
                bad.append(j)
            else:
                crossings.append(j)
    for j in crossings:                       # most nad skrzyżowaniem
        for k in range(max(0, j - span), min(n, j + span + 2)):
            levels[k] = 1
    # nie zaczynaj i nie kończ trasy na moście (start/meta zawsze na parterze)
    for k in (0, 1, n - 2, n - 1):
        if 0 <= k < n:
            levels[k] = 0
    return levels, crossings, bad


def _build_gates(pts, levels, width):
    """Bramki na granicy parter/most — przejazd przez bramkę zmienia poziom auta."""
    gates = []
    half = width / 2 + 12
    for i in range(len(pts) - 1):
        a, b = levels[i], levels[i + 1]
        if a == b:
            continue
        mx = (pts[i][0] + pts[i + 1][0]) / 2
        my = (pts[i][1] + pts[i + 1][1]) / 2
        dx, dy = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
        L = math.hypot(dx, dy) or 1.0
        dx, dy = dx / L, dy / L
        nx, ny = -dy, dx
        gates.append({
            "x1": round(mx + nx * half), "y1": round(my + ny * half),
            "x2": round(mx - nx * half), "y2": round(my - ny * half),
            "dx": round(dx, 4), "dy": round(dy, 4),
            "fwd": b, "bwd": a,          # jazda zgodnie z trasą -> poziom b, pod prąd -> a
        })
    return gates


def _seg_dist(a1, a2, b1, b2):
    """Najmniejsza odległość między dwoma odcinkami."""
    def pt_seg(p, s1, s2):
        dx, dy = s2[0] - s1[0], s2[1] - s1[1]
        L2 = dx * dx + dy * dy or 1.0
        u = max(0.0, min(1.0, ((p[0] - s1[0]) * dx + (p[1] - s1[1]) * dy) / L2))
        return math.hypot(p[0] - (s1[0] + u * dx), p[1] - (s1[1] + u * dy))
    if _segments_cross(a1, a2, b1, b2):
        return 0.0
    return min(pt_seg(a1, b1, b2), pt_seg(a2, b1, b2),
               pt_seg(b1, a1, a2), pt_seg(b2, a1, a2))





def no_hairpins(pts, width, margin=1.15):
    """Czy każdy zakręt MIEŚCI SIĘ w szerokości drogi?
    Przy zakręcie o kąt θ korytarz o połowie szerokości h potrzebuje odcinków
    dłuższych niż h*tan(θ/2) — inaczej wewnętrzna banda przecina jezdnię
    i auto blokuje się w „spince" (dokładnie tak wyglądały blokady przed metą)."""
    h = width / 2
    for i in range(1, len(pts) - 1):
        ax, ay = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
        bx, by = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
        la = math.hypot(ax, ay)
        lb = math.hypot(bx, by)
        if la < 1e-6 or lb < 1e-6:
            continue
        cosv = max(-1.0, min(1.0, (ax * bx + ay * by) / (la * lb)))
        theta = math.acos(cosv)
        if theta < 0.35:                      # łagodny łuk — zawsze OK
            continue
        potrzeba = h * math.tan(theta / 2) * margin
        if min(la, lb) < potrzeba:
            return False
    return True


def finish_clear(pts, width, margin=110, tail_len=16):
    """CAŁY końcowy dojazd do METY musi być wolny — nie tylko sam punkt mety.
    Wcześniej korytarze innych fragmentów trasy podchodziły pod dojazd i auto
    blokowało się kilka metrów przed metą."""
    n = len(pts)
    need = width * 0.75 + margin
    tail_start = max(1, n - tail_len)
    for i in range(tail_start, n):             # każdy punkt końcowego dojazdu…
        for j in range(0, tail_start - 4):     # …kontra reszta trasy
            d = _seg_dist(pts[j], pts[j + 1], pts[i], pts[i])
            if d < need:
                return False
    return True


def bridges_ok(pts, levels, max_bridges=2):
    """Mosty nie mogą krzyżować się ZE SOBĄ — obie barierki są na poziomie 1,
    więc wzajemnie się blokują (auto utyka na wiadukcie). Odrzucamy też tory
    z nadmiarem wiaduktów: robi się z tego nieczytelna plątanina."""
    seg1 = [i for i in range(len(pts) - 1) if levels[i] == 1 and levels[i + 1] == 1]
    # policz odrębne odcinki mostowe (przerwy w indeksach = osobne wiadukty)
    spans = 0
    for k, i in enumerate(seg1):
        if k == 0 or i != seg1[k - 1] + 1:
            spans += 1
    if spans > max_bridges:
        return False
    for a in range(len(seg1)):
        for b in range(a + 1, len(seg1)):
            i, j = seg1[a], seg1[b]
            if abs(i - j) < 3:
                continue
            if _segments_cross(pts[i], pts[i + 1], pts[j], pts[j + 1]):
                return False
    return True


def centerline_ok(t, car_r=18.0, cellpx=240):
    """Czy autem DA SIĘ przejechać własną linią środkową trasy?
    Idzie po trasie, przechodzi przez bramki (zmiana piętra) i sprawdza, czy w każdym
    punkcie auto mieści się między ścianami SWOJEGO piętra. To łapie pułapki, których
    BFS nie widzi: dwa mosty krzyżujące się na tym samym piętrze albo bandę sąsiedniego
    korytarza wchodzącą w drogę."""
    P = t.get("path")
    if not P or len(P) < 2:
        return True
    grid = {}
    for w in t["walls"]:                       # siatka przestrzenna ścian
        lv = w[4] if len(w) > 4 else 2
        x1, y1, x2, y2 = w[0], w[1], w[2], w[3]
        n = max(1, int(math.hypot(x2 - x1, y2 - y1) / cellpx) + 1)
        for i in range(n + 1):
            u = i / n
            gx = int((x1 + (x2 - x1) * u) / cellpx)
            gy = int((y1 + (y2 - y1) * u) / cellpx)
            grid.setdefault((gx, gy), []).append((x1, y1, x2, y2, lv))

    def touches(x, y, lvl):
        gx, gy = int(x / cellpx), int(y / cellpx)
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                for (x1, y1, x2, y2, lv) in grid.get((gx + ox, gy + oy), ()):
                    if lv != 2 and lv != lvl:
                        continue
                    dx, dy = x2 - x1, y2 - y1
                    L2 = dx * dx + dy * dy or 1.0
                    u = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L2))
                    px, py = x1 + u * dx, y1 + u * dy
                    if (x - px) ** 2 + (y - py) ** 2 < car_r * car_r:
                        return True
        return False

    gates = t.get("gates", [])
    lvl = 0
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        for g in gates:
            if _segments_cross(a, b, [g["x1"], g["y1"]], [g["x2"], g["y2"]]):
                dot = (b[0] - a[0]) * g["dx"] + (b[1] - a[1]) * g["dy"]
                lvl = g["fwd"] if dot >= 0 else g["bwd"]
        if touches(b[0], b[1], lvl):
            return False
    return True


# ---------- 2) Trasa z narysowanej linii ----------

def track_from_line(name, pts, width=150):
    """Obuduj linię (lista [x,y] we współrzędnych świata) korytarzem ze ścian.
    Początek linii = START, koniec = META."""
    pts = [[max(M + 5, min(W - M - 5, float(x))), max(M + 5, min(H - M - 5, float(y)))]
           for x, y in pts]
    if len(pts) < 2:
        return random_track()
    # Wygładź narysowaną linię (przerzedź punkty + Catmull-Rom): usuwa ostre
    # załamania, dzięki czemu ściany korytarza nie „zwijają się" na zakrętach.
    if len(pts) >= 5:
        ctrl = pts[::4]
        if ctrl[-1] != pts[-1]:
            ctrl.append(pts[-1])
        if len(ctrl) >= 3:
            pts = _catmull(ctrl, steps=10)
    # Po wygładzeniu krzywa potrafi „wystrzelić" poza margines — przytnij ją tak,
    # żeby CAŁY korytarz (droga + bandy) zmieścił się w mapie i nie wchodził w ramkę.
    marg = width / 2 + 46
    pts = [[max(M + marg, min(W - M - marg, x)),
            max(M + marg, min(H - M - marg, y))] for x, y in pts]
    # Przerzedź do ~co 90 px — mniej ścian = lżej dla słabszego sprzętu (render + kolizje).
    res = [pts[0]]
    for pnt in pts[1:]:
        if math.hypot(pnt[0] - res[-1][0], pnt[1] - res[-1][1]) >= 90:
            res.append(pnt)
    if res[-1] != pts[-1]:
        res.append(pts[-1])
    pts = res
    half = width / 2
    left, right = [], []
    n = len(pts)
    for i in range(n):
        if i == 0:
            tx, ty = pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]
        elif i == n - 1:
            tx, ty = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
        else:
            tx, ty = pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]
        L = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / L, tx / L
        left.append([pts[i][0] + nx * half, pts[i][1] + ny * half])
        right.append([pts[i][0] - nx * half, pts[i][1] - ny * half])

    # Poziomy: gdzie trasa przecina samą siebie, późniejszy przejazd idzie MOSTEM.
    # Przęsło musi przekryć CAŁĄ szerokość przecinanego korytarza (+ zapas),
    # inaczej rampy wypadną w tej drodze i ją zablokują.
    span = max(3, int(width / 90) + 2)
    levels, crossings, badcross = _assign_levels(pts, span=span)
    gates = _build_gates(pts, levels, width)
    # level ściany: 0 = tylko parter, 1 = tylko most, 2 = zawsze (rampy i ramka świata)
    walls = [w + [2] for w in _frame()]
    for i in range(n - 1):
        a, b = levels[i], levels[i + 1]
        lv = 2 if a != b else a          # rampa blokuje na obu poziomach
        walls.append([left[i][0], left[i][1], left[i + 1][0], left[i + 1][1], lv])
        walls.append([right[i][0], right[i][1], right[i + 1][0], right[i + 1][1], lv])

    p0, p1 = pts[0], pts[1]
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    start = {"x": round(p0[0]), "y": round(p0[1]), "angle": round(ang, 4)}
    pe = pts[-1]
    fw = fh = 120
    finish = {"x": round(pe[0] - fw / 2), "y": round(pe[1] - fh / 2), "w": fw, "h": fh}
    # path + width pozwalają klientowi narysować nawierzchnię drogi (asfalt), nie tylko ściany
    path = [[round(p[0]), round(p[1])] for p in pts]
    # size to KOPIA — patrz komentarz przy drugim generatorze.
    return {"name": name, "size": dict(WORLD), "start": start, "finish": finish,
            "walls": walls, "path": path, "width": round(width),
            "levels": levels, "gates": gates,
            "bridges": len(crossings), "badcross": len(badcross),
            "bridges_ok": bridges_ok(pts, levels),
            "finish_clear": finish_clear(pts, width),
            "no_hairpins": no_hairpins(pts, width)}


TRACK = random_track()  # zgodność wstecz
