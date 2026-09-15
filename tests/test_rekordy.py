"""Cel 3: osobiste rekordy per tor.

Coś, co przeżywa wyścig — gracz ma po co bić własny czas. Rekord kluczowany
po (trwały klucz gracza, nazwa toru).
"""
import db


KL = "gracz" + "a" * 16      # poprawny klucz (8–64 znaki [A-Za-z0-9_-])


def test_nowy_tor_nie_ma_rekordu():
    assert db.best_time(KL, "ŚwieżyTor") is None


def test_pierwszy_czas_zapisuje_rekord():
    ok, poprzedni = db.update_record(KL, "TorA", "Ala", 62.5)
    assert ok is True and poprzedni is None
    assert db.best_time(KL, "TorA") == 62.5


def test_gorszy_czas_nie_nadpisuje():
    db.update_record(KL, "TorB", "Ala", 60.0)
    ok, poprzedni = db.update_record(KL, "TorB", "Ala", 75.0)
    assert ok is False and poprzedni == 60.0
    assert db.best_time(KL, "TorB") == 60.0


def test_lepszy_czas_nadpisuje():
    db.update_record(KL, "TorC", "Ala", 60.0)
    ok, poprzedni = db.update_record(KL, "TorC", "Ala", 55.2)
    assert ok is True and poprzedni == 60.0
    assert db.best_time(KL, "TorC") == 55.2


def test_rekordy_sa_per_gracz():
    db.update_record(KL, "TorD", "Ala", 50.0)
    inny = "innyklucz" + "b" * 12
    assert db.best_time(inny, "TorD") is None      # inny gracz — własny rekord
    db.update_record(inny, "TorD", "Bob", 99.0)
    assert db.best_time(KL, "TorD") == 50.0        # rekord Ali nietknięty


def test_brak_klucza_lub_toru_nie_wybucha():
    assert db.best_time(None, "X") is None
    assert db.best_time(KL, None) is None
    assert db.update_record(None, "X", "n", 1.0) == (False, None)
