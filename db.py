"""
Baza wyników — SQLite (plik races.db obok kodu).
Prawdziwa relacyjna baza, ale bez osobnego procesu serwera (wbudowana w Pythona),
więc nic nie obciąża systemu w tle. Dane przeżywają restarty serwera.

Tabela results: jeden wiersz = jeden gracz który dojechał do mety w danym wyścigu.
  place = 1 to zwycięzca; time_s = czas od startu wyścigu.
"""

import json
import os
import sqlite3
import threading
from datetime import datetime

# Domyślnie races.db obok kodu; RACES_DB pozwala wskazać inny plik (np. do testów).
DB_PATH = os.environ.get("RACES_DB", os.path.join(os.path.dirname(__file__), "races.db"))

_lock = threading.Lock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row


def init():
    with _lock:
        _conn.execute("""
            CREATE TABLE IF NOT EXISTS results (
                id     INTEGER PRIMARY KEY AUTOINCREMENT,
                ts     TEXT    NOT NULL,   -- kiedy (ISO)
                track  TEXT,               -- nazwa trasy
                name   TEXT    NOT NULL,   -- nick gracza
                place  INTEGER NOT NULL,   -- miejsce (1 = zwycięzca)
                time_s REAL                -- czas od startu wyścigu (s)
            )
        """)
        # pid = trwały identyfikator gracza z jego przeglądarki. Bez niego kluczem
        # był sam nick, więc każdy mógł wpisać cudzy i przejąć jego statystyki.
        # Stare wiersze mają pid = NULL i nadal liczą się po nicku.
        kolumny = [r[1] for r in _conn.execute("PRAGMA table_info(results)")]
        if "pid" not in kolumny:
            _conn.execute("ALTER TABLE results ADD COLUMN pid TEXT")
        _conn.execute("""
            CREATE TABLE IF NOT EXISTS tracks (
                id     INTEGER PRIMARY KEY AUTOINCREMENT,
                ts     TEXT    NOT NULL,   -- kiedy wygenerowany
                name   TEXT,               -- nazwa trasy
                source TEXT,               -- 'random' albo 'drawn'
                data   TEXT    NOT NULL    -- pełny tor jako JSON
            )
        """)
        # Telemetria wydajności — jeden wiersz na gracza na wyścig, TYLKO gdy
        # gracz sam zaznaczył wysyłanie. Trzymamy percentyle i liczbę zacięć,
        # nie same średnie: gracz ze średnią 55 FPS, który cztery razy spada
        # do 12, ma fatalny odbiór, a średnia tego nie pokaże.
        _conn.execute("""
            CREATE TABLE IF NOT EXISTS telemetry (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                ts        TEXT    NOT NULL,
                track     TEXT,             -- kontekst: pozwala korelować spadki
                track_typ TEXT,             -- 'labirynt' / 'korytarz'
                mosty     INTEGER,          -- ile wiaduktów miał tor
                graczy    INTEGER,          -- ilu jechało jednocześnie
                czas_s    REAL,             -- długość pomiaru
                nick      TEXT,
                klucz     TEXT,
                karoseria TEXT,
                fps_med   REAL,             -- mediana klatek
                fps_p05   REAL,             -- 5. percentyl = te złe momenty
                fps_min   REAL,
                klatka_max REAL,            -- najgorsza klatka w ms
                zaciec    INTEGER,          -- klatek dłuższych niż 50 ms
                zaciec_min REAL,            -- zacięć na minutę
                ping_med  REAL,
                ping_p95  REAL,
                ping_max  REAL,
                jitter    REAL,             -- rozrzut odstępów między pakietami
                kbps_in   REAL,
                kbps_out  REAL,
                jakosc_min INTEGER,         -- najniższy poziom auto-jakości
                jakosc_sr  REAL,
                mobil     INTEGER,
                ekran     TEXT,
                rdzenie   INTEGER,
                przegladarka TEXT
            )
        """)
        _conn.commit()


