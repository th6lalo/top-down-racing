/* Wyścigi multiplayer — klient.
 *
 * Warstwy:
 *  - lokalna fizyka auta (przyspieszenie + skręt, bez silnika fizycznego)
 *  - kolizje ze ścianami trasy
 *  - sieć: ~20x/s wysyła {type:"pos"}, rysuje cudze auta ze {type:"state"}
 *  - meta B: wysyła {type:"finish"}, serwer ogłasza zwycięzcę
 */

const canvas = document.getElementById("c");
let ctx = canvas.getContext("2d");   // let — podmieniany chwilowo przy rysowaniu miniaturek
const statusEl = document.getElementById("status");
const banner = document.getElementById("banner");
const bannerBig = document.getElementById("bannerBig");
const bannerSub = document.getElementById("bannerSub");

// ---- Stan ----
let track = null;              // dane trasy z /track
let ws = null;
let myId = null;
let joined = false;
let finished = false;          // czy już wysłałem finish
let winnerName = null;         // ogłoszony zwycięzca
let mode = "join";             // "join" | "drawing" | "waiting" | "spectating" | "racing"

// Rysowanie trasy (gdy jesteś wylosowanym rysującym)
let drawStroke = [];           // punkty linii we współrzędnych świata
let drawingActive = false;     // czy trzymam wciśniętą mysz
let drawWorld = null;          // {w,h} świata do rysowania
let drawDeadline = 0;          // performance.now() auto-wysyłki
// ---- Telemetria (diagnostyka płynności) ----
const tel = {
  frames: 0, fps: 0, worstFrame: 0,     // klatki
  states: 0, stateRate: 0,              // pakiety stanu z serwera
  lastStateT: 0, arrGaps: [],           // odstępy między pakietami (jitter sieci)
  ping: 0, lastPingSent: 0,
  voiceIn: 0, voiceOut: 0, voiceInRate: 0, voiceOutRate: 0,   // pakiety głosu /s
  bytesIn: 0, bytesOut: 0, kbpsIn: 0, kbpsOut: 0,
  windowStart: 0,
};

let lbData = [];               // dane rankingu (tabeli wyników) z serwera
let raceStandings = [];        // kolejność dojazdów w bieżącym wyścigu

// ---- Ustawienia + dźwięk silnika (Web Audio) ----
const settings = { sound: true, sfx: true, engineVol: 0.45, sfxVol: 0.7, cichszySilnik: false, grafikiAut: true, zapisujWyniki: true, hearOthers: false, volume: 0.5, pitch: 1.0, voice: false, showRange: true, voiceRange: 900 };   // domyślnie ~4 długości ekranu — na dużych mapach 240 px to było prawie nic
let audioCtx = null, masterGain = null, distCurve = null, myEngine = null;
let engineBus = null, sfxBus = null;   // osobne szyny: silnik i efekty
let engineBuffer = null;       // wczytana próbka silnika (AudioBuffer) albo null = syntezator
const otherEngines = {};       // id -> węzły silnika

const othersById = {};         // cudze auta: id -> {x,y,angle (rysowane), tx,ty,ta (cel), name,color}
const me = {                   // moje auto — wektor prędkości (vx,vy) dla driftu
  x: 120, y: 600, angle: -Math.PI / 2,
  vx: 0, vy: 0,
  name: "", color: "#ff5a5a", body: "sport", smoke: "#cfcfcf",
  level: 0,                    // 0 = parter, 1 = most
};

// Dym za autami — lekkie cząstki (limit, żeby nie obciążać słabszego sprzętu)
const puffs = [];
function puffLimit() { return quality >= 2 ? 95 : 45; }   // przy słabym FPS mniej cząstek
function emitSmoke(x, y, angle, color, power) {
  if (puffs.length >= puffLimit()) return;
  const back = angle + Math.PI;
  puffs.push({
    x: x + Math.cos(back) * 16 + (Math.random() - 0.5) * 5,
    y: y + Math.sin(back) * 16 + (Math.random() - 0.5) * 5,
    vx: Math.cos(back) * 22 * power + (Math.random() - 0.5) * 14,
    vy: Math.sin(back) * 22 * power + (Math.random() - 0.5) * 14,
    r: 4 + Math.random() * 3, life: 1, color,
  });
}
function updatePuffs(dt) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.r += 22 * dt;
    p.life -= dt * 1.5;
    if (p.life <= 0) puffs.splice(i, 1);
  }
}
// Dym cudzych aut — na podstawie ich prędkości z sieci.
function emitOthersSmoke(dt) {
  if (mode !== "racing" || quality < 1) return;
  for (const id in othersById) {
    const o = othersById[id];
    // tylko gdy widoczne na ekranie — cząstki poza kadrem to czysta strata
    const poza = o.x < cam.x - 80 || o.x > cam.x + VIEW.w + 80 ||
                 o.y < cam.y - 80 || o.y > cam.y + VIEW.h + 80;
    if (poza || o.vx === undefined) { wheelMem.delete("o" + id); continue; }
    // Sieć nie przesyła wektora prędkości, ale liczymy go z surowych pakietów (o.vx/o.vy).
    // Świadomie NIE różnicujemy pozycji rysowanej — interpolacja ją wygładza i stłumiłaby
    // właśnie tę boczną składową, po której poznajemy drift.
    const spd = o.speed || 0;
    const lat = o.vx * -Math.sin(o.angle) + o.vy * Math.cos(o.angle);
    emitDrift("o" + id, o, lat, spd, o.level || 0, o.smoke);
    if (spd >= 60 && Math.random() < 0.18) emitSmoke(o.x, o.y, o.angle, o.smoke || "#cfcfcf", 1);
  }
}

function drawPuffs() {
  for (const p of puffs) {
    ctx.globalAlpha = Math.max(0, p.life) * 0.5;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}


// ---- Ślady driftu (styl NFS) --------------------------------------------
// Gdy tył ucieka w bok, opony piszczą: zostawiają czarne smugi na asfalcie
// i dymią spod kół. Smuga to krótki odcinek z własnym „życiem" — blaknie sama.
// Każda smuga ma PIĘTRO, więc jadąc wiaduktem nie widać pod sobą śladów z parteru.
let mySlip = 0;                 // sinus kąta poślizgu mojego auta
const marks = [];
const MARK_LIFE = 7.0;          // po tylu sekundach smuga znika całkiem
const MARK_MAX = 380;           // twardy limit — najstarsze wypadają
const DRIFT_MIN = 0.26;         // sinus kąta poślizgu, od którego opony piszczą
const wheelMem = new Map();     // ostatnia pozycja kół, osobno dla każdego auta

function rearWheels(x, y, angle, B) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const wx = -B.w * 0.30, wy = B.h * 0.52;         // oś tylna, oba koła
  return [[x + wx * c - wy * s, y + wx * s + wy * c],
          [x + wx * c + wy * s, y + wx * s - wy * c]];
}

// lat = boczna składowa prędkości (to samo, co gasi przyczepność w fizyce)
function emitDrift(key, car, lat, spd, lvl, smokeColor) {
  const B = bodyOf(car.body);
  const teraz = rearWheels(car.x, car.y, car.angle, B);
  const stare = wheelMem.get(key);
  wheelMem.set(key, teraz);
  if (quality < 1 || !stare || spd < 90) return;
  const slip = Math.abs(lat) / spd;                // sinus kąta poślizgu
  if (slip < DRIFT_MIN) return;
  const moc = Math.min(1, (slip - DRIFT_MIN) / 0.45);
  for (let i = 0; i < 2; i++) {
    const [x1, y1] = stare[i], [x2, y2] = teraz[i];
    if (Math.abs(x2 - x1) > 90 || Math.abs(y2 - y1) > 90) continue;  // respawn — bez smugi przez pół mapy
    marks.push({ x1, y1, x2, y2, lvl, life: MARK_LIFE, a0: 0.30 + moc * 0.45 });
  }
  if (marks.length > MARK_MAX) marks.splice(0, marks.length - MARK_MAX);
  if (quality >= 2 && Math.random() < moc * 0.75) {                  // dym spod kół
    const [wx, wy] = teraz[Math.random() < 0.5 ? 0 : 1];
    emitSmoke(wx, wy, car.angle, smokeColor || "#cfcfcf", 0.4 + moc);
  }
}

function updateMarks(dt) {
  for (let i = marks.length - 1; i >= 0; i--) {
    if ((marks[i].life -= dt) <= 0) marks.splice(i, 1);
  }
}

function clearMarks() { marks.length = 0; wheelMem.clear(); }

