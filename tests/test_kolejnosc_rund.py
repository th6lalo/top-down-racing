"""Cel 2: pierwszy wyścig nowej sesji to WYŚCIG, nie rysowanie.

Nowy gracz, którego pierwszy kontakt z grą to „narysuj tor w 45 s", odpada,
zanim zrozumie, że to gra wyścigowa. Te testy pilnują, żeby świeża sesja
zaczynała od jazdy, a rysowanie wchodziło dopiero w kolejnej rundzie.
"""
import server as S


def test_swieza_sesja_zaczyna_od_wyscigu():
    """drawn_next=False na starcie => pierwsza runda to wyścig, nie rysowanie."""
    assert S.drawn_next is False, "pierwsza runda nowej sesji byłaby rysowaniem"


def test_rundy_sa_naprzemienne(monkeypatch):
    """Po pierwszym wyścigu ma przyjść rysowanie, potem znów wyścig — sama
    logika wyboru źródła mapy, bez sieci."""
    kolejnosc = []

    async def falszywy_race(_):
        kolejnosc.append("wyscig")

    async def falszywy_draw():
        kolejnosc.append("rysowanie")

    async def falszywy_next_track():
        return {"name": "x"}

    monkeypatch.setattr(S, "drawn_next", False)
    monkeypatch.setattr(S, "joined_ids", lambda: [1])
    monkeypatch.setattr(S, "start_race", falszywy_race)
    monkeypatch.setattr(S, "start_drawing", falszywy_draw)
    monkeypatch.setattr(S, "next_track", falszywy_next_track)

    import asyncio
    for _ in range(4):
        asyncio.run(S.start_round())

    assert kolejnosc == ["wyscig", "rysowanie", "wyscig", "rysowanie"], kolejnosc


def test_pusta_sesja_nie_startuje_rundy(monkeypatch):
    """Bez graczy runda się nie zaczyna — faza idle."""
    import asyncio
    monkeypatch.setattr(S, "joined_ids", lambda: [])
    asyncio.run(S.start_round())
    assert S.phase == "idle"