# Ile torów trzymamy. Każdy to pełny JSON (nawet 68 KB), a odtwarzany bywa
# praktycznie żaden — archiwum rosło bez końca i zajmowało 96% pliku bazy.
# Tory RYSOWANE przez graczy zostawiamy wszystkie: są nieodtwarzalne.
LIMIT_TOROW = 50


def save_track(track, source="random"):
    """Zapisz wygenerowany tor do bazy i przytnij archiwum do LIMIT_TOROW."""
    with _lock:
        _conn.execute(
            "INSERT INTO tracks (ts, name, source, data) VALUES (?, ?, ?, ?)",
            (datetime.now().isoformat(timespec="seconds"),
             track.get("name"), source, json.dumps(track)),
        )
        _conn.execute("""
            DELETE FROM tracks
             WHERE source = 'random'
               AND id NOT IN (SELECT id FROM tracks WHERE source = 'random'
                              ORDER BY id DESC LIMIT ?)
        """, (LIMIT_TOROW,))
        _conn.commit()


def track_count():
    with _lock:
        return _conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]


def record(track, name, place, time_s, pid=None):
    """Zapisz wynik. Wywoływane TYLKO dla graczy, którzy nie są gośćmi."""
    with _lock:
        _conn.execute(
            "INSERT INTO results (ts, track, name, place, time_s, pid) VALUES (?, ?, ?, ?, ?, ?)",
            (datetime.now().isoformat(timespec="seconds"), track, name, place, time_s, pid),
        )
        _conn.commit()


POLA_TELEMETRII = (
    "track", "track_typ", "mosty", "graczy", "czas_s", "nick", "klucz", "karoseria",
    "fps_med", "fps_p05", "fps_min", "klatka_max", "zaciec", "zaciec_min",
    "ping_med", "ping_p95", "ping_max", "jitter", "kbps_in", "kbps_out",
    "jakosc_min", "jakosc_sr", "mobil", "ekran", "rdzenie", "przegladarka",
)


def save_telemetry(dane: dict):
    """Zapisz telemetrię jednego gracza z jednego wyścigu.

    Bierzemy WYŁĄCZNIE znane kolumny — cokolwiek klient dośle poza nimi, jest
    ignorowane. Dzięki temu zepsuty albo złośliwy klient nie zaśmieci bazy.
    """
    wart = [dane.get(k) for k in POLA_TELEMETRII]
    kolumny = ", ".join(POLA_TELEMETRII)
    znaki = ", ".join("?" * len(POLA_TELEMETRII))
    with _lock:
        _conn.execute(
            f"INSERT INTO telemetry (ts, {kolumny}) VALUES (?, {znaki})",
            [datetime.now().isoformat(timespec="seconds")] + wart,
        )
        _conn.commit()


def telemetry_count():
    with _lock:
        return _conn.execute("SELECT COUNT(*) FROM telemetry").fetchone()[0]


def leaderboard(limit=10):
    """Ranking. Grupujemy po pid (trwały identyfikator gracza), a nie po nicku —
    dzięki temu zmiana nicku nie gubi dorobku, a cudzy nick niczego nie przejmuje.
    Wiersze sprzed migracji (pid = NULL) grupujemy dalej po nicku.
    Wyświetlamy nick z NAJNOWSZEGO wyniku danego gracza."""
    with _lock:
        rows = _conn.execute("""
            SELECT (SELECT name FROM results r2
                     WHERE COALESCE(r2.pid, 'nick:' || r2.name) = klucz
                     ORDER BY r2.id DESC LIMIT 1)               AS name,
                   wins, races, best
            FROM (
                SELECT COALESCE(pid, 'nick:' || name)           AS klucz,
                       SUM(CASE WHEN place = 1 THEN 1 ELSE 0 END) AS wins,
                       COUNT(*)                                  AS races,
                       MIN(time_s)                               AS best
                FROM results
                GROUP BY klucz
            )
            ORDER BY wins DESC, (best IS NULL), best ASC
            LIMIT ?
        """, (limit,)).fetchall()
    return [{"name": r["name"], "wins": r["wins"], "races": r["races"],
             "best": round(r["best"], 2) if r["best"] is not None else None}
            for r in rows]
