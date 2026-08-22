# 🏁 Wyścigi — multiplayer

Przeglądarkowa gra wyścigowa multiplayer. Sprint A → B, pierwszy na mecie wygrywa.
Jeden wspólny pokój, sterowanie strzałkami, widok 2D top-down.

## Uruchomienie

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000
```

Wejdź w przeglądarce: <http://localhost:8000>

### Gra w LAN-ie (ekipa)

Serwer słucha na `0.0.0.0:8000`, więc reszta wchodzi po IP hosta:

```bash
# znajdź swoje IP w LAN-ie (macOS):
ipconfig getifaddr en0
```

Ekipa otwiera `http://IP_HOSTA:8000` (np. `http://192.168.1.42:8000`).

## Sterowanie

- **W** lub **Spacja** — gaz, **S** — hamulec / wsteczny
- **A / D** — skręt (proporcjonalny do prędkości)
- **R** — booster 🚀 (dopalacz z ograniczoną energią, ładuje się gdy nieużywany; pasek na dole)
- Strzałki działają jako zapas (↑ gaz, ↓ hamulec, ←/→ skręt)
- Mapa jest większa niż ekran — **kamera podąża za autem**, w rogu **minimapa**.
- Dojedź do niebieskiej **METY** — pierwszy wygrywa.

## Pliki

| Plik | Rola |
|------|------|
| `server.py` | FastAPI + WebSocket `/ws`, słownik graczy, rozgłaszanie stanu ~20x/s, wybór zwycięzcy |
| `track.py` | Trasa jako dane (ściany + start A + meta B). Ten sam format wykorzysta edytor map. |
| `static/index.html` | Ekran wejścia (nick + kolor) i canvas |
| `static/game.js` | Fizyka auta, kolizje, sieć, rendering |

## Protokół (JSON po WebSocket `/ws`)

- klient → serwer przy wejściu: `{type:"join", name, color}`
- klient → serwer ~20x/s: `{type:"pos", x, y, angle}`
- serwer → wszyscy ~20x/s: `{type:"state", players:[{id,name,color,x,y,angle}]}`
- meta: klient → `{type:"finish"}`; serwer rozgłasza `{type:"winner", id, name}` (wygrywa pierwsza wiadomość)
- na wejściu serwer wysyła `{type:"welcome", id, winner}`

## Model sieci

Nieautorytatywny, oparty na zaufaniu — świadomie, bo to hobby. Klienci wysyłają własną
pozycję, serwer trzyma słownik graczy i rozsyła stan wszystkim. Gdy pokój opustoszeje,
wyścig resetuje się sam (następna sesja startuje czysto).

## Później (poza zakresem Nocy 1)

Edytor map, przeszkody, serwer autorytatywny, 3D, wersja mobilna (PWA / Capacitor) + sterowanie dotykowe.