// Rysowanie kubełkami przezroczystości: kilka pociągnięć zamiast setek.
function drawMarks(lvl) {
  if (!marks.length) return;
  const KOSZE = 5;
  ctx.lineCap = "round";
  // Asfalt jest ciemny (#2c3038), więc sama czerń ginie — smuga musi być
  // wyraźnie ciemniejsza od podłoża i odrobinę szersza niż ślad opony.
  ctx.strokeStyle = "#0c0d10";
  ctx.lineWidth = 5.2;
  for (let b = KOSZE; b >= 1; b--) {
    let jest = false;
    ctx.beginPath();
    for (const m of marks) {
      if (m.lvl !== lvl) continue;
      const si = m.a0 * (m.life / MARK_LIFE);      // siła = mocny drift × ile zostało życia
      if (Math.ceil(si * KOSZE) !== b) continue;
      ctx.moveTo(m.x1, m.y1); ctx.lineTo(m.x2, m.y2);
      jest = true;
    }
    if (!jest) continue;
    ctx.globalAlpha = (b / KOSZE) * 0.95;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const CAR = { w: 34, h: 18 };  // wymiary auta (długość x szerokość)

// Wygląd 2.5D (styl „Factorio"): grubość i wysokość murków, wektor cienia
const WALL_W = 16, WALL_H = 8;      // SH_X/SH_Y są w carart.js — wspólne z autami

// Fizyka — model wektorowy z przyczepnością boczną (drift)
const ENGINE = 560;            // siła napędu px/s^2
const REVERSE_FORCE = 320;
const MAX_SPEED = 430;         // limit prędkości do przodu
const MAX_REVERSE = -180;
const COAST_DRAG = 0.6;        // opór na wybiegu (część prędkości/s)
const TURN_RATE = 3.3;         // rad/s przy pełnej prędkości
const LAT_FRICTION = 6.0;      // jak szybko gasną poślizgi boczne (wyżej = większa przyczepność)
const LAT_FRICTION_BOOST = 2.6;// na boostcie mniejsza przyczepność → mocniejszy drift
const INTERP_RATE = 14;        // płynność doganiania cudzych aut między pakietami
                               // promień kolizji auto-auto: per karoseria (BODIES[...].radius)
const WALL_BOUNCE = 0.35;      // sprężystość odbicia od ściany (0=brak, 1=pełne). Im mocniej wjedziesz, tym większy odskok.

// Odliczanie przed startem (3,2,1) — jazda zablokowana dopóki > 0
let countdown = 0;             // sekundy do startu
let countdownWasActive = false;
const countdownEl = document.getElementById("countdown");

// Booster (R) — dopalacz z ograniczoną energią, ładuje się gdy nieużywany
const BOOST_MAX = 1.8;         // sekundy dostępnego boostu
const BOOST_RECHARGE = 0.45;   // energii/s odzyskiwane (pełne ~4s)
const BOOST_SPEED_MULT = 1.8;  // ile razy większy limit prędkości na booście
const BOOST_ACCEL_MULT = 2.4;  // ile razy mocniejsze przyspieszenie na booście
let boostAvail = 0;            // aktualna energia boostu (s) — na starcie wyścigu zawsze 0
let boosting = false;

// ---- Widok / kamera (mapa jest większa niż ekran) ----
const VIEW = { w: 1100, h: 720 };  // rozmiar widocznego okna gry
const cam = { x: 0, y: 0 };
const boostBar = document.getElementById("boostFill");
const waitOverlay = document.getElementById("waitOverlay");
const drawUI = document.getElementById("drawUI");
const drawTimerEl = document.getElementById("drawTimer");

// ---- Wejście ----
const keys = {};
const GAME_KEYS = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight",
                   "w","a","s","d"," ","v"];   // v = push-to-talk (mów gdy trzymasz)
function typingInField(e) {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
}
addEventListener("keydown", (e) => {
  if (typingInField(e)) return;  // nie przechwytuj klawiszy podczas wpisywania nicku
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (GAME_KEYS.includes(k)) {
    keys[k] = true;
    e.preventDefault();  // m.in. spacja nie scrolluje strony
  }
});
addEventListener("keyup", (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys[k] = false;
});

// skróty czytelności wejścia (Spacja = booster, W/↑ = gaz, S/↓ lub W+S = hamulec)
const K = {
  gas:   () => keys.w || keys.ArrowUp,
  brake: () => keys.s || keys.ArrowDown,
  left:  () => keys.a || keys.ArrowLeft,
  right: () => keys.d || keys.ArrowRight,
  boost: () => keys[" "],
};

const trackLabel = document.getElementById("trackLabel");

// ===== Sterowanie dotykowe (telefon/tablet) =====
const isTouch = matchMedia("(pointer: coarse)").matches ||
                ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add("touch");

{
  // Przyciski ustawiają te same flagi co klawiatura — reszta gry nic nie musi wiedzieć
  // o dotyku. Obsługa wielodotyku: każdy palec pamiętany osobno (gaz + skręt naraz).
  const held = new Map();
  for (const btn of document.querySelectorAll(".tbtn")) {
    const k = btn.dataset.key;
    const down = (e) => {
      e.preventDefault();
      held.set(e.pointerId, k);
      keys[k] = true;
      btn.classList.add("on");
      if (k === "v" || k === " ") ensureAudio();   // gest odblokowuje dźwięk
    };
    const up = (e) => {
      e.preventDefault();
      held.delete(e.pointerId);
      keys[k] = false;
      btn.classList.remove("on");
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", (e) => { if (held.has(e.pointerId)) up(e); });
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}

// ---- Start pętli (trasa przyjdzie z serwera: race_start / joined) ----
canvas.width = VIEW.w;
canvas.height = VIEW.h;
requestAnimationFrame(loop);

function applyTrack(t) {
  track = t;
  clearMarks();                      // nowy tor zaczyna się czystym asfaltem
  if (trackLabel) trackLabel.textContent = "🏁 " + (t.name || "Tor");
  runsCache = null;                  // przelicz odcinki mostów przy nowym torze
  buildMinimap();                    // przelicz statyczne tło minimapy raz (nie co klatkę)
}

// Minimapa: statyczne tło (ściany + meta) rysujemy RAZ do offscreen canvas.
let miniBg = null, miniMW = 220, miniMH = 0, miniS = 0;
function buildMinimap() {
  if (!track) return;
  const W = track.size.w, H = track.size.h;
  miniMH = miniMW * H / W;
  miniS = miniMW / W;
  const c = document.createElement("canvas");
  c.width = Math.round(miniMW); c.height = Math.round(miniMH);
  const mc = c.getContext("2d");
  mc.fillStyle = "#0d1a14"; mc.fillRect(0, 0, c.width, c.height);
  mc.strokeStyle = "#39506a"; mc.lineWidth = 1; mc.strokeRect(0, 0, c.width, c.height);
  mc.strokeStyle = "#8fa0b8"; mc.lineWidth = 1;
  mc.beginPath();
  for (const w of track.walls) { mc.moveTo(w[0] * miniS, w[1] * miniS); mc.lineTo(w[2] * miniS, w[3] * miniS); }
  mc.stroke();
  const f = track.finish;
  mc.fillStyle = "#7ea2ff";
  mc.fillRect(f.x * miniS, f.y * miniS, Math.max(3, f.w * miniS), Math.max(3, f.h * miniS));
  miniBg = c;
}

function resetToStart() {
  if (!track) return;
  const s = track.start;
  me.angle = s.angle;
  me.vx = 0;
  me.vy = 0;
  boostAvail = 0;          // każdy wyścig zaczynasz z pustym boostem (ładuje się w trakcie)
  me.level = 0;            // start zawsze na parterze
  // Rozstaw auta w poprzek startu (żeby nie startowały na jednym pikselu),
  // a jeśli wyjdzie na ścianę — poszukaj wolnego miejsca obok.
  const perp = s.angle + Math.PI / 2;
  const slot = ((myId || 0) % 5) - 2;         // -2..2
  let sx = s.x + Math.cos(perp) * slot * 26;
  let sy = s.y + Math.sin(perp) * slot * 26;
  [me.x, me.y] = freeSpawn(sx, sy, s.x, s.y, me.angle);
}

// Znajdź najbliższe wolne miejsce na spawn (jeśli podane jest w ścianie).
function freeSpawn(x, y, fx, fy, angle) {
  if (!carHitsWalls(x, y, angle)) return [x, y];
  for (let r = 22; r <= 180; r += 22) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const nx = fx + Math.cos(a) * r, ny = fy + Math.sin(a) * r;
      if (!carHitsWalls(nx, ny, angle)) return [nx, ny];
    }
  }
  return [fx, fy];
}

// ---- Sieć ----
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log("WebSocket połączony");
    statusEl.textContent = "połączono";
  };

  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      tel.bytesIn += ev.data.byteLength; tel.voiceIn++;
      onVoiceBinary(ev.data); return;                                        // głos = binarnie
    }
    tel.bytesIn += ev.data.length;
    const msg = JSON.parse(ev.data);
    if (msg.type === "pong") { tel.ping = Math.round(performance.now() - msg.t); return; }
    switch (msg.type) {
      case "welcome":
        myId = msg.id;
        console.log("Moje id:", myId);
        break;
      case "lobby_state":
        // Dopiero po wejściu do gry — inaczej broadcast zasłoniłby ekran wyboru auta.
        // I TYLKO gdy serwer faktycznie jest w lobby: w trakcie wyścigu/rysowania
        // aktualizujemy po cichu listę, żeby nie zabierać widoku i nie pokazywać
        // przycisku „Gotowy", który i tak nic by nie zrobił.
        if (!joined) break;
        if (msg.phase === "lobby" || msg.phase === "idle") enterLobby(msg.players || []);
        else lobbyPlayers = msg.players || [];
        break;
      case "joined":
        // Serwer potwierdził wejście i podał rolę w bieżącej fazie.
        if (msg.phase === "racing" && msg.spectator) enterSpectator(msg.track, msg.winner);
        else if (msg.phase === "drawing") enterWaiting(msg.drawer_name);
        else if (msg.phase === "lobby") mode = "lobby";
        // idle → zaraz przyjdzie draw_start albo race_start
        break;
      case "draw_start":
        // Dopóki gracz nie kliknął „Dołącz", NIC nie może zabrać mu ekranu wyboru auta.
        if (!joined) break;
        banner.classList.remove("show");
        if (msg.drawer_id === myId) enterDrawing(msg.world, msg.seconds);
        else enterWaiting(msg.drawer_name);
        break;
      case "race_start":
        if (!joined) break;
        startRace(msg.track);
        break;
      case "roster": {
        // Dane stałe (nick, kolor, karoseria, dym) przychodzą TYLKO przy zmianie
        // składu, a nie 30 razy na sekundę w każdym pakiecie stanu.
        rosterById = {};
        for (const pl of msg.players || []) rosterById[pl.id] = pl;
        for (const id in othersById) {
          const r = rosterById[id];
          if (r) Object.assign(othersById[id],
                 { name: r.name, color: r.color, body: r.body, smoke: r.smoke });
        }
        break;
      }
      case "state": {
        // telemetria: tempo i równomierność napływu pakietów
        const nowT = performance.now();
        if (tel.lastStateT) {
          tel.arrGaps.push(nowT - tel.lastStateT);
          if (tel.arrGaps.length > 60) tel.arrGaps.shift();
        }
        tel.lastStateT = nowT; tel.states++;
        // Zapamiętaj CEL każdego auta; rysowaną pozycję dogonimy płynnie w pętli.
        const ids = new Set();
        for (const pl of msg.players) {
          if (pl.id === myId) continue;
          ids.add(pl.id);
          let o = othersById[pl.id];
          if (!o) o = othersById[pl.id] = { buf: [], x: pl.x, y: pl.y, angle: pl.angle };
          // dane stałe biorą się ze składu; pakiet stanu niesie już tylko ruch
          const r = rosterById[pl.id];
          if (r) {
            o.name = r.name; o.color = r.color;
            o.body = r.body || "sport"; o.smoke = r.smoke || "#cfcfcf";
          } else if (o.name === undefined) {
            o.name = ""; o.color = "#ff5a5a"; o.body = "sport"; o.smoke = "#cfcfcf";
          }
          o.level = pl.level || 0;
          const now = performance.now();
          const last = o.buf[o.buf.length - 1];
          if (last) {                                       // prędkość (dźwięk silnika + kolizje)
            const dts = (now - last.t) / 1000;
            if (dts > 0) {
              o.vx = (pl.x - last.x) / dts;
              o.vy = (pl.y - last.y) / dts;
              o.speed = Math.hypot(o.vx, o.vy);
            }
          }
          // Pomiń duplikat (ta sama pozycja co ostatnia) — inaczej interpolacja
          // dostaje odcinek „bez ruchu", co widać jako zacinanie/przeskoki.
          const dup = last && Math.abs(pl.x - last.x) < 0.6 && Math.abs(pl.y - last.y) < 0.6
                      && Math.abs(angleDiff(pl.angle, last.a)) < 0.002;
          if (!dup) {
            o.buf.push({ t: now, x: pl.x, y: pl.y, a: pl.angle });
            if (o.buf.length > 16) o.buf.shift();           // trzymaj ostatnie ~0.5 s
          }
        }
        for (const id in othersById) if (!ids.has(+id)) delete othersById[id];
        break;
      }
      case "finished":
        if (!joined) break;
        raceStandings.push({ name: msg.name, place: msg.place, time: msg.time });
        showToast(`🏁 ${msg.name} — ${msg.place}. miejsce · ${msg.time}s`);
        break;
      case "leaderboard":
        lbData = msg.top || [];
        renderLeaderboard();
        break;
      case "winner":
        if (!joined) break;
        showWinner(msg.name, msg.time);
        break;
    }
  };

  ws.onclose = () => {
    statusEl.textContent = "rozłączono — odświeżanie za 2s";
    setTimeout(() => location.reload(), 2000);
  };
  ws.onerror = () => { statusEl.textContent = "błąd połączenia"; };
}
connect();

// Wysyłanie pozycji ~30x/s, ale ZAWSZE tuż po klatce fizyki — dzięki temu każdy
// pakiet niesie świeżą pozycję (osobny zegar dublował pozycje przy niższym FPS,
// co u innych wyglądało jak przeskoki).
let lastSend = 0;
function sendPos(now) {
  if (mode !== "racing" || !ws || ws.readyState !== WebSocket.OPEN) return;
  if (now - lastSend < 32) return;
  lastSend = now;
  const p = JSON.stringify({
    type: "pos",
    x: Math.round(me.x * 10) / 10,
    y: Math.round(me.y * 10) / 10,
    angle: Math.round(me.angle * 1000) / 1000,
    level: me.level,
  });
  tel.bytesOut += p.length;
  ws.send(p);
}

// ---- Wejście do gry ----
document.getElementById("joinBtn").addEventListener("click", () => {
  const name = (document.getElementById("name").value || "").trim() || "Gracz";
  const color = document.getElementById("color").value || "#ff5a5a";
  const smoke = document.getElementById("smoke").value || "#cfcfcf";
  const body = chosenBody;
  me.name = name;
  me.color = color;
  me.smoke = smoke;
  me.body = body;
  joined = true;
  ensureAudio();                 // gest użytkownika odblokowuje dźwięk w przeglądarce
  const zapisuj = !!(document.getElementById("setSave") || {}).checked;
  settings.zapisujWyniki = zapisuj; saveSettings();
  jestemGosciem = !zapisuj;
  const send = () => ws.send(JSON.stringify({
    type: "join", name, color, body, smoke,
    guest: !zapisuj,                 // gość gra normalnie, ale bez zapisu wyników
    klucz: kluczGracza(),
  }));
  if (ws && ws.readyState === WebSocket.OPEN) send();
  else ws.addEventListener("open", send, { once: true });
  hideJoin();
  showWait("⏳ Wchodzę do lobby…");        // do czasu odpowiedzi serwera
  canvas.focus();
});

// ---- Wybór karoserii (miniaturki na ekranie wejścia) ----
let chosenBody = "sport";
let paintAllPreviews = null;
let rosterById = {};        // dane stałe graczy — przychodzą przy zmianie składu
let jestemGosciem = true;   // dopóki nie dołączy — zakładamy tryb gościa
{
  const opts = [...document.querySelectorAll(".body-opt")];
  const colorInp = document.getElementById("color");

  function paintPreview(btn) {
    const cv = btn.querySelector("canvas");
    const { g: c2, w, h, dpr } = hidpiCtx(cv, 86, 52);
    const z = zoomDoKanwy(btn.dataset.body, w, h);
    const prevCtx = ctx;
    ctx = c2;                                    // paintBody rysuje po globalnym ctx
    c2.save();
    c2.translate(w / 2, h / 2 + h * 0.12);       // bryła rośnie w górę, więc środek niżej
    c2.scale(z, z);
    paintBody(btn.dataset.body, colorInp.value || "#ff5a5a",
              btn.classList.contains("selected"), z * dpr);
    c2.restore();
    ctx = prevCtx;
  }
  function paintAll() { opts.forEach(paintPreview); }
  paintAllPreviews = paintAll;   // przełącznik grafik odświeża podglądy
  // Grafiki aut dochodzą po chwili — przemaluj miniaturki, gdy będą gotowe.
  gdyGrafikiGotowe(paintAll);

  // paski statystyk pod miniaturką — od razu widać, czym różnią się klasy
  function addStats(btn) {
    if (btn.querySelector(".stats")) return;
    const B = bodyOf(btn.dataset.body);
    const rows = [
      ["PRZYSP", B.acc / 1.4],
      ["PRĘDK", B.spd / 1.15],
      ["SKRĘT", B.turn / 1.5],
      ["MASA", B.mass / 2.3],
    ];
    const box = document.createElement("div");
    box.className = "stats";
    for (const [name, v] of rows) {
      const lab = document.createElement("span"); lab.textContent = name;
      const bar = document.createElement("i");
      const fill = document.createElement("b");
      fill.style.width = Math.round(Math.max(0.08, Math.min(1, v)) * 100) + "%";
      bar.appendChild(fill);
      box.append(lab, bar);
    }
    btn.appendChild(box);
  }
  setTimeout(() => opts.forEach(addStats), 0);   // po załadowaniu skryptu (BODIES niżej)

  opts.forEach(btn => btn.addEventListener("click", () => {
    opts.forEach(o => o.classList.remove("selected"));
    btn.classList.add("selected");
    chosenBody = btn.dataset.body;
    paintAll();
  }));
  if (colorInp) colorInp.addEventListener("input", paintAll);
  setTimeout(paintAll, 0);   // po pełnym załadowaniu skryptu (BODIES deklarowane niżej)
}

