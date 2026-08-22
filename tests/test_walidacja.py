"""Testy walidacji danych przychodzących od klienta.

Każdy z tych testów pilnuje realnej dziury, która kiedyś w tej grze była.
Jeśli któryś zacznie padać, znaczy że wróciła.
"""
import math

import pytest

import server as S


# ------------------------------------------------- liczby od klienta (NaN/inf)

@pytest.mark.parametrize("wejscie", [
    float("nan"), float("inf"), -float("inf"),
    "nan", "inf", "-inf", "NaN",
    None, "abc", "", [], {},
])
def test_liczba_odrzuca_smieci_i_nieskonczonosci(wejscie):
    """NaN przechodził przez float() bez mrugnięcia i lądował w pakiecie stanu
    rozsyłanym WSZYSTKIM. Każde porównanie odległości z NaN daje fałsz, więc
    psuło to zasięg czatu głosowego i kolizje u każdego gracza naraz."""
    assert S._liczba(wejscie, 99.0) == 99.0


@pytest.mark.parametrize("wejscie,oczekiwane", [
    (12.5, 12.5), ("12.5", 12.5), (0, 0.0), (-3, -3.0), ("-0.5", -0.5),
])
def test_liczba_przepuszcza_poprawne(wejscie, oczekiwane):
    assert S._liczba(wejscie, 99.0) == oczekiwane


# ------------------------------------------------------- punkty rysowanej mapy

@pytest.mark.parametrize("smieci", [
    [[1, 2, 3]],            # za dużo wartości
    [["a", "b"]],           # nie liczby
    [[None, None]],
    [5],                    # nie para
    "tekst",
    None,
    {},
    [[float("nan"), 1.0]],  # NaN w środku
])
def test_punkty_mapy_nie_wywalaja_sie_na_smieciach(smieci):
    """Każde z tych wejść rzucało wyjątek, który zrywał połączenie rysującego
    i zostawiał rundę na łasce zegara."""
    assert S._punkty_mapy(smieci) == []


def test_punkty_mapy_przepuszczaja_poprawne():
    assert S._punkty_mapy([[10, 20], [30.5, 40.5]]) == [[10.0, 20.0], [30.5, 40.5]]


def test_punkty_mapy_pomijaja_zle_a_zostawiaja_dobre():
    wynik = S._punkty_mapy([[1, 2], "śmieć", [3, 4], [None, 5]])
    assert wynik == [[1.0, 2.0], [3.0, 4.0]]


def test_punkty_mapy_obcinaja_przed_konwersja():
    """Obcięcie listy MUSI być przed konwersją. Wcześniej klient wysyłający
    milion punktów wymuszał milion wywołań float(), zanim cokolwiek odpadło."""
    milion = [[1.0, 2.0]] * 1_000_000
    wynik = S._punkty_mapy(milion)
    assert len(wynik) == 400


# --------------------------------------------------------- weryfikacja mety

def _tor_testowy():
    return {"size": {"w": 4000, "h": 3000},
            "start": {"x": 100.0, "y": 100.0},
            "finish": {"x": 3000.0, "y": 2000.0, "w": 120.0, "h": 120.0}}


def test_meta_odrzucona_gdy_gracz_jest_daleko(monkeypatch):
    """Sedno dziury: klient nieruszający się z miejsca wysyłał {"type":"finish"}
    i wygrywał wyścig w 0,33 s, a wynik trafiał do bazy."""
    monkeypatch.setattr(S, "current_track", _tor_testowy())
    monkeypatch.setattr(S, "race_started_at", S.time.monotonic() - 30)
    powod = S._meta_odrzucona({"name": "Oszust", "x": 100.0, "y": 100.0})
    assert powod is not None and "nie jest przy mecie" in powod


def test_meta_odrzucona_gdy_czas_fizycznie_niemozliwy(monkeypatch):
    """Nawet stojąc na mecie nie da się tam dotrzeć szybciej, niż pozwala
    maksymalna prędkość z boostem."""
    monkeypatch.setattr(S, "current_track", _tor_testowy())
    monkeypatch.setattr(S, "race_started_at", S.time.monotonic() - 0.05)
    powod = S._meta_odrzucona({"name": "Oszust", "x": 3060.0, "y": 2060.0})
    assert powod is not None and "minimum" in powod


def test_meta_przyjeta_dla_uczciwego_przejazdu(monkeypatch):
    monkeypatch.setattr(S, "current_track", _tor_testowy())
    monkeypatch.setattr(S, "race_started_at", S.time.monotonic() - 45)
    assert S._meta_odrzucona({"name": "Gracz", "x": 3060.0, "y": 2060.0}) is None


def test_meta_odrzucona_bez_toru(monkeypatch):
    monkeypatch.setattr(S, "current_track", None)
    assert S._meta_odrzucona({"name": "X", "x": 0.0, "y": 0.0}) is not None
