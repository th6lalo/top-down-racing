"""Testy generatorów i walidatorów torów.

To najważniejsza część projektu: generator, który potrafi ODRZUCIĆ własny wynik.
Testy sprawdzają, że wygenerowany tor jest naprawdę przejezdny, a nie tylko
ładnie wygląda.
"""
import pytest

import track as T


# ---------------------------------------------------------------- generatory

@pytest.mark.parametrize("nr", [1, 2, 3])
def test_wygenerowany_tor_jest_przejezdny(nr):
    """Każdy tor oddany przez generator musi przejść własne walidatory.

    To nie jest tautologia: generator losuje kandydatów i odrzuca te, które
    walidatory oblewają. Test pilnuje, żeby przy braku dobrego kandydata
    generator NIE oddał złego toru zamiast sięgnąć po zapasowy.
    """
    t = T.random_track()          # generator losuje sam; sprawdzamy kilka przebiegów
    assert T.reachable(t), f"meta nieosiągalna na torze {t['name']}"
    if t.get("path"):
        assert T.centerline_ok(t), f"nie da się przejechać osią toru {t['name']}"


def test_start_i_meta_leza_w_granicach_swiata():
    """Regresja prawdziwego błędu: `size` był ZAPISYWANY PRZEZ REFERENCJĘ do
    współdzielonego słownika WORLD, który zmienia się przy każdej kolejnej
    generacji. Tor z puli „przejmował" rozmiar późniejszego toru i gracz
    spawnował się poza mapą, a kamera zacinała się na krawędzi.
    """
    for _ in range(4):
        t = T.random_track()
        w, h = t["size"]["w"], t["size"]["h"]
        s, f = t["start"], t["finish"]
        assert 0 <= s["x"] <= w and 0 <= s["y"] <= h, "start poza światem"
        assert 0 <= f["x"] <= w and 0 <= f["y"] <= h, "meta poza światem"


def test_size_jest_kopia_a_nie_referencja():
    """Sedno powyższego błędu w jednym teście: rozmiar toru nie może się
    zmienić dlatego, że wygenerowaliśmy potem inny tor."""
    t = T.random_track()
    przed = dict(t["size"])
    T.random_track()                    # kolejna generacja mutuje WORLD
    assert t["size"] == przed, "rozmiar toru zmienił się po kolejnej generacji"


# ---------------------------------------------------------------- walidatory

def test_reachable_odrzuca_mete_zamkniete_scianami():
    """Walidator musi umieć powiedzieć NIE — inaczej niczego nie waliduje."""
    t = T.random_track()
    w, h = t["size"]["w"], t["size"]["h"]
    f = t["finish"]
    # zamurowujemy metę ze wszystkich stron (poziom 2 = blokuje każde piętro)
    m = 60
    x0, y0 = f["x"] - m, f["y"] - m
    x1, y1 = f["x"] + f["w"] + m, f["y"] + f["h"] + m
    mur = [[x0, y0, x1, y0, 2], [x1, y0, x1, y1, 2],
           [x1, y1, x0, y1, 2], [x0, y1, x0, y0, 2]]
    zamuro = dict(t)
    zamuro["walls"] = list(t["walls"]) + mur
    assert not T.reachable(zamuro), "walidator przepuścił zamurowaną metę"


def test_trasa_z_linii_prostej_jest_poprawna():
    T.set_world(*T.SIZES["mała"])
    w, h = T.WORLD["w"], T.WORLD["h"]
    linia = [[300, h / 2], [w / 2, h / 2], [w - 300, h / 2]]
    t = T.track_from_line("Prosta", linia)
    assert t["path"], "brak osi toru"
    assert T.reachable(t)
    assert T.centerline_ok(t)


def test_trasa_z_dwoch_punktow_nie_wywala_sie():
    T.set_world(*T.SIZES["mała"])
    t = T.track_from_line("Krótka", [[300, 300], [900, 900]])
    assert "path" in t and len(t["path"]) >= 2


def test_no_hairpins_odrzuca_zawrotke():
    """Zakręt o 170° na krótkich odcinkach nie zmieści się w szerokim korytarzu —
    korytarz złożyłby się sam na siebie i auto utknęłoby w ścianie."""
    import math
    szer = 280
    krotki = szer * 0.2                      # dużo krócej niż promień skrętu
    pts = [[0, 0], [krotki, 0], [krotki - krotki * math.cos(0.17), krotki * 0.17]]
    assert not T.no_hairpins(pts, szer), "walidator przepuścił zawrotkę"


def test_no_hairpins_przepuszcza_lagodny_luk():
    pts = [[0, 0], [500, 0], [1000, 60], [1500, 180]]
    assert T.no_hairpins(pts, 200), "walidator odrzucił łagodny łuk"