// Rewanż — wyślij prośbę o nowy wyścig do wszystkich
document.getElementById("rematchBtn").addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "reset" }));
  }
});

// ---- Pętla gry ----
let lastT = performance.now();
let lastPhys = performance.now();  // zegar fizyki (osobny od renderu)
let accum = 0;                     // akumulator fizyki o stałym kroku
const FIXED_DT = 1 / 60;           // fizyka zawsze 60 Hz, niezależnie od FPS renderu

// FIZYKA NA WŁASNYM ZEGARZE — niezależna od FPS renderu. Dzięki temu nawet gdy
// komuś gra rysuje 12 klatek/s, jego auto liczy się 60x/s i wysyła równe pozycje
// (wcześniej wysyłka siedziała w klatce renderu → inni widzieli przeskoki).
setInterval(() => {
  const now = performance.now();
  let dt = Math.min(0.25, (now - lastPhys) / 1000);
  lastPhys = now;
  if (countdown > 0) countdown = Math.max(0, countdown - dt);
  accum += dt;
  let steps = 0;
  while (accum >= FIXED_DT && steps < 8) {
    if (mode === "racing" && !winnerName && countdown <= 0) update(FIXED_DT);
    accum -= FIXED_DT; steps++;
  }
  sendPos(now);
}, 16);

function loop(now) {
  const dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  syncUiState();                   // klasa stanu na <body> (steruje widocznością warstw)
  interpolateOthers(dt);
  emitOthersSmoke(dt);
  updatePuffs(dt);
  updateMarks(dt);
  CAR_QUALITY = quality;           // wygląd aut podąża za auto-jakością
  render();
  updateCountdownUI();
  updateDrawTimer();
  updateEngines();
  updateVoiceVolumes();
  // wskaźnik „mówisz" (push-to-talk)
  const pttEl = document.getElementById("ptt");
  if (pttEl) pttEl.classList.toggle("show", !!(settings.voice && keys.v));
  updateTelemetry(now, dt);
  // pasek boostu
  if (boostBar) {
    boostBar.style.width = (100 * boostAvail / bodyOf(me.body).bMax) + "%";
    boostBar.style.background = boosting ? "#ffd24a" : "#4f7cff";
  }
  requestAnimationFrame(loop);
}

function update(dt) {
  // Booster (Spacja): pobiera energię gdy trzymany, w przeciwnym razie się ładuje.
  const BB = bodyOf(me.body);
  boosting = K.boost() && boostAvail > 0;
  if (boosting) boostAvail = Math.max(0, boostAvail - dt);
  else boostAvail = Math.min(BB.bMax, boostAvail + BB.bRe * dt);

  // Prędkość „do przodu" względem obecnej osi auta — potrzebna do skrętu.
  let h = { x: Math.cos(me.angle), y: Math.sin(me.angle) };
  const fwd0 = me.vx * h.x + me.vy * h.y;

  // Skręt karoserii (kierunek zależy od jazdy do przodu/tyłu, siła od prędkości).
  // Więcej autorytetu przy wolnej jeździe — auto reaguje nawet gdy prawie stoi.
  const speedFactor = Math.min(1, Math.abs(fwd0) / 90 + 0.30);
  const dir = fwd0 >= 0 ? 1 : -1;
  const steer = (K.left() ? -1 : 0) + (K.right() ? 1 : 0);
  const dAngle = steer * TURN_RATE * bodyOf(me.body).turn * dt * speedFactor * dir;
  if (dAngle !== 0 && !carHitsWalls(me.x, me.y, me.angle + dAngle)) {
    me.angle += dAngle;
  }

  // Rozkład prędkości na nową oś auta: składowa wzdłużna (fwd) i boczna (lat).
  h = { x: Math.cos(me.angle), y: Math.sin(me.angle) };
  const p = { x: -h.y, y: h.x };
  let fwd = me.vx * h.x + me.vy * h.y;
  let lat = me.vx * p.x + me.vy * p.y;

  // Napęd wzdłuż osi. Hamulec ma priorytet: S/↓ — a także W+S (↑+↓) naraz —
  // hamuje/cofa. Jedziesz tylko gdy trzymasz sam gaz (bez hamulca).
  const B = bodyOf(me.body);                   // osiągi zależne od karoserii
  const engine = (boosting ? ENGINE * BOOST_ACCEL_MULT : ENGINE) * B.acc;   // moc boostu niżej
  if (K.brake()) fwd -= REVERSE_FORCE * dt;
  else if (K.gas() || boosting) fwd += engine * dt;
  else fwd *= (1 - COAST_DRAG * dt);           // wybieg
  const maxF = (boosting ? MAX_SPEED * B.bPow : MAX_SPEED) * B.spd;   // boost zależny od klasy
  fwd = Math.max(MAX_REVERSE, Math.min(maxF, fwd));

  // DRIFT: opony gaszą poślizg boczny. Im mniej — tym auto bardziej się ślizga.
  const latFric = (boosting ? LAT_FRICTION_BOOST : LAT_FRICTION) * B.grip;
  lat *= Math.max(0, 1 - latFric * dt);

  // Złóż z powrotem wektor prędkości.
  me.vx = h.x * fwd + p.x * lat;
  me.vy = h.y * fwd + p.y * lat;

  const prevX = me.x, prevY = me.y;     // do wykrycia przejazdu przez bramkę mostu
  // Ruch z POŚLIZGIEM po ścianie (dowolny kąt). Usuwamy tylko składową prędkości
  // „w ścianę" (+ lekkie odbicie), a wzdłuż ściany jedziesz dalej — auto nie staje.
  let tx = me.x + me.vx * dt, ty = me.y + me.vy * dt;
  const n = wallNormal(tx, ty, me.angle);
  if (!n) {
    me.x = tx; me.y = ty;
  } else {
    const vn = me.vx * n[0] + me.vy * n[1];           // składowa wzdłuż normalnej (ujemna = w ścianę)
    if (vn < 0) {
      sfxWall(-vn / 260);                             // głośność wprost z siły uderzenia
      me.vx -= (1 + WALL_BOUNCE) * vn * n[0];         // odbij składową normalną, zostaw styczną (ślizg)
      me.vy -= (1 + WALL_BOUNCE) * vn * n[1];
    }
    tx = me.x + me.vx * dt; ty = me.y + me.vy * dt;
    if (!wallNormal(tx, ty, me.angle)) { me.x = tx; me.y = ty; }
    else { me.x += n[0] * 2; me.y += n[1] * 2; }      // wciąż blokuje → wypchnij wzdłuż normalnej
  }

  // Dym z rury — gdy jedziesz (mocniej na gazie i boostcie)
  const spd = Math.hypot(me.vx, me.vy);
  if (quality >= 1 && spd > 40 && (K.gas() || boosting) && Math.random() < (boosting ? 0.9 : 0.35)) {
    emitSmoke(me.x, me.y, me.angle, me.smoke, boosting ? 1.8 : 1);
  }

  mySlip = spd > 1 ? Math.abs(lat) / spd : 0;   // ten sam poślizg napędza smugi i pisk opon
  emitDrift("ja", me, lat, spd, me.level || 0, me.smoke);   // ślady opon przy poślizgu

  checkGates(prevX, prevY);        // wjazd/zjazd z mostu
  // Kolizje z innymi autami — rozpychanie (każdy klient rozpycha własne auto).
  resolveCarCollisions();

  // Gwarancja: nigdy nie utknij w ścianie — jak nachodzisz, delikatnie wypchnij.
  if (carHitsWalls(me.x, me.y, me.angle)) unstick();

  // Meta
  if (!finished && inFinish(me.x, me.y)) {
    finished = true;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "finish" }));
    }
  }
}

// Wypchnij auto z najbliższej ściany (gdy jakoś w niej ugrzęźnie).
function unstick() {
  for (let r = 4; r <= 48; r += 4) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const nx = me.x + Math.cos(a) * r, ny = me.y + Math.sin(a) * r;
      if (!carHitsWalls(nx, ny, me.angle)) { me.x = nx; me.y = ny; return; }
    }
  }
}

// Najkrótsza różnica kątów (z zawijaniem), do interpolacji.
function angleDiff(target, cur) {
  return Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
}

// Kolizje auto-auto: jeśli nachodzę na inne auto, wypycham się (połowicznie —
// drugie auto robi to samo po swojej stronie) i gaszę prędkość „w nie".
function resolveCarCollisions() {
  const myB = bodyOf(me.body);
  for (const id in othersById) {
    const o = othersById[id];
    if ((o.level || 0) !== me.level) continue;      // inne piętro — nie zderzają się
    const oB = bodyOf(o.body);
    const minD = myB.radius + oB.radius;
    const dx = me.x - o.x, dy = me.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d < minD && d > 0.001) {
      const nx = dx / d, ny = dy / d;
      // Udział w rozpychaniu wg masy: lżejsze auto ustępuje bardziej.
      const share = oB.mass / (myB.mass + oB.mass);
      const push = (minD - d) * share;
      if (!carHitsWalls(me.x + nx * push, me.y, me.angle)) me.x += nx * push;
      if (!carHitsWalls(me.x, me.y + ny * push, me.angle)) me.y += ny * push;

      // Odbicie: prędkość zbliżania + kopniak od masy drugiego auta.
      const ovx = (o.vx || 0), ovy = (o.vy || 0);
      const relN = (me.vx - ovx) * nx + (me.vy - ovy) * ny;   // <0 = zbliżamy się
      let imp = 0;
      if (relN < 0) imp += -(1 + 0.35) * relN * share;        // impuls (0.35 = sprężystość)
      const oSpeed = Math.hypot(ovx, ovy);                    // ciężki taranuje lekkiego
      if (oSpeed > 60) imp += Math.min(1, oSpeed / MAX_SPEED) * 50 * (oB.mass / myB.mass) * share;
      imp = Math.min(imp, 430);                               // limit — żeby nie wystrzeliwało w kosmos
      sfxCrash(imp / 260);                                    // blacha o blachę, im mocniej tym głośniej
      me.vx += imp * nx; me.vy += imp * ny;
    }
  }
}

// Odliczanie 3-2-1 przed startem.
function startCountdown() { countdown = 3.0; }

function updateCountdownUI() {
  if (!countdownEl) return;
  if (countdown > 0) {
    countdownEl.textContent = String(Math.ceil(countdown));
    countdownEl.classList.add("show");
    countdownWasActive = true;
  } else if (countdownWasActive) {
    countdownWasActive = false;
    countdownEl.textContent = "START!";
    setTimeout(() => countdownEl.classList.remove("show"), 600);
  }
}

// Płynne doganianie cudzych aut do ostatnio odebranej pozycji.
// Interpolacja ze snapshotów: renderuj cudze auta z małym opóźnieniem (bufor),
// płynnie między dwiema zapisanymi pozycjami — koniec z „teleportowaniem".
// Bufor interpolacji dostosowuje się do realnego jittera sieci: przy stabilnym
// łączu mały (mała zwłoka), przy drgającym większy (płynność ważniejsza).
let otherDelay = 150;
function updateInterpDelay() {
  const g = tel.arrGaps;
  if (g.length < 8) return;
  const mean = g.reduce((s, v) => s + v, 0) / g.length;
  const jit = stdev(g);
  const want = Math.max(90, Math.min(420, mean + jit * 2.5 + 40));
  otherDelay += (want - otherDelay) * 0.05;      // płynne dostrajanie
}

