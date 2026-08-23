#!/usr/bin/env python3
"""Podsumowanie zebranej telemetrii wydajności.

    ./.venv/bin/python raport-telemetria.py

Odpowiada na pytania, których nie da się zadać patrząc na pojedyncze wiersze:
kto ma problem, które tory są ciężkie, czy winna jest liczba graczy, czy telefon.

Wszędzie patrzymy na PIĄTY PERCENTYL klatek (`fps_p05`), a nie na średnią —
średnia 50 FPS przy regularnych spadkach do 11 wygląda znośnie i kłamie.
"""
import os
import sqlite3
import sys

SCIEZKA = os.environ.get("RACES_DB", os.path.join(os.path.dirname(__file__), "races.db"))


def tabela(naglowki, wiersze):
    if not wiersze:
        print("   (brak danych)")
        return
    szer = [max(len(str(h)), *(len(str(w[i])) for w in wiersze)) for i, h in enumerate(naglowki)]
    print("   " + "  ".join(str(h).ljust(szer[i]) for i, h in enumerate(naglowki)))
    print("   " + "  ".join("-" * s for s in szer))
    for w in wiersze:
        print("   " + "  ".join(str(v).ljust(szer[i]) for i, v in enumerate(w)))


def main():
    if not os.path.exists(SCIEZKA):
        print(f"Brak bazy: {SCIEZKA}")
        return 1
    c = sqlite3.connect(SCIEZKA)
    try:
        ile = c.execute("SELECT COUNT(*) FROM telemetry").fetchone()[0]
    except sqlite3.OperationalError:
        print("Brak tabeli telemetry — nikt jeszcze nie wysłał pomiarów.")
        return 0
    if not ile:
        print("Tabela telemetry jest pusta. Zaznaczcie „Wysyłaj telemetrię” przed wyścigiem.")
        return 0

    print(f"\n=== TELEMETRIA — {ile} pomiarów ===\n")

    print("KTO MA PROBLEM  (fps_p05 = jak źle bywa w najgorszych momentach)")
    tabela(["gracz", "wyścigów", "fps_med", "fps_p05", "zacięć/min", "ping_p95", "sprzęt"],
           c.execute("""
        SELECT nick, COUNT(*), ROUND(AVG(fps_med),0), ROUND(AVG(fps_p05),0),
               ROUND(AVG(zaciec_min),1), ROUND(AVG(ping_p95),0),
               CASE WHEN AVG(mobil) > 0.5 THEN 'telefon' ELSE 'komputer' END
          FROM telemetry GROUP BY nick ORDER BY AVG(fps_p05) ASC
    """).fetchall())

    print("\nKTÓRE TORY SĄ CIĘŻKIE")
    tabela(["typ toru", "wiaduktów", "pomiarów", "fps_med", "fps_p05", "zacięć/min"],
           c.execute("""
        SELECT track_typ, mosty, COUNT(*), ROUND(AVG(fps_med),0),
               ROUND(AVG(fps_p05),0), ROUND(AVG(zaciec_min),1)
          FROM telemetry GROUP BY track_typ, mosty ORDER BY AVG(fps_p05) ASC
    """).fetchall())

    print("\nCZY LICZBA GRACZY MA ZNACZENIE")
    tabela(["graczy", "pomiarów", "fps_med", "fps_p05", "ping_p95", "ruch ↓kB/s"],
           c.execute("""
        SELECT graczy, COUNT(*), ROUND(AVG(fps_med),0), ROUND(AVG(fps_p05),0),
               ROUND(AVG(ping_p95),0), ROUND(AVG(kbps_in),1)
          FROM telemetry GROUP BY graczy ORDER BY graczy
    """).fetchall())

    print("\nTELEFON KONTRA KOMPUTER")
    tabela(["urządzenie", "pomiarów", "fps_med", "fps_p05", "jakość min", "zacięć/min"],
           c.execute("""
        SELECT CASE WHEN mobil=1 THEN 'telefon' ELSE 'komputer' END, COUNT(*),
               ROUND(AVG(fps_med),0), ROUND(AVG(fps_p05),0),
               ROUND(AVG(jakosc_min),1), ROUND(AVG(zaciec_min),1)
          FROM telemetry GROUP BY mobil
    """).fetchall())

    print("\nNAJGORSZE POJEDYNCZE WYŚCIGI")
    tabela(["kiedy", "gracz", "tor", "fps_p05", "najgorsza klatka", "zacięć"],
           c.execute("""
        SELECT substr(ts,6,11), nick, substr(track,1,18), ROUND(fps_p05,0),
               ROUND(klatka_max,0) || ' ms', zaciec
          FROM telemetry ORDER BY fps_p05 ASC LIMIT 8
    """).fetchall())
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
