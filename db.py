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
        _conn.commit()


def save_track(track, source="random"):
    """Zapisz wygenerowany tor do bazy (archiwum / biblioteka torów)."""
    with _lock:
        _conn.execute(
            "INSERT INTO tracks (ts, name, source, data) VALUES (?, ?, ?, ?)",
            (datetime.now().isoformat(timespec="seconds"),
             track.get("name"), source, json.dumps(track)),
        )
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