function interpolateOthers(dt) {
  const rt = performance.now() - otherDelay;
  const k = 1 - Math.exp(-dt * 16);   // wygładzanie: zabija resztkowe drgania między pakietami
  for (const id in othersById) {
    const o = othersById[id], b = o.buf;
    if (!b || b.length === 0) continue;
    let tx, ty, ta;
    if (rt <= b[0].t) { tx = b[0].x; ty = b[0].y; ta = b[0].a; }
    else if (rt >= b[b.length - 1].t) {
      const last = b[b.length - 1]; tx = last.x; ty = last.y; ta = last.a;
    } else {
      for (let i = 0; i < b.length - 1; i++) {
        if (rt >= b[i].t && rt <= b[i + 1].t) {
          const span = b[i + 1].t - b[i].t || 1;
          const f = (rt - b[i].t) / span;
          tx = b[i].x + (b[i + 1].x - b[i].x) * f;
          ty = b[i].y + (b[i + 1].y - b[i].y) * f;
          ta = b[i].a + angleDiff(b[i + 1].a, b[i].a) * f;
          break;
        }
      }
    }
    if (tx === undefined) continue;
    // Duży przeskok (np. respawn/lag) — ustaw od razu, inaczej płynnie dojedź.
    if (Math.hypot(tx - o.x, ty - o.y) > 260) { o.x = tx; o.y = ty; o.angle = ta; }
    else {
      o.x += (tx - o.x) * k;
      o.y += (ty - o.y) * k;
      o.angle += angleDiff(ta, o.angle) * k;
    }
  }
}

// ---- Kolizje ----
// Auto jako 4 rogi prostokąta; sprawdzamy każdą krawędź auta względem ścian.
function carCorners(x, y, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const hw = CAR.w / 2, hh = CAR.h / 2;
  const pts = [
    [hw, hh], [hw, -hh], [-hw, -hh], [-hw, hh],
  ];
  return pts.map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]);
}

function carHitsWalls(x, y, angle) {
  if (!track) return false;
  const R = 24;                                     // promień auta (+ zapas) do odsiewu
  const corners = carCorners(x, y, angle);
  for (const w of track.walls) {
    if (!wallActive(w)) continue;                   // ściana z innego piętra — ignoruj
    if (Math.max(w[0], w[2]) < x - R || Math.min(w[0], w[2]) > x + R ||
        Math.max(w[1], w[3]) < y - R || Math.min(w[1], w[3]) > y + R) continue;  // ściana za daleko
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      if (segIntersect(a[0], a[1], b[0], b[1], w[0], w[1], w[2], w[3])) return true;
    }
  }
  return false;
}

// Poziom ściany: 5. element (0 = parter, 1 = most, 2/brak = blokuje zawsze).
function wallLevel(w) { return w.length > 4 ? w[4] : 2; }
function wallActive(w) { const l = wallLevel(w); return l === 2 || l === me.level; }

// Bramki przy rampach: przejazd przez bramkę zmienia piętro auta.
function checkGates(px, py) {
  const G = track && track.gates;
  if (!G || !G.length) return;
  const mx = me.x - px, my = me.y - py;
  const ml = Math.hypot(mx, my);
  if (ml < 1e-6) return;
  for (const g of G) {
    if (!segIntersect(px, py, me.x, me.y, g.x1, g.y1, g.x2, g.y2)) continue;
    const dot = (mx * g.dx + my * g.dy) / ml;     // kierunek jazdy vs kierunek trasy
    // WAŻNE: auto jadące POD wiaduktem przecina linię bramki prawie prostopadle.
    // Bez tego warunku „wjeżdżało" na most i blokowało się na rampach.
    if (Math.abs(dot) < 0.5) continue;            // > 60° od osi trasy = to nie wjazd
    me.level = dot >= 0 ? g.fwd : g.bwd;
  }
}

// Uśredniony wektor normalny ścian, w które wjeżdża auto (albo null gdy nie dotyka).
// Dzięki temu auto ślizga się po ścianie POD KAŻDYM KĄTEM (nie tylko poziomej/pionowej).
function wallNormal(x, y, angle) {
  if (!track) return null;
  const R = 24;
  const corners = carCorners(x, y, angle);
  let nx = 0, ny = 0, hit = false;
  for (const w of track.walls) {
    if (!wallActive(w)) continue;                   // ściana z innego piętra — ignoruj
    if (Math.max(w[0], w[2]) < x - R || Math.min(w[0], w[2]) > x + R ||
        Math.max(w[1], w[3]) < y - R || Math.min(w[1], w[3]) > y + R) continue;  // ściana za daleko
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      if (segIntersect(a[0], a[1], b[0], b[1], w[0], w[1], w[2], w[3])) {
        const wx = w[2] - w[0], wy = w[3] - w[1];
        const L = Math.hypot(wx, wy) || 1;
        let n1 = -wy / L, n2 = wx / L;                       // normalna do odcinka ściany
        const mx = (w[0] + w[2]) / 2, my = (w[1] + w[3]) / 2;
        if ((x - mx) * n1 + (y - my) * n2 < 0) { n1 = -n1; n2 = -n2; }  // skieruj w stronę auta
        nx += n1; ny += n2; hit = true;
        break;                                               // ta ściana już policzona
      }
    }
  }
  if (!hit) return null;
  const L = Math.hypot(nx, ny) || 1;
  return [nx / L, ny / L];
}

// Przecięcie dwóch odcinków
function segIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function inFinish(x, y) {
  if (!track) return false;        // wyjątek w kroku fizyki zatrzymałby całą pętlę gry
  const f = track.finish;
  return x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h;
}

// ---- Rendering ----
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (mode === "drawing") { drawDrawingPad(); return; }
  if (!track) return;
  const W = track.size.w, H = track.size.h;

  // Kamera: w wyścigu za moim autem; przy oglądaniu za kimś / na środku.
  let camTx = me.x, camTy = me.y;
  if (mode !== "racing") {
    const first = Object.values(othersById)[0];
    if (first) { camTx = first.x; camTy = first.y; } else { camTx = W / 2; camTy = H / 2; }
  }
  cam.x = clamp(camTx - VIEW.w / 2, 0, Math.max(0, W - VIEW.w));
  cam.y = clamp(camTy - VIEW.h / 2, 0, Math.max(0, H - VIEW.h));

  ctx.save();
  ctx.translate(-cam.x, -cam.y);

  // ---- Podłoże z subtelną kratką (klimat „zbudowanego" świata) ----
  ctx.fillStyle = "#26332b";
  ctx.fillRect(cam.x, cam.y, VIEW.w, VIEW.h);
  ctx.strokeStyle = "rgba(255,255,255,.035)";
  ctx.lineWidth = 1;
  if (quality >= 1) {
  ctx.beginPath();
  const G = 120;
  for (let gx = Math.floor(cam.x / G) * G; gx < cam.x + VIEW.w; gx += G) {
    ctx.moveTo(gx, cam.y); ctx.lineTo(gx, cam.y + VIEW.h);
  }
  for (let gy = Math.floor(cam.y / G) * G; gy < cam.y + VIEW.h; gy += G) {
    ctx.moveTo(cam.x, gy); ctx.lineTo(cam.x + VIEW.w, gy);
  }
  ctx.stroke();
  }

  // ---- Nawierzchnia drogi (asfalt + linia środkowa) po linii środkowej toru ----
  if (track.path && track.path.length > 1) {
    const P = track.path, wdt = track.width || 200;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "#2c3038"; ctx.lineWidth = wdt; polyline(P);        // asfalt
    ctx.strokeStyle = "#33373f"; ctx.lineWidth = wdt - 12; polyline(P);   // jaśniejszy środek
    ctx.strokeStyle = "rgba(255,214,120,.5)"; ctx.lineWidth = 5;          // przerywana linia środkowa
    ctx.setLineDash([46, 42]); polyline(P); ctx.setLineDash([]);
  }

  // ---- Ślady opon: leżą na asfalcie, więc murki i meta je zasłaniają ----
  drawMarks(0);

  // ---- Meta jako uniesiona płyta ----
  const f = track.finish;
  roundRect(f.x + SH_X, f.y + SH_Y, f.w, f.h, 10); ctx.fillStyle = "rgba(0,0,0,.30)"; ctx.fill();
  // szachownica mety
  ctx.save();
  roundRect(f.x, f.y, f.w, f.h, 10); ctx.clip();
  const cells = 6, csx = f.w / cells, csy = f.h / cells;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      ctx.fillStyle = ((r + c) % 2) ? "#f2f5fb" : "#1b1f27";
      ctx.fillRect(f.x + c * csx, f.y + r * csy, csx + 1, csy + 1);
    }
  }
  ctx.restore();
  ctx.strokeStyle = "#8fb0ff"; ctx.lineWidth = 4; roundRect(f.x, f.y, f.w, f.h, 10); ctx.stroke();
  ctx.fillStyle = "#0d1016"; ctx.font = "bold 22px system-ui"; ctx.textAlign = "center";
  ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.strokeText("META", f.x + f.w / 2, f.y + f.h / 2 + 8);
  ctx.fillText("META", f.x + f.w / 2, f.y + f.h / 2 + 8);

  // ---- Ściany jako murki z wysokością i cieniem (mniej warstw przy niskim FPS) ----
  drawWallLayer(0);                                         // murki parteru

  // ---- Start jako zielona płytka ----
  ctx.fillStyle = "rgba(0,0,0,.28)";
  ctx.beginPath(); ctx.ellipse(track.start.x + 4, track.start.y + 7, 16, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4fbf6f";
  ctx.beginPath(); ctx.arc(track.start.x, track.start.y, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#0d2a16"; ctx.font = "bold 16px system-ui";
  ctx.fillText("START", track.start.x, track.start.y + 32);

  // ---- Zasięg czatu głosowego (okrąg wokół mojego auta) ----
  if (mode === "racing" && settings.voice && settings.showRange && quality >= 1) {
    ctx.beginPath(); ctx.arc(me.x, me.y, settings.voiceRange, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(90,170,255,.045)"; ctx.fill();
    ctx.strokeStyle = "rgba(120,200,255,.28)"; ctx.lineWidth = 3;
    ctx.setLineDash([22, 18]); ctx.stroke(); ctx.setLineDash([]);
  }

  // ---- Dym (pod autami) ----
  drawPuffs();

  // ---- Auta (cudze, potem moje — z cieniem i wysokością) ----
  drawCarsOnLevel(0);      // auta na parterze
  drawBridges();           // most: cień na parterze, filary, jezdnia, barierki
  drawMarks(1);            // smugi na jezdni wiaduktu (dopiero po jej narysowaniu)
  drawCarsOnLevel(1);      // auta na moście — zasłaniają to, co pod spodem

  ctx.restore();

  // Minimapa (statyczne tło z cache + dynamiczne kropki)
  drawMinimap();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function drawMinimap() {
  if (!miniBg) return;
  const mx = canvas.width - miniMW - 12, my = 12, s = miniS;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.drawImage(miniBg, mx, my);                    // statyczne tło (raz zbudowane) — bez rysowania ścian co klatkę
  for (const id in othersById) {
    const o = othersById[id];
    dot(mx + o.x * s, my + o.y * s, o.color);
  }
  if (mode === "racing") dot(mx + me.x * s, my + me.y * s, "#ffffff");
  ctx.strokeStyle = "rgba(255,255,255,.4)";
  ctx.strokeRect(mx + cam.x * s, my + cam.y * s, VIEW.w * s, VIEW.h * s);
  ctx.restore();

  function dot(x, y, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Narysuj łamaną (linię środkową drogi) bieżącym stylem.
function polyline(P) {
  ctx.beginPath();
  ctx.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
  ctx.stroke();
}

// Wsadowe rysowanie ścian — TYLKO widocznych (culling: pomija te poza ekranem).
function strokeWalls(dx, dy, color, w, lvl) {
  const x0 = cam.x - 30, x1 = cam.x + VIEW.w + 30, y0 = cam.y - 30, y1 = cam.y + VIEW.h + 30;
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath();
  for (const s of track.walls) {
    const l = wallLevel(s);
    if (lvl === 0 ? l === 1 : l !== 1) continue;      // parter rysuje 0+2, most tylko 1
    if (Math.max(s[0], s[2]) < x0 || Math.min(s[0], s[2]) > x1 ||
        Math.max(s[1], s[3]) < y0 || Math.min(s[1], s[3]) > y1) continue;   // poza kadrem
    ctx.moveTo(s[0] + dx, s[1] + dy); ctx.lineTo(s[2] + dx, s[3] + dy);
  }
  ctx.stroke();
}

// Murki danego piętra (warstwy zależne od auto-jakości)
function drawWallLayer(lvl) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (quality >= 1) strokeWalls(SH_X, SH_Y, "rgba(0,0,0,.30)", WALL_W + 3, lvl);
  strokeWalls(0, WALL_H, "#333f33", WALL_W, lvl);
  strokeWalls(0, 0, "#8d99a8", WALL_W, lvl);
  if (quality >= 2) strokeWalls(-1, -2, "rgba(255,255,255,.14)", WALL_W - 9, lvl);
}

// Podział trasy na odcinki wg piętra (liczone raz na tor, nie co klatkę)
let runsCache = null;
function buildRoadRuns() {
  runsCache = [];
  if (!track || !track.path || track.path.length < 2) return;
  const P = track.path, L = track.levels || [];
  const segLv = (i) => ((L[i] === 1 && L[i + 1] === 1) ? 1 : 0);
  let a = 0, cur = segLv(0);
  for (let i = 1; i < P.length - 1; i++) {
    const lv = segLv(i);
    if (lv !== cur) { runsCache.push({ lvl: cur, pts: P.slice(a, i + 1) }); a = i; cur = lv; }
  }
  runsCache.push({ lvl: cur, pts: P.slice(a) });
}

function paintRoad(pts, wdt, top) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = top ? "#343943" : "#2c3038"; ctx.lineWidth = wdt; polyline(pts);
  ctx.strokeStyle = top ? "#3c424e" : "#33373f"; ctx.lineWidth = wdt - 12; polyline(pts);
  if (quality >= 1) {
    ctx.strokeStyle = "rgba(255,214,120,.5)"; ctx.lineWidth = 5;
    ctx.setLineDash([46, 42]); polyline(pts); ctx.setLineDash([]);
  }
}

function drawRoadRuns(lvl) {
  if (!runsCache) buildRoadRuns();
  const wdt = track.width || 200;
  for (const r of runsCache) if (r.lvl === lvl) paintRoad(r.pts, wdt, lvl === 1);
}

// Most: cień rzucany na parter + filary + jezdnia + barierki
function drawBridges() {
  if (!runsCache) buildRoadRuns();
  const wdt = track.width || 200;
  const BR_X = 22, BR_Y = 30;                       // „wysokość" mostu (im większe, tym wyżej)
  for (const r of runsCache) {
    if (r.lvl !== 1) continue;
    if (quality >= 1) {
      ctx.save(); ctx.translate(BR_X, BR_Y);        // cień na drodze pod spodem
      ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = wdt + 16;
      ctx.lineCap = "round"; ctx.lineJoin = "round"; polyline(r.pts);
      ctx.restore();
      ctx.fillStyle = "#20242b";                    // filary
      for (let i = 0; i < r.pts.length; i += 2) {
        const p = r.pts[i];
        ctx.beginPath();
        ctx.ellipse(p[0] + BR_X * 0.6, p[1] + BR_Y * 0.6, 13, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = "#171a20"; ctx.lineWidth = wdt + 12;   // krawędź płyty
    ctx.lineCap = "round"; ctx.lineJoin = "round"; polyline(r.pts);
    paintRoad(r.pts, wdt, true);                    // jezdnia mostu
  }
  drawWallLayer(1);                                 // barierki mostu
}

function drawCarsOnLevel(lvl) {
  for (const id in othersById) {
    const o = othersById[id];
    if ((o.level || 0) !== lvl) continue;
    drawCar(o.x, o.y, o.angle, o.color, o.name, false, o.body);
  }
  if (mode === "racing" && me.level === lvl) {
    drawCar(me.x, me.y, me.angle, me.color, me.name, true, me.body);
  }
}

// Rozjaśnij/przyciemnij kolor hex (amt: -1..1).
// Zgodność ze starymi wywołaniami (podglądy rysują po globalnym ctx, przodem w prawo).
function paintBody(bodyType, color, mine, sharp) {
  drawCarAny(ctx, 0, 0, 0, bodyType, color, mine, sharp);
  return bodyOf(bodyType);
}

function drawCar(x, y, angle, color, name, mine, bodyType) {
  const B = bodyOf(bodyType);
  drawCarAny(ctx, x, y, angle, bodyType, color, mine);
  if (name) {
    ctx.fillStyle = "#e8edf6";
    ctx.font = "bold 12px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(name, x, y - B.h - 8);
  }
}

function roundRect(x, y, w, h, r) { roundRectOn(ctx, x, y, w, h, r); }

function showWinner(name, timeS) {
  winnerName = name;
  const iWon = mode === "racing" && me.name === name && finished;
  banner.classList.add("show");
  bannerBig.textContent = iWon ? "🏆 Wygrałeś!" : "🏁 Koniec wyścigu";
  const t = timeS != null ? ` · ${timeS}s` : "";
  bannerSub.textContent = (iWon ? "Pierwszy na mecie!" : `Wygrywa: ${name}`) + t;
  const rb = document.getElementById("rematchBtn");
  if (rb) rb.textContent = "🏁 Wróć do lobby";
  const lb = document.getElementById("leaderboard");   // pokaż tabelę po wyścigu
  if (lb) lb.classList.add("show");
}

// ---- Tabela wyników (ranking z bazy) ----
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderLeaderboard() {
  const nota = document.getElementById("lbNote");
  if (nota) {
    nota.textContent = jestemGosciem
      ? "👤 Grasz jako gość — Twoje wyniki NIE są zapisywane."
      : "💾 Twoje wyniki zapisują się na tym urządzeniu.";
    nota.className = "lb-note " + (jestemGosciem ? "gosc" : "zapis");
  }
  const el = document.getElementById("lbBody");
  if (!el) return;
  if (!lbData.length) {
    el.innerHTML = '<div class="lb-empty">Brak wyników — rozegrajcie pierwszy wyścig!</div>';
    return;
  }
  el.innerHTML = lbData.map((r, i) => `
    <div class="lb-row">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(r.name)}</span>
      <span class="lb-wins">${r.wins}🏆</span>
      <span class="lb-races">${r.races} wyśc.</span>
      <span class="lb-best">${r.best != null ? r.best + "s" : "—"}</span>
    </div>`).join("");
}

let _toastTimer = null;
function showToast(text) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// Przyciski tabeli wyników
{
  const tgl = document.getElementById("lbToggle");
  const cls = document.getElementById("lbClose");
  const lb = document.getElementById("leaderboard");
  if (tgl && lb) tgl.addEventListener("click", () => lb.classList.toggle("show"));
  if (cls && lb) cls.addEventListener("click", () => lb.classList.remove("show"));
}

// ===== Telemetria — panel diagnostyczny (⚙️ Ustawienia albo klawisz F3) =====
function stdev(a) {
  if (a.length < 2) return 0;
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
}

// Auto-jakość: gdy FPS spada, wyłączamy najdroższe efekty (i odwrotnie).
// Poziomy: 2 = pełne, 1 = bez dymu/zasięgu, 0 = minimum (płaskie ściany, mniej warstw).
let quality = 2, qCooldown = 0;
function autoQuality(fps) {
  if (!fps) return;
  if (qCooldown > 0) { qCooldown--; return; }
  if (fps < 28 && quality > 0) { quality--; qCooldown = 6; puffs.length = 0; clearMarks(); }
  else if (fps > 52 && quality < 2) { quality++; qCooldown = 10; }
}

function updateTelemetry(now, dt) {
  tel.frames++;
  tel.worstFrame = Math.max(tel.worstFrame, dt * 1000);
  if (!tel.windowStart) tel.windowStart = now;
  const span = now - tel.windowStart;
  if (span < 500) return;                        // przeliczaj 2x/s, nie co klatkę

  updateInterpDelay();                           // dostrój bufor do bieżącego jittera
  tel.fps = Math.round(tel.frames * 1000 / span);
  autoQuality(Math.round(tel.frames * 1000 / span));
  tel.stateRate = Math.round(tel.states * 1000 / span);
  tel.kbpsIn = Math.round(tel.bytesIn / span);   // bajty/ms = kB/s
  tel.kbpsOut = Math.round(tel.bytesOut / span);
  tel.voiceInRate = Math.round(tel.voiceIn * 1000 / span);
  tel.voiceOutRate = Math.round(tel.voiceOut * 1000 / span);
  tel.frames = 0; tel.states = 0; tel.bytesIn = 0; tel.bytesOut = 0;
  tel.voiceIn = 0; tel.voiceOut = 0; tel.windowStart = now;

  if (ws && ws.readyState === WebSocket.OPEN && now - tel.lastPingSent > 2000) {
    tel.lastPingSent = now;
    ws.send(JSON.stringify({ type: "ping", t: now }));
  }

  const el = document.getElementById("telBody");
  if (!el || !document.getElementById("telemetry").classList.contains("show")) {
    tel.worstFrame = 0;
    return;
  }
  const gapAvg = tel.arrGaps.length ? tel.arrGaps.reduce((s, v) => s + v, 0) / tel.arrGaps.length : 0;
  const gapJit = stdev(tel.arrGaps);
  const rows = [
    `FPS <b>${tel.fps}</b>  ·  najgorsza klatka <b>${tel.worstFrame.toFixed(0)} ms</b>`,
    `ping <b>${tel.ping} ms</b>  ·  pakiety stanu <b>${tel.stateRate}/s</b>`,
    `odstęp pakietów <b>${gapAvg.toFixed(0)} ms</b> ±<b>${gapJit.toFixed(0)}</b> (jitter)`,
    `ruch <b>↓${tel.kbpsIn} kB/s</b> ↑<b>${tel.kbpsOut} kB/s</b>  ·  cząstek <b>${puffs.length}</b>  ·  smug <b>${marks.length}</b>`,
    `bufor <b>${otherDelay.toFixed(0)} ms</b> (auto)  ·  jakość <b>${["min","śr","pełna"][quality]}</b>`,
    `głos: nadaję <b>${tel.voiceOutRate}/s</b> · odbieram <b>${tel.voiceInRate}/s</b> · ` +
    `zasięg <b>${settings.voiceRange}px</b> · ${settings.voice ? "wł." : "wył."}`,
  ];
  // per gracz: jak równo przychodzą jego pozycje (to widać jako przeskoki)
  for (const id in othersById) {
    const o = othersById[id], b = o.buf || [];
    if (b.length < 3) continue;
    const gaps = [], steps = [];
    for (let i = 1; i < b.length; i++) {
      gaps.push(b[i].t - b[i - 1].t);
      steps.push(Math.hypot(b[i].x - b[i - 1].x, b[i].y - b[i - 1].y));
    }
    const g = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    rows.push(`<span class="tel-p">${escapeHtml(o.name || id)}</span>: ` +
              `${Math.round(1000 / g)}/s · odstęp <b>${g.toFixed(0)}±${stdev(gaps).toFixed(0)} ms</b> · ` +
              `krok <b>${(steps.reduce((s, v) => s + v, 0) / steps.length).toFixed(0)}±${stdev(steps).toFixed(0)} px</b>`);
  }
  el.innerHTML = rows.join("<br>");
  tel.worstFrame = 0;
}

// F3 — szybkie przełączenie telemetrii
addEventListener("keydown", (e) => {
  if (e.key === "F3") {
    e.preventDefault();
    const p = document.getElementById("telemetry");
    if (p) { p.classList.toggle("show"); settings.telemetry = p.classList.contains("show"); saveSettings(); }
  }
});

// ===== LOBBY: lista graczy + gotowość =====
let myReady = false;
let lobbyPlayers = [];        // ostatnia znana lista (aktualizowana też w trakcie wyścigu)

function hideLobby() {
  const el = document.getElementById("lobby");
  if (el) el.classList.remove("show");
}

function enterLobby(list) {
  mode = "lobby";
  hideJoin(); hideWait(); hideDrawUI();
  banner.classList.remove("show");
  if (trackLabel) trackLabel.textContent = "🏁 Lobby";
  const lbEl = document.getElementById("leaderboard");
  if (lbEl) lbEl.classList.remove("show");     // nie zostawiaj tabeli pod lobby
  const el = document.getElementById("lobby");
  if (el) el.classList.add("show");
  const me_ = list.find(p => p.id === myId);
  myReady = !!(me_ && me_.ready);
  const btn = document.getElementById("readyBtn");
  if (btn) {
    btn.textContent = myReady ? "⏳ Czekam na resztę (kliknij, by cofnąć)" : "✅ Jestem gotowy";
    btn.classList.toggle("on", myReady);
  }
  const sub = document.getElementById("lobbySub");
  if (sub) {
    const gotowi = list.filter(p => p.ready).length;
    sub.textContent = `Gotowi: ${gotowi}/${list.length} — wyścig ruszy, gdy wszyscy będą gotowi`;
  }
  renderLobbyList(list);
}

function renderLobbyList(list) {
  const box = document.getElementById("lobbyList");
  if (!box) return;
  box.innerHTML = "";
  for (const p of list) {
    const row = document.createElement("div");
    row.className = "lp-row";
    const cv = document.createElement("canvas");
    cv.style.width = "74px"; cv.style.height = "42px";
    const { g: c2, w, h, dpr } = hidpiCtx(cv, 74, 42);
    const prev = ctx;
    ctx = c2;                                   // paintBody rysuje po globalnym ctx
    const z = zoomDoKanwy(p.body || "sport", w, h);
    c2.save(); c2.translate(w / 2, h / 2 + h * 0.12); c2.scale(z, z);
    paintBody(p.body, p.color, p.id === myId, z * dpr);
    c2.restore();
    ctx = prev;
    const nm = document.createElement("span");
    nm.className = "lp-name" + (p.id === myId ? " lp-me" : "");
    nm.textContent = p.name + (p.id === myId ? " (Ty)" : "");
    const rd = document.createElement("span");
    rd.className = "lp-ready " + (p.ready ? "yes" : "no");
    rd.textContent = p.ready ? "✅ Gotowy" : "⏳ Niegotowy";
    row.append(cv, nm, rd);
    box.appendChild(row);
  }
}

{
  const btn = document.getElementById("readyBtn");
  if (btn) btn.addEventListener("click", () => {
    if (mode !== "lobby") return;                 // w trakcie wyścigu gotowość nic nie zmienia
    myReady = !myReady;
    btn.textContent = myReady ? "⏳ Czekam na resztę (kliknij, by cofnąć)" : "✅ Jestem gotowy";
    btn.classList.toggle("on", myReady);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ready", ready: myReady }));
    }
  });
}

// ---- Przełączanie trybów (fazy z serwera) ----
// Jedna klasa stanu na <body> — dzięki temu CSS wie, co wolno pokazać (np. sterowanie
// dotykowe tylko w czasie jazdy, żeby nie zasłaniało lobby).
let lastUiState = "";
function syncUiState() {
  const st = "state-" + mode;
  if (st === lastUiState) return;
  if (lastUiState) document.body.classList.remove(lastUiState);
  document.body.classList.add(st);
  lastUiState = st;
}

function hideJoin() {
  const j = document.getElementById("join");
  if (j) j.style.display = "none";
  document.body.classList.add("playing");     // na telefonie chowa nagłówek (więcej miejsca)
}
function showWait(t) { if (waitOverlay) { waitOverlay.textContent = t; waitOverlay.classList.add("show"); } }
function hideWait() { if (waitOverlay) waitOverlay.classList.remove("show"); }
function showDrawUI() { if (drawUI) drawUI.classList.add("show"); }
function hideDrawUI() { if (drawUI) drawUI.classList.remove("show"); }

function enterWaiting(name) {
  mode = "waiting";
  hideJoin(); hideDrawUI(); hideLobby();
  showWait(`🎨 ${name || "gracz"} rysuje trasę…`);
  if (trackLabel) trackLabel.textContent = "🎨 rysowanie trasy";
}

function enterSpectator(t, winnerObj) {
  mode = "spectating";
  hideJoin(); hideDrawUI();
  if (t) applyTrack(t);
  showWait("👀 Oglądasz — dołączysz w następnej rundzie");
  if (winnerObj) showWinner(winnerObj.name); else banner.classList.remove("show");
}

function enterDrawing(world, seconds) {
  mode = "drawing";
  hideJoin(); hideWait(); hideLobby();
  drawWorld = world || { w: 3000, h: 2000 };
  drawStroke = [];
  drawingActive = false;
  drawDeadline = performance.now() + (seconds || 45) * 1000;
  showDrawUI();
  if (trackLabel) trackLabel.textContent = "✏️ Rysujesz trasę!";
}

function startRace(t) {
  applyTrack(t);
  resetToStart();
  finished = false;
  winnerName = null;
  raceStandings = [];
  const lb = document.getElementById("leaderboard");
  if (lb) lb.classList.remove("show");
  mode = "racing";
  hideJoin(); hideWait(); hideDrawUI(); hideLobby();
  banner.classList.remove("show");
  startCountdown();
}

// ---- Rysowanie trasy (mapa gracza) ----
function drawScale() {
  const s = Math.min(VIEW.w / drawWorld.w, VIEW.h / drawWorld.h);
  return { s, ox: (VIEW.w - drawWorld.w * s) / 2, oy: (VIEW.h - drawWorld.h * s) / 2 };
}

function eventToWorld(e) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * canvas.width / rect.width;
  const cy = (e.clientY - rect.top) * canvas.height / rect.height;
  const { s, ox, oy } = drawScale();
  return [(cx - ox) / s, (cy - oy) / s];
}

// Pointer events = mysz, palec i rysik jednym kodem (działa też na telefonie)
canvas.addEventListener("pointerdown", (e) => {
  if (mode !== "drawing") return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
  drawingActive = true;
  drawStroke = [eventToWorld(e)];
});
const DRAW_MIN_GAP = 70;  // pędzel nie może zbliżyć się do już narysowanej trasy bliżej niż tyle

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
// Czy punkt nachodzi na wcześniejszą część trasy? (pomijamy kilka ostatnich punktów)
function overlapsStroke(p) {
  const last = drawStroke[drawStroke.length - 1];
  for (let i = 0; i < drawStroke.length - 6; i++) {
    if (pointSegDist(p, drawStroke[i], drawStroke[i + 1]) >= DRAW_MIN_GAP) continue;
    // blisko starego odcinka: przepuść, jeśli to PRZECIĘCIE pod wyraźnym kątem
    // (z tego zrobi się most), zablokuj tylko jazdę wzdłuż tej samej linii
    if (last) {
      const ax = p[0] - last[0], ay = p[1] - last[1];
      const bx = drawStroke[i + 1][0] - drawStroke[i][0], by = drawStroke[i + 1][1] - drawStroke[i][1];
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      const cos = Math.abs((ax * bx + ay * by) / (la * lb));
      if (cos < 0.6) continue;                 // kąt > ~53° = przecięcie -> most
    }
    return true;
  }
  return false;
}

canvas.addEventListener("pointermove", (e) => {
  if (mode !== "drawing" || !drawingActive) return;
  const p = eventToWorld(e);
  const last = drawStroke[drawStroke.length - 1];
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) <= 28) return;
  // Przecięcia są DOZWOLONE — program zbuduje w tym miejscu most (patrz track.py).
  // Blokujemy tylko jazdę „po samym sobie" (prawie równoległy nawrót na tej samej
  // linii), bo z tego nie da się zrobić sensownego mostu.
  if (overlapsStroke(p)) return;
  drawStroke.push(p);
});
addEventListener("pointerup", () => { if (mode === "drawing") drawingActive = false; });
addEventListener("pointercancel", () => { if (mode === "drawing") drawingActive = false; });

function submitMap() {
  if (mode !== "drawing") return;
  const pts = drawStroke.slice(0, 400).map(p => [Math.round(p[0]), Math.round(p[1])]);
  ws.send(JSON.stringify({ type: "map", points: pts.length >= 2 ? pts : [] }));
  mode = "waiting";
  hideDrawUI();
  showWait("⏳ Ładowanie trasy…");
}

function updateDrawTimer() {
  if (mode !== "drawing") return;
  const rem = Math.max(0, (drawDeadline - performance.now()) / 1000);
  if (drawTimerEl) drawTimerEl.textContent = Math.ceil(rem) + "s";
  if (rem <= 0) submitMap();
}

function drawDrawingPad() {
  if (!drawWorld) return;
  const { s, ox, oy } = drawScale();
  ctx.fillStyle = "#0f1f17";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  // ramka świata
  ctx.fillStyle = "#12251b";
  ctx.fillRect(0, 0, drawWorld.w, drawWorld.h);
  ctx.strokeStyle = "#39506a";
  ctx.lineWidth = 4 / s;
  ctx.strokeRect(0, 0, drawWorld.w, drawWorld.h);

  if (drawStroke.length) {
    // podgląd szerokości korytarza (półprzezroczyście)
    ctx.strokeStyle = "#ffd24a";
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 170;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokePath();
    ctx.globalAlpha = 1;
    // sama linia
    ctx.strokeStyle = "#ffe27a";
    ctx.lineWidth = 8 / s;
    strokePath();
    // start (zielony) i koniec (niebieski)
    const a = drawStroke[0], b = drawStroke[drawStroke.length - 1];
    ctx.fillStyle = "#59d17a"; ctx.beginPath(); ctx.arc(a[0], a[1], 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#7ea2ff"; ctx.beginPath(); ctx.arc(b[0], b[1], 30, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  function strokePath() {
    ctx.beginPath();
    ctx.moveTo(drawStroke[0][0], drawStroke[0][1]);
    for (const p of drawStroke) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }
}

// Przyciski rysowania
{
  const cb = document.getElementById("drawClear");
  const sb = document.getElementById("drawSubmit");
  if (cb) cb.addEventListener("click", () => { drawStroke = []; });
  if (sb) sb.addEventListener("click", submitMap);
}

// ===== Dźwięk silnika (Web Audio — synteza proceduralna) =====
// Trwały identyfikator gracza, losowany raz i trzymany w przeglądarce.
// Ranking liczy się po NIM, a nie po nicku — nick da się podszyć, klucza nie.
// To nie jest konto: nie przenosi się między urządzeniami. Prawdziwe konta
// (logowanie Google) dojdą, gdy gra dostanie stały adres.
function kluczGracza() {
  let k = null;
  try { k = localStorage.getItem("raceKlucz"); } catch (e) {}
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(k || "")) {
    const b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    k = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    try { localStorage.setItem("raceKlucz", k); } catch (e) {}
  }
  return k;
}

function loadSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem("raceSettings") || "{}")); } catch (e) {}
  // Migracja: gracze mają zapisany stary, bardzo mały zasięg głosu (240 px = ~1/5 ekranu),
  // przez co „czasem słychać, czasem nie". Podnieś go do sensownej wartości.
  if (!settings.voiceRange || settings.voiceRange < 500) {
    settings.voiceRange = 900;
    saveSettings();
  }
  // Migracja: pierwsza wersja nowego silnika grała za głośno i z pulsowaniem.
  // Kto zdążył ją odpalić, ma zapisane 0.7 — ściszamy raz, potem decyduje gracz.
  if (!settings.cichszySilnik) {
    settings.cichszySilnik = true;
    if (settings.engineVol === undefined || settings.engineVol > 0.5) settings.engineVol = 0.45;
    saveSettings();
  }
}
function saveSettings() {
  try { localStorage.setItem("raceSettings", JSON.stringify(settings)); } catch (e) {}
}
loadSettings();
UZYJ_KENNEY = settings.grafikiAut !== false;   // grafiki Kenneya albo rysowanie kodem
// Mikrofon wymaga gestu użytkownika, więc po przeładowaniu czat startuje wyłączony.
// Zapamiętujemy jednak CHĘĆ gracza i wznawiamy przy pierwszym kliknięciu/klawiszu —
// wcześniej po każdym odświeżeniu czat po cichu zostawał wyłączony.
const voiceWanted = !!settings.voice;
settings.voice = false;
if (voiceWanted) {
  const wznow = () => {
    document.removeEventListener("pointerdown", wznow);
    document.removeEventListener("keydown", wznow);
    enableVoice();
    const cb = document.getElementById("setVoice");
    if (cb) cb.checked = true;
  };
  document.addEventListener("pointerdown", wznow, { once: false });
  document.addEventListener("keydown", wznow, { once: false });
}

function ensureAudio() {
  if (audioCtx) { if (audioCtx.state === "suspended") audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = settings.volume;
  masterGain.connect(audioCtx.destination);
  // Osobne magistrale: silnik i efekty mają własne suwaki, master jest nad nimi.
  engineBus = audioCtx.createGain(); engineBus.gain.value = settings.engineVol;
  sfxBus = audioCtx.createGain(); sfxBus.gain.value = settings.sfxVol;
  engineBus.connect(masterGain); sfxBus.connect(masterGain);
  distCurve = makeDistCurve(3.2);   // było 16 — brzmiało jak przester, nie silnik
  myEngine = makeEngine(me.body || "sport");
  squeal = makeSqueal();
}

// Krzywa dystorsji (tanh) — dodaje harmoniczne, growl silnika.
function makeDistCurve(amount) {
  const n = 1024, c = new Float32Array(n);
  const k = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / k;
  }
  return c;
}

// ===== Dźwięk silnika — synteza wielowarstwowa =========================
// Inspiracja Forzą: nie jedna piła, tylko warstwy reagujące na obciążenie,
// obroty i bieg:
//   WYDECH — ton zapłonów (PeriodicWave) + sub wału korbowego (rumble)
//   DOLOT  — szum przez filtr pasmowy, rośnie z gazem
//   TURBO  — świst rosnący z obrotami, na boostcie wyraźnie mocniejszy
// Częstotliwość zapłonów liczymy FIZYCZNIE: f = (obr/min / 60) * cylindry / 2
// (czterosuw pali raz na dwa obroty wału). Dzięki temu V8 muscle'a i
// dwucylindrowy gokart różnią się z konstrukcji, a nie z ręcznie dobranej wysokości.
const ENGINES = {
  //        cyl  bieg. obroty jałowe/maks.  lope=nierówność  turbo  body=ciemność brzmienia
  sport:  { cyl: 6, gears: 6, idle: 950,  max: 7800,  lope: 0.10, turbo: 0.55, body: 1.00 },
  muscle: { cyl: 8, gears: 5, idle: 700,  max: 6200,  lope: 0.34, turbo: 0.20, body: 1.28 },
  van:    { cyl: 4, gears: 5, idle: 780,  max: 4600,  lope: 0.22, turbo: 0.35, body: 1.50 },
  kart:   { cyl: 2, gears: 3, idle: 1700, max: 11000, lope: 0.06, turbo: 0.10, body: 0.62 },
};
function engSpec(bodyType) { return ENGINES[bodyType] || ENGINES.sport; }

// Kształt fali zapłonów. Harmoniczne opadają jak 1/n, ale co (cyl/2)-tą podbijamy
// — to ona niesie charakter: V8 burczy, dwucylindrowiec terkocze.
const waveCache = new Map();
function fireWave(cyl) {
  let w = waveCache.get(cyl);
  if (w) return w;
  const N = 32, real = new Float32Array(N), imag = new Float32Array(N);
  const co = Math.max(1, Math.round(cyl / 2));
  for (let n = 1; n < N; n++) imag[n] = (1 / n) * (n % co === 0 ? 1.9 : 1.0);
  w = audioCtx.createPeriodicWave(real, imag);
  waveCache.set(cyl, w);
  return w;
}

let noiseBuf = null;
function noise() {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(audioCtx.sampleRate * 2);
  noiseBuf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function makeEngine(bodyType) {
  return engineBuffer ? makeSampleEngine(bodyType) : makeSynthEngine(bodyType);
}

// Silnik z PRÓBKI gracza: zapętlone nagranie, którego tempo rośnie z obrotami.
function makeSampleEngine(bodyType) {
  const g = audioCtx.createGain(); g.gain.value = 0;
  const src = audioCtx.createBufferSource();
  src.buffer = engineBuffer; src.loop = true;
  src.connect(g); g.connect(engineBus); src.start();
  return { sample: true, forBody: bodyType, S: engSpec(bodyType), src, g, gear: 0, shiftT: 0 };
}

function makeSynthEngine(bodyType) {
  const S = engSpec(bodyType);
  const out = audioCtx.createGain(); out.gain.value = 0;
  out.connect(engineBus);

  const w = fireWave(S.cyl);                                    // --- WYDECH ---
  const ex1 = audioCtx.createOscillator(); ex1.setPeriodicWave(w);
  const ex2 = audioCtx.createOscillator(); ex2.setPeriodicWave(w); ex2.detune.value = 4;
  const exMix = audioCtx.createGain(); exMix.gain.value = 0.42;
  const shaper = audioCtx.createWaveShaper(); shaper.curve = distCurve; shaper.oversample = "2x";
  const lp = audioCtx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 800; lp.Q.value = 3;
  ex1.connect(exMix); ex2.connect(exMix); exMix.connect(shaper); shaper.connect(lp); lp.connect(out);

  const sub = audioCtx.createOscillator(); sub.type = "sine";   // rumble wału korbowego
  const subG = audioCtx.createGain(); subG.gain.value = 0.5;
  sub.connect(subG); subG.connect(out);

  // Nie ma tu już LFO modulującego głośność wyjścia. Modulacja amplitudy przy
  // częstotliwości wału (12-30 Hz na wolnych obrotach) to dokładnie ten warkot
  // „uj-uj-uj", a przy wysokich obrotach robiła metaliczne dudnienie. Charakter
  // silnika niosą harmoniczne kształtu fali, nie pulsowanie głośności.

  const air = audioCtx.createBufferSource();                    // --- DOLOT ---
  air.buffer = noise(); air.loop = true;
  const airBp = audioCtx.createBiquadFilter(); airBp.type = "bandpass";
  airBp.frequency.value = 900; airBp.Q.value = 1.1;
  const airG = audioCtx.createGain(); airG.gain.value = 0;
  air.connect(airBp); airBp.connect(airG); airG.connect(out);

  const tur = audioCtx.createOscillator(); tur.type = "triangle";  // --- TURBO ---
  tur.frequency.value = 1100;
  const turG = audioCtx.createGain(); turG.gain.value = 0;
  tur.connect(turG); turG.connect(out);

  ex1.start(); ex2.start(); sub.start(); air.start(); tur.start();
  return { synth: true, forBody: bodyType, S, out, ex1, ex2, sub, subG, lp,
           air, airBp, airG, tur, turG, gear: 0, shiftT: -9e9 };
}

function stopEngine(e) {
  try {
    if (e.sample) e.src.stop();
    else { e.ex1.stop(); e.ex2.stop(); e.sub.stop(); e.air.stop(); e.tur.stop(); }
  } catch (x) {}
  try { (e.out || e.g).disconnect(); } catch (x) {}
}

// Skrzynia biegów: obroty rosną w biegu i SPADAJĄ przy przełożeniu — to ta
// „piła" wysokości, po której poznaje się grę wyścigową, a nie wycie syreny.
function gearState(e, speedFrac, load, boost, vol) {
  const S = e.S;
  const teraz = performance.now();
  // Skrzynia patrzy na WYGŁADZONĄ prędkość, nie na chwilowy odczyt. Fizyka
  // potrafi drgnąć o kilka procent w jednej klatce (kolizje, ślizg po ścianie),
  // a bez tego filtru każde drgnięcie próbuje przerzucić bieg.
  e.sf = e.sf === undefined ? speedFrac : e.sf + (speedFrac - e.sf) * 0.12;
  const poz = e.sf * S.gears;                    // pozycja na skali biegów
  let g = e.gear;
  // HISTEREZA. Bez niej prędkość drgająca wokół progu przerzucała bieg co klatkę,
  // a każde przełożenie przymyka gaz — i właśnie to brzmiało jak „uj-uj-uj-uj".
  // Teraz bieg zmienia się dopiero po przekroczeniu progu z marginesem
  // i po odczekaniu, tak jak w prawdziwej skrzyni.
  // Pasmo histerezy musi być SZERSZE niż drgania prędkości: w górę zmieniamy
  // dopiero na szczycie biegu, w dół dopiero wyraźnie poniżej jego dołu.
  // Margines 0,06 był węższy niż typowe drgania (~0,18) i bieg dalej skakał.
  if (teraz - e.shiftT > 420) {
    if (poz > g + 1.04) { g = Math.min(S.gears - 1, g + 1); e.shiftT = teraz; }
    else if (poz < g - 0.30) { g = Math.max(0, g - 1); e.shiftT = teraz; }
  }
  e.gear = g;
  const w = Math.min(1, Math.max(0, poz - g));
  return { rev: 0.12 + w * 0.88, load, boost, vol,
           shift: teraz - e.shiftT < 80, gear: g };
}

function driveEngine(e, st) {
  if (!e || !audioCtx) return;
  const now = audioCtx.currentTime, tc = 0.045;
  if (e.sample) {
    e.src.playbackRate.setTargetAtTime((0.55 + st.rev * 1.5) * settings.pitch, now, tc);
    e.g.gain.setTargetAtTime(st.vol * 1.6 * (st.shift ? 0.3 : 1), now, tc);
    return;
  }
  const S = e.S;
  const rpm = S.idle + (S.max - S.idle) * st.rev;
  const fFire = (rpm / 60) * (S.cyl / 2) * settings.pitch;   // zapłony na sekundę
  const fCrank = (rpm / 60) * settings.pitch;                // obroty wału
  e.ex1.frequency.setTargetAtTime(fFire, now, tc);
  e.ex2.frequency.setTargetAtTime(fFire, now, tc);   // bez bicia — samo rozstrojenie wystarczy
  e.sub.frequency.setTargetAtTime(Math.max(20, fCrank), now, tc);
  // Filtr zależy od OBCIĄŻENIA, nie tylko obrotów: na gazie jasno i agresywnie,
  // na wybiegu głucho — to ta różnica sprawia, że auto „oddycha".
  e.lp.frequency.setTargetAtTime((420 + st.rev * 2700 * (0.45 + st.load * 0.55)) / S.body, now, tc);
  e.lp.Q.setTargetAtTime(0.7 + st.rev * 1.2, now, tc);   // było do Q=11 — piszczało
  // Sub poniżej 40 Hz to już nie dźwięk, tylko łomot w membranie — wyciszamy go.
  e.subG.gain.setTargetAtTime(fCrank < 40 ? 0.10 : 0.40, now, tc);
  e.airBp.frequency.setTargetAtTime(700 + st.rev * 2600, now, tc);
  e.airG.gain.setTargetAtTime(st.vol * st.load * 0.32, now, tc);
  e.tur.frequency.setTargetAtTime(850 + st.rev * 1900, now, tc);   // było do 5,7 kHz — przeszywało
  e.turG.gain.setTargetAtTime(st.vol * S.turbo * st.load * (st.boost ? 0.5 : 0.10) * (0.2 + st.rev), now, tc);
  e.out.gain.setTargetAtTime(st.vol * (st.shift ? 0.25 : 1), now, st.shift ? 0.012 : tc);
}

// ===== Efekty: uderzenia, zderzenia, pisk opon =========================
function noiseBurst(dur, type, freq, q, amp) {
  const src = audioCtx.createBufferSource(); src.buffer = noise();
  const f = audioCtx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = audioCtx.createGain();
  const now = audioCtx.currentTime;
  g.gain.setValueAtTime(Math.max(0.0002, amp), now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(f); f.connect(g); g.connect(sfxBus);
  src.start(now); src.stop(now + dur + 0.02);
}
function blip(type, f0, f1, dur, amp) {
  const o = audioCtx.createOscillator(); o.type = type;
  const g = audioCtx.createGain();
  const now = audioCtx.currentTime;
  o.frequency.setValueAtTime(f0, now);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
  g.gain.setValueAtTime(Math.max(0.0002, amp), now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g); g.connect(sfxBus);
  o.start(now); o.stop(now + dur + 0.02);
}

let lastWallT = -9, lastCrashT = -9;
// siła 0..1 — im mocniej wjedziesz, tym niżej i dłużej. Dławik czasowy jest
// konieczny: przy ocieraniu o murek zdarzenie leci co klatkę i bez niego trzeszczy.
function sfxWall(force) {
  if (!audioCtx || !settings.sfx) return;
  const now = audioCtx.currentTime;
  if (now - lastWallT < 0.09 || force < 0.06) return;
  lastWallT = now;
  const f = Math.min(1, force);
  noiseBurst(0.10 + f * 0.20, "lowpass", 380 + f * 1100, 1, 0.30 * f);
  blip("sine", 95 + f * 70, 42, 0.16 + f * 0.20, 0.34 * f);
}
function sfxCrash(force) {
  if (!audioCtx || !settings.sfx) return;
  const now = audioCtx.currentTime;
  if (now - lastCrashT < 0.12 || force < 0.08) return;
  lastCrashT = now;
  const f = Math.min(1, force);
  blip("square", 340, 170, 0.11, 0.13 * f);         // blacha
  blip("triangle", 820, 430, 0.15, 0.11 * f);
  noiseBurst(0.13, "bandpass", 2300, 3, 0.20 * f);
}

// Pisk opon: pętla szumu przez wąskie pasmo, głośność sterowana poślizgiem
// (tym samym, który rysuje smugi — dźwięk i obraz nie mogą się rozjeżdżać).
let squeal = null;
function makeSqueal() {
  const src = audioCtx.createBufferSource(); src.buffer = noise(); src.loop = true;
  const bp = audioCtx.createBiquadFilter(); bp.type = "bandpass";
  bp.frequency.value = 2600; bp.Q.value = 9;
  const g = audioCtx.createGain(); g.gain.value = 0;
  src.connect(bp); bp.connect(g); g.connect(sfxBus);
  src.start();
  return { src, bp, g };
}
// Odsłuch: rozpędzanie wybranej klasy przez wszystkie biegi. Słychać wtedy
// i barwę (cylindry), i „piłę" wysokości przy zmianach przełożenia.
let testEng = null, testTimer = null;
function testRev(bodyType) {
  ensureAudio(); if (!audioCtx) return;
  clearInterval(testTimer);
  if (testEng) { stopEngine(testEng); testEng = null; }
  testEng = makeSynthEngine(bodyType);
  const t0 = performance.now();
  testTimer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    if (t > 4.4 || !testEng) {
      clearInterval(testTimer);
      if (testEng) { stopEngine(testEng); testEng = null; }
      return;
    }
    const sf = Math.min(1, t / 3.8);                 // rozpędzanie od zera do maksa
    driveEngine(testEng, gearState(testEng, sf, 1, t > 3.0, 0.55));
  }, 33);
}

// Odsłuch pisku: krótkie „szarpnięcie" poślizgu bez wchodzenia do wyścigu.
let testSquealTimer = null;
function testSqueal() {
  ensureAudio(); if (!squeal || !audioCtx) return;
  clearInterval(testSquealTimer);
  const t0 = performance.now();
  testSquealTimer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    if (t > 1.6) {
      clearInterval(testSquealTimer);
      squeal.g.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
      return;
    }
    const moc = Math.sin(Math.min(1, t / 1.4) * Math.PI);
    squeal.g.gain.setTargetAtTime(moc * 0.20, audioCtx.currentTime, 0.05);
    squeal.bp.frequency.setTargetAtTime(2100 + moc * 1500 + 300, audioCtx.currentTime, 0.08);
  }, 40);
}

function driveSqueal(slip, spd) {
  if (!squeal || !audioCtx) return;
  const now = audioCtx.currentTime;
  const on = settings.sfx && mode === "racing" && spd > 90 && slip > DRIFT_MIN;
  const moc = on ? Math.min(1, (slip - DRIFT_MIN) / 0.45) : 0;
  squeal.g.gain.setTargetAtTime(moc * 0.20, now, on ? 0.05 : 0.12);
  squeal.bp.frequency.setTargetAtTime(2100 + moc * 1500 + spd * 1.2, now, 0.08);
}

function updateEngines() {
  if (!audioCtx) return;
  const gram = settings.sound && mode === "racing";
  // Mój silnik — musi pasować do wybranej karoserii (V8 muscle'a ≠ dwucylindrowy kart).
  if (myEngine && myEngine.forBody !== (me.body || "sport")) {
    stopEngine(myEngine); myEngine = makeEngine(me.body || "sport");
  }
  if (myEngine) {
    if (gram) {
      const B = bodyOf(me.body);
      const spd = Math.hypot(me.vx, me.vy);
      const sf = Math.min(1, spd / (MAX_SPEED * B.spd));
      // obciążenie: pełny gaz / wybieg / hamowanie — od tego zależy barwa
      const load = boosting ? 1 : (K.gas() ? 0.85 : (K.brake() ? 0.05 : 0.20));
      driveEngine(myEngine, gearState(myEngine, sf, load, boosting, 0.10 + sf * 0.50));
    } else {
      driveEngine(myEngine, { rev: 0, load: 0, boost: false, vol: 0, shift: false });
    }
  }
  driveSqueal(gram ? mySlip : 0, Math.hypot(me.vx, me.vy));

  // Silniki innych graczy — z atenuacją odległością.
  const wantOthers = settings.sound && settings.hearOthers && mode === "racing";
  for (const id in otherEngines) {
    if (!wantOthers || !(id in othersById)) {
      stopEngine(otherEngines[id]); delete otherEngines[id];
    }
  }
  if (wantOthers) {
    for (const id in othersById) {
      const o = othersById[id];
      const bt = o.body || "sport";
      if (otherEngines[id] && otherEngines[id].forBody !== bt) {
        stopEngine(otherEngines[id]); delete otherEngines[id];
      }
      if (!otherEngines[id]) otherEngines[id] = makeEngine(bt);
      const sf = Math.min(1, (o.speed || 0) / (MAX_SPEED * bodyOf(bt).spd));
      const dist = Math.hypot(o.x - me.x, o.y - me.y);
      const att = Math.max(0, 1 - dist / 900);
      driveEngine(otherEngines[id], gearState(otherEngines[id], sf, 0.7, false,
                  (0.05 + sf * 0.40) * att));
    }
  }
}

// Przebuduj silniki (po zmianie próbki synth<->sample).
function rebuildEngines() {
  if (!audioCtx) return;
  if (myEngine) { stopEngine(myEngine); myEngine = makeEngine(me.body || "sport"); }
  for (const id in otherEngines) { stopEngine(otherEngines[id]); delete otherEngines[id]; }
}
function engineStatus(t) { const el = document.getElementById("engStatus"); if (el) el.textContent = t; }

async function loadEngineFile(file) {
  ensureAudio(); if (!audioCtx) return;
  engineStatus("⏳ Wczytuję…");
  try {
    engineBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer());
    rebuildEngines();
    settings.sound = true; saveSettings();
    engineStatus("✅ Silnik: " + file.name);
  } catch (e) { engineStatus("❌ Nie udało się wczytać pliku audio"); }
}
async function loadEngineURL(url) {
  if (!url) return;
  if (/youtu\.?be/i.test(url)) {
    engineStatus("❌ YouTube się nie da (to strona wideo, nie plik audio). Wklej link do pliku .mp3/.wav.");
    return;
  }
  ensureAudio(); if (!audioCtx) return;
  engineStatus("⏳ Pobieram…");
  try {
    // Przez nasze proxy (serwer pobiera plik → brak CORS, bez pobierania na dysk).
    const r = await fetch("/proxy_audio?url=" + encodeURIComponent(url));
    if (!r.ok) {
      let msg = "nie udało się pobrać";
      try { msg = (await r.json()).error || msg; } catch (e) {}
      engineStatus("❌ " + msg);
      return;
    }
    engineBuffer = await audioCtx.decodeAudioData(await r.arrayBuffer());
    rebuildEngines();
    settings.sound = true; saveSettings();
    engineStatus("✅ Silnik z linku wczytany");
  } catch (e) { engineStatus("❌ Zły format (to nie audio?) — spróbuj innego pliku"); }
}
function useSynthEngine() {
  engineBuffer = null; rebuildEngines(); engineStatus("🎛️ Syntezator (domyślny)");
}

// ===== Okno Ustawień =====
{
  const panel = document.getElementById("settings");
  const $ = (id) => document.getElementById(id);
  function syncUI() {
    if ($("setSound")) $("setSound").checked = settings.sound;
    if ($("setHear")) $("setHear").checked = settings.hearOthers;
    if ($("setVol")) $("setVol").value = settings.volume;
    if ($("setSfx")) $("setSfx").checked = settings.sfx;
    if ($("setArt")) $("setArt").checked = settings.grafikiAut !== false;
    if ($("setEngVol")) $("setEngVol").value = settings.engineVol;
    if ($("setSfxVol")) $("setSfxVol").value = settings.sfxVol;
    if ($("setPitch")) $("setPitch").value = settings.pitch;
    if ($("setVoice")) $("setVoice").checked = settings.voice;
    if ($("setRange")) $("setRange").checked = settings.showRange;
    if ($("setVoiceRange")) $("setVoiceRange").value = settings.voiceRange;
    if ($("setTel")) $("setTel").checked = !!settings.telemetry;
  }
  syncUI();
  if ($("setToggle")) $("setToggle").addEventListener("click", () => {
    ensureAudio(); syncUI(); panel.classList.add("show");
  });
  if ($("setClose")) $("setClose").addEventListener("click", () => panel.classList.remove("show"));
  if ($("setSound")) $("setSound").addEventListener("change", (e) => {
    settings.sound = e.target.checked; saveSettings(); if (settings.sound) ensureAudio();
  });
  if ($("setHear")) $("setHear").addEventListener("change", (e) => {
    settings.hearOthers = e.target.checked; saveSettings(); if (settings.hearOthers) ensureAudio();
  });
  if ($("setVol")) $("setVol").addEventListener("input", (e) => {
    settings.volume = parseFloat(e.target.value); saveSettings();
    if (masterGain) masterGain.gain.value = settings.volume;
  });
  if ($("setArt")) $("setArt").addEventListener("change", (e) => {
    settings.grafikiAut = e.target.checked; saveSettings();
    UZYJ_KENNEY = settings.grafikiAut;
    if (typeof paintAllPreviews === "function") paintAllPreviews();
  });
  if ($("setSfx")) $("setSfx").addEventListener("change", (e) => {
    settings.sfx = e.target.checked; saveSettings(); if (settings.sfx) ensureAudio();
  });
  if ($("setEngVol")) $("setEngVol").addEventListener("input", (e) => {
    settings.engineVol = parseFloat(e.target.value); saveSettings();
    if (engineBus) engineBus.gain.value = settings.engineVol;
  });
  if ($("setSfxVol")) $("setSfxVol").addEventListener("input", (e) => {
    settings.sfxVol = parseFloat(e.target.value); saveSettings();
    if (sfxBus) sfxBus.gain.value = settings.sfxVol;
  });
  // Odsłuch: rozpędzanie danej klasy przez wszystkie biegi + pojedyncze efekty.
  for (const b of document.querySelectorAll("[data-rev]")) {
    b.addEventListener("click", () => testRev(b.dataset.rev));
  }
  for (const b of document.querySelectorAll("[data-sfx]")) {
    b.addEventListener("click", () => {
      ensureAudio(); if (!audioCtx) return;
      const k = b.dataset.sfx;
      if (k === "wall") { lastWallT = -9; sfxWall(0.35); }
      else if (k === "wallHard") { lastWallT = -9; sfxWall(1.0); }
      else if (k === "crash") { lastCrashT = -9; sfxCrash(0.9); }
      else if (k === "squeal") testSqueal();
    });
  }
  if ($("setPitch")) $("setPitch").addEventListener("input", (e) => {
    settings.pitch = parseFloat(e.target.value); saveSettings();
  });
  // Własny dźwięk silnika (plik / link)
  if ($("engFile")) $("engFile").addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) loadEngineFile(e.target.files[0]);
  });
  if ($("engUrlBtn")) $("engUrlBtn").addEventListener("click", () => loadEngineURL($("engUrl").value.trim()));
  if ($("engSynth")) $("engSynth").addEventListener("click", useSynthEngine);
  // Czat głosowy (proximity)
  if ($("setVoice")) $("setVoice").addEventListener("change", (e) => {
    if (e.target.checked) enableVoice(); else disableVoice();
  });
  if ($("setRange")) $("setRange").addEventListener("change", (e) => {
    settings.showRange = e.target.checked; saveSettings();
  });
  if ($("setVoiceRange")) $("setVoiceRange").addEventListener("input", (e) => {
    settings.voiceRange = parseInt(e.target.value, 10); saveSettings();
  });
  if ($("setTel")) $("setTel").addEventListener("change", (e) => {
    settings.telemetry = e.target.checked; saveSettings();
    document.getElementById("telemetry").classList.toggle("show", settings.telemetry);
  });
  // przywróć stan panelu po wczytaniu ustawień
  if (settings.telemetry) document.getElementById("telemetry").classList.add("show");
}

// ===== Proximity voice chat (przekaz binarny przez serwer — omija NAT/TURN) =====
const VOICE_RATE = 16000;         // 16 kHz — wyraźniejszy głos (mniej „mikrofalówki")
let localStream = null, micProc = null, micSink = null;
let vadHang = 0;                  // „ogon" — dosyłaj chwilę po puszczeniu V (nie ucinaj końcówek)
const voicePeers = {};            // id -> {gain, nextTime}

function voiceStatus(t) { const el = document.getElementById("voiceStatus"); if (el) el.textContent = t; }

async function enableVoice() {
  ensureAudio();
  try {
    localStream = await navigator.mediaDevices.getUserMedia(
      { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch (e) {
    settings.voice = false;
    const cb = document.getElementById("setVoice"); if (cb) cb.checked = false;
    voiceStatus("❌ Brak dostępu do mikrofonu");
    return;
  }
  settings.voice = true; saveSettings();
  const srcNode = audioCtx.createMediaStreamSource(localStream);
  micProc = audioCtx.createScriptProcessor(4096, 1, 1);
  micSink = audioCtx.createGain(); micSink.gain.value = 0;      // żeby nie słyszeć siebie
  srcNode.connect(micProc); micProc.connect(micSink); micSink.connect(audioCtx.destination);
  const ratio = audioCtx.sampleRate / VOICE_RATE;
  micProc.onaudioprocess = (e) => {
    if (!settings.voice || !ws || ws.readyState !== WebSocket.OPEN) return;
    // PUSH-TO-TALK: nadajesz tylko gdy trzymasz V (+ krótki ogon, by nie ciąć końcówek).
    if (keys.v) vadHang = 6;
    else if (vadHang > 0) vadHang--;
    else return;
    const inp = e.inputBuffer.getChannelData(0);
    const outLen = Math.floor(inp.length / ratio);
    const int16 = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {                          // uśrednianie → mniej aliasingu (mniej „robota")
      const a = Math.floor(i * ratio), b = Math.floor((i + 1) * ratio);
      let s = 0, c = 0;
      for (let j = a; j < b && j < inp.length; j++) { s += inp[j]; c++; }
      int16[i] = Math.max(-1, Math.min(1, c ? s / c : 0)) * 32767;
    }
    tel.bytesOut += int16.buffer.byteLength; tel.voiceOut++;
    ws.send(int16.buffer);                                      // binarnie (bez base64/JSON)
  };
  voiceStatus("🎙️ Włączony — trzymaj V, żeby mówić");
}

function disableVoice() {
  settings.voice = false; saveSettings();   // zapamiętane: gracz NIE chce czatu
  if (micProc) { try { micProc.disconnect(); micProc.onaudioprocess = null; } catch (e) {} micProc = null; }
  if (micSink) { try { micSink.disconnect(); } catch (e) {} micSink = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  for (const id in voicePeers) { try { voicePeers[id].gain.disconnect(); } catch (e) {} delete voicePeers[id]; }
  voiceStatus("🎙️ Wyłączony");
}

// Odebrana ramka binarna: [2 bajty id nadawcy][PCM Int16 8 kHz].
function onVoiceBinary(buf) {
  if (!settings.voice || !audioCtx || buf.byteLength <= 2) return;
  const id = new DataView(buf).getUint16(0, true);
  const int16 = new Int16Array(buf, 2);
  let vp = voicePeers[id];
  if (!vp) {
    const g = audioCtx.createGain(); g.gain.value = 0.6; g.connect(audioCtx.destination);
    vp = voicePeers[id] = { gain: g, nextTime: 0 };
  }
  const buffer = audioCtx.createBuffer(1, int16.length, VOICE_RATE);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768;
  const s = audioCtx.createBufferSource(); s.buffer = buffer; s.connect(vp.gain);
  let t = Math.max(audioCtx.currentTime + 0.06, vp.nextTime);
  if (t - audioCtx.currentTime > 0.35) t = audioCtx.currentTime + 0.06;  // za duży bufor → skróć (mniej opóźnienia)
  s.start(t); vp.nextTime = t + buffer.duration;
}

function updateVoiceVolumes() {
  for (const id in voicePeers) {
    const o = othersById[id];
    let vol = 0.6;                                   // poza wyścigiem — normalna głośność (lobby)
    if (mode === "racing") {
      vol = o ? Math.max(0, Math.min(1, 1 - Math.hypot(o.x - me.x, o.y - me.y) / settings.voiceRange)) : 0;
    }
    voicePeers[id].gain.gain.value = vol;
  }
}
