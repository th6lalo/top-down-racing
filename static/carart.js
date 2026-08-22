// ====================================================================
// carart.js — WYGLĄD AUT. Wspólny plik dla gry i dla strony regulacji
// (tuner.html), żeby to, co dobierzesz suwakami, było dokładnie tym,
// co widać w grze. Nie ma tu żadnej zależności od stanu rozgrywki.
// ====================================================================

// Kierunek światła: z góry-lewej, cień pada w prawo-dół. Te same wartości
// rządzą cieniami murków, więc całą mapę oświetla jedno „słońce".
const SH_X = 6, SH_Y = 10;

// Poziom szczegółów 0-2. Gra podmienia go przy spadku FPS, tuner ustawia sam.
let CAR_QUALITY = 2;

// WSZYSTKIE liczby rządzące wyglądem w jednym miejscu — tym kręcą suwaki
// w tuner.html. Po zmianie trzeba podbić ART.v, żeby unieważnić cache sprite'ów.
const ART = {
  v: 1,
  wysNadwozia:   2.4,   // wysokość ścianek nadwozia (px × height klasy)
  wysKabiny:     1.7,   // ile dokłada kabina
  bokCiemnosc:  0.50,   // jak ciemne są ścianki boczne (0-1)
  obrys:        0.78,   // siła ciemnego obrysu wokół auta (0-1)
  obrysGrubosc: 1.6,    // grubość obrysu w px
  dachJasnosc:  0.18,   // o ile dach jaśniejszy od nadwozia
  szybaKrycie:  0.92,   // krycie szyb (0-1) — im wyżej, tym mocniejszy kontrast
  kolaWystaja:  3.4,    // o ile px koła wystają poza obrys
  kolaCiemnosc: 0.92,   // czerń kół
  rabek:        0.13,   // siła rąbka światła od góry-lewej
  cien:         0.30,   // krycie cienia na ziemi
};

function shade(hex, amt) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (h.length !== 6) return hex;
  let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const f = amt < 0 ? 1 + amt : 1, add = amt > 0 ? amt * 255 : 0;
  r = Math.round(Math.min(255, r * f + add));
  g = Math.round(Math.min(255, g * f + add));
  b = Math.round(Math.min(255, b * f + add));
  return `rgb(${r},${g},${b})`;
}

// Typy karoserii — wymiary i detale (kolizje pozostają wspólne: CAR).
// mass — bezwładność w zderzeniach; spd/acc — osiągi; grip — przyczepność (niżej = więcej driftu)
// Każda klasa ma WYRAŹNĄ niszę — patrz tabela czasów w raporcie balansu.
//   spd/acc   — prędkość maks. i przyspieszenie (mnożniki)
//   turn/grip — siła skrętu i przyczepność boczna (niżej = więcej driftu)
//   mass      — bezwładność w zderzeniach (kto kogo odrzuca)
//   bMax/bRe/bPow — pojemność boostu (s), ładowanie (s/s), moc (mnożnik)
//   height    — wysokość bryły (render 2.5D + długość cienia)
const BODIES = {
  // uniwersalny: dobry wszędzie, w niczym najlepszy
  sport:  { w: 34, h: 18, r: 5, wheel: [9, 5],  glass: 6,  stripe: false, roof: false,
            mass: 1.00, spd: 1.0, acc: 1.02, grip: 0.98, turn: 1.02, radius: 16,
            bMax: 1.8, bRe: 0.52, bPow: 1.80, height: 1.00,
            noseW: 0.66, tailW: 0.86, cab: [-0.56, 0.20], cabW: 0.84, cabH: 1.00 },
  // najszybszy na prostych, ale ślizgowy i ciężki — król długich odcinków
  muscle: { w: 38, h: 21, r: 3, wheel: [10, 6], glass: 7,  stripe: true,  roof: false,
            mass: 1.55, spd: 1.13, acc: 0.9, grip: 0.76, turn: 0.82, radius: 18,
            bMax: 2.2, bRe: 0.38, bPow: 2.05, height: 1.05,
            noseW: 0.86, tailW: 0.93, cab: [-0.62, 0.06], cabW: 0.86, cabH: 0.92 },
  // taran: wolny i topornie skręca, ale rozpycha wszystkich i ma wielki zapas boostu
  van:    { w: 42, h: 20, r: 4, wheel: [9, 5],  glass: 5,  stripe: false, roof: true,
            mass: 2.30, spd: 1.0, acc: 0.86, grip: 1.06, turn: 0.82, radius: 20,
            bMax: 2.8, bRe: 0.34, bPow: 1.75, height: 1.35,
            noseW: 0.90, tailW: 0.96, cab: [-0.80, 0.50], cabW: 0.93, cabH: 1.45 },
  // zwrotny sprinter: najlepszy w ciasnych labiryntach, bezradny w kontakcie
  kart:   { w: 26, h: 15, r: 3, wheel: [11, 6], glass: 4,  stripe: false, roof: false,
            mass: 0.50, spd: 0.88, acc: 1.38, grip: 1.52, turn: 1.48, radius: 13,
            bMax: 1.2, bRe: 0.62, bPow: 1.70, height: 0.85,
            noseW: 0.50, tailW: 0.78, cab: [-0.38, 0.18], cabW: 0.66, cabH: 0.42 },
};
function bodyOf(t) { return BODIES[t] || BODIES.sport; }

// Przygotuj kanwę miniaturki: rozmiar na ekranie zostaje z CSS, a bufor rośnie
// do gęstości ekranu — bez tego na Retinie bitmapa 1:1 jest rozciągana i mydli.
// Największe powiększenie, przy którym auto danej klasy MIEŚCI SIĘ w kanwie.
// Stała wartość nie działa: van jest o 60% dłuższy od karta, a kanwa zmienia
// rozmiar razem z układem strony (na telefonie jest węższa).
function zoomDoKanwy(bodyType, w, h) {
  const B = bodyOf(bodyType);
  // Grafiki Kenneya to płaski rzut z góry, więc nie trzeba rezerwować miejsca
  // na wyciągniętą bryłę — auto może być w miniaturce odpowiednio większe.
  const plaskie = UZYJ_KENNEY && KENNEY_GOTOWE;
  const wysBryly = plaskie ? B.h + 5 : B.h + 11 * B.height;
  return Math.max(0.7, Math.min(2.6, Math.min((w - 7) / (B.w + 7), (h - 6) / wysBryly)));
}

function hidpiCtx(cv, zapasW, zapasH) {
  const r = cv.getBoundingClientRect();
  const cw = Math.round(r.width) || zapasW, ch = Math.round(r.height) || zapasH;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  return { g, w: cw, h: ch, dpr };
}

// ---- Bryły 2.5D ----------------------------------------------------------
// Auto NIE jest płaskim prostokątem. Rysujemy je jako wyciągniętą bryłę:
//   koła na ziemi → ścianki nadwozia → ścianki kabiny → dach z szybami.
// Ścianki są zawsze ciemne, bo światło pada z góry-lewej — dokładnie tak samo
// jak w murkach (SH_X/SH_Y), więc widoczne od dołu ekranu boki są odwrócone
// od światła i wszystko na mapie ma spójne oświetlenie.
// Kierunek „w górę ekranu" liczymy w układzie auta, dzięki czemu bryła stoi
// pionowo niezależnie od tego, w którą stronę auto jedzie.
// Każdy element to gotowy sprite (jeden komplet na klasę+kolor), więc w klatce
// zostaje samo drawImage zamiast kilkunastu ścieżek na auto.

const CAR_SPR = new Map();
const CAR_SPR_MAX = 64;

// sharp = ile pikseli ekranu przypada na piksel auta. Miniaturki są powiększane
// i oglądane na ekranach Retiny, więc muszą powstać w wyższej rozdzielczości —
// inaczej rozciągamy bitmapę 1:1 i wychodzi rozmazana plama.
function carSprites(bodyType, color, mine, sharp) {
  const sc = Math.max(1, Math.min(4, Math.round((sharp || 1) * 2) / 2));
  const key = bodyType + "|" + color + "|" + (mine ? 1 : 0) + "|" + sc + "|" + ART.v;
  let s = CAR_SPR.get(key);
  if (!s) {
    s = buildCarSprites(bodyType, color, !!mine, sc);
    if (CAR_SPR.size >= CAR_SPR_MAX) CAR_SPR.delete(CAR_SPR.keys().next().value);
    CAR_SPR.set(key, s);
  }
  return s;
}

function roundRectOn(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Zaokrąglony wielokąt — każdy wierzchołek dostaje łuk o promieniu r.
function roundPolyOn(g, pts, r) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const s0 = mid(pts[n - 1], pts[0]);
  g.beginPath();
  g.moveTo(s0[0], s0[1]);
  for (let i = 0; i < n; i++) {
    const c = pts[i], m = mid(c, pts[(i + 1) % n]);
    g.arcTo(c[0], c[1], m[0], m[1], r);
    g.lineTo(m[0], m[1]);
  }
  g.closePath();
}

// Obrys nadwozia. Kluczowe dla „samochodowości": boki w środkowej części są
// RÓWNOLEGŁE, a zderzaki tępe. Poprzednia wersja liczyła obrys wzorem owalu
// i wychodził z tego kadłub łodzi.
function bodyPath(g, B, inset) {
  const hw = B.w / 2 - inset, hh = B.h / 2 - inset;
  const nw = hh * B.noseW, tw = hh * B.tailW;
  roundPolyOn(g, [
    [-hw,        -tw * 0.70],      // tylny zderzak
    [-hw * 0.90, -tw],
    [-hw * 0.40, -hh],             // tylne barki
    [ hw * 0.34, -hh],             // ——— bok równoległy ———
    [ hw * 0.82, -nw],             // przednie barki
    [ hw,        -nw * 0.64],      // przedni zderzak
    [ hw,         nw * 0.64],
    [ hw * 0.82,  nw],
    [ hw * 0.34,  hh],
    [-hw * 0.40,  hh],
    [-hw * 0.90,  tw],
    [-hw,         tw * 0.70],
  ], Math.min(hh * 0.40, 4.2));
}

function cabPath(g, B, inset) {
  const hw = B.w / 2, hh = B.h / 2;
  const x0 = hw * B.cab[0], x1 = hw * B.cab[1], cw = hh * B.cabW - inset;
  roundRectOn(g, x0 + inset, -cw, (x1 - x0) - inset * 2, cw * 2, Math.min(4.5, cw * 0.55));
}

function buildCarSprites(bodyType, color, mine, sc) {
  sc = sc || 1;
  const B = bodyOf(bodyType);
  const W = Math.ceil(B.w + 26), H = Math.ceil(B.h + 26);   // rozmiar LOGICZNY (jednostki świata)
  const hw = B.w / 2, hh = B.h / 2;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = Math.ceil(W * sc); c.height = Math.ceil(H * sc);
    const g = c.getContext("2d");
    g.setTransform(sc, 0, 0, sc, (W * sc) / 2, (H * sc) / 2);
    return [c, g];
  };
  const sideC = shade(color, -ART.bokCiemnosc);   // ścianki — zawsze odwrócone od światła
  const h1 = Math.max(1, Math.round(ART.wysNadwozia * B.height));
  const h2 = h1 + Math.max(1, Math.round(ART.wysKabiny * B.height * B.cabH));

  // --- cień rzucany na ziemię (pełny obrys auta) ---
  const [shad, gs] = mk();
  gs.fillStyle = "#000";
  bodyPath(gs, B, 0); gs.fill();
  if (B.cabH > 0.6) { cabPath(gs, B, 0); gs.fill(); }

  // --- koła: stoją na ziemi, pod bryłą ---
  const [wheels, gw] = mk();
  const [ww, wh] = B.wheel;
  // Koła stoją przy samych barkach i WYSTAJĄ poza obrys — inaczej bryła je zakrywa
  // i auto wygląda jak klocek bez podwozia.
  for (const wx of [hw - ww - 1, -hw + 2]) {
    const wy = ART.kolaWystaja;
    gw.fillStyle = `rgba(10,12,16,${ART.kolaCiemnosc})`;
    roundRectOn(gw, wx, -hh - wy, ww, wh, 2); gw.fill();
    roundRectOn(gw, wx, hh - wh + wy, ww, wh, 2); gw.fill();
    gw.fillStyle = "rgba(255,255,255,.12)";                    // błysk na bieżniku
    roundRectOn(gw, wx + 1, -hh - wy + 0.5, ww - 2, 1.3, 0.6); gw.fill();
    roundRectOn(gw, wx + 1, hh - wh + wy + 0.5, ww - 2, 1.3, 0.6); gw.fill();
  }

  // --- ścianki nadwozia i kabiny (powtarzane warstwami w górę) ---
  const [silB, gb] = mk();
  gb.fillStyle = sideC; bodyPath(gb, B, 0); gb.fill();
  const [silC, gk] = mk();
  gk.fillStyle = shade(color, -0.38); cabPath(gk, B, 0); gk.fill();

  // --- górna płaszczyzna nadwozia: maska, tył, światła, lusterka ---
  const [top, gt] = mk();
  bodyPath(gt, B, 0); gt.fillStyle = color; gt.fill();
  gt.lineWidth = 1.6; gt.strokeStyle = shade(color, -0.32); gt.stroke();
  bodyPath(gt, B, 3.2); gt.fillStyle = shade(color, 0.08); gt.fill();   // przetłoczenie
  if (B.stripe) {                                                       // pasy na masce
    gt.fillStyle = "rgba(255,255,255,.34)";
    gt.fillRect(hw * 0.02, -4.4, hw * 0.92, 3.2);
    gt.fillRect(hw * 0.02,  1.2, hw * 0.92, 3.2);
  }
  const ly = hh * B.noseW * 0.60;
  gt.fillStyle = "#ffeeb8";                                             // reflektory
  roundRectOn(gt, hw - 6.5, -ly - 2.2, 4.6, 4.4, 1.6); gt.fill();
  roundRectOn(gt, hw - 6.5,  ly - 2.2, 4.6, 4.4, 1.6); gt.fill();
  const ty = hh * B.tailW * 0.62;
  gt.fillStyle = "#ff4d4d";                                             // światła tylne
  roundRectOn(gt, -hw + 2.2, -ty - 2.0, 3.4, 4.0, 1.2); gt.fill();
  roundRectOn(gt, -hw + 2.2,  ty - 2.0, 3.4, 4.0, 1.2); gt.fill();
  if (bodyType !== "kart") {                                            // lusterka
    const mx = hw * B.cab[1] - 2, mo = hh * 0.92;
    gt.fillStyle = shade(color, -0.15);
    roundRectOn(gt, mx, -mo - 3.2, 4.6, 3.0, 1.2); gt.fill();
    roundRectOn(gt, mx,  mo + 0.2, 4.6, 3.0, 1.2); gt.fill();
  }
  // Ostry ciemny obrys — bez niego auto zlewa się z jezdnią i wygląda jak plama.
  gt.strokeStyle = mine ? "#ffffff" : `rgba(6,8,12,${ART.obrys})`;
  gt.lineWidth = mine ? ART.obrysGrubosc + 0.8 : ART.obrysGrubosc;
  bodyPath(gt, B, 0); gt.stroke();

  // --- dach z szybami (albo odkryty gokart) ---
  const [cab, gc] = mk();
  const x0 = hw * B.cab[0], x1 = hw * B.cab[1], cw = hh * B.cabW, len = x1 - x0;
  if (bodyType === "kart") {
    gc.fillStyle = shade(color, -0.22);                    // fotel kubełkowy
    roundRectOn(gc, x0, -cw, len, cw * 2, 3); gc.fill();
    gc.fillStyle = "#1b1f27";                              // pałąk
    roundRectOn(gc, x0 + 0.5, -cw - 0.6, 3.4, cw * 2 + 1.2, 1.5); gc.fill();
    gc.fillStyle = "#2b3140";                              // kierownica
    roundRectOn(gc, x1 - 3.5, -cw * 0.55, 3.0, cw * 1.1, 1.4); gc.fill();
  } else {
    // Szklarnia czytana od tyłu do przodu: tylna szyba → DACH → przednia szyba.
    // Wcześniej obie szyby były po ~2,5 px i zlewały się w jedną czarną plamę,
    // przez co auto wyglądało jak łódź z nadbudówką. Dach musi być szerokim,
    // jasnym pasem w środku, bo to on mówi oku „to jest dach samochodu".
    cabPath(gc, B, 0); gc.fillStyle = shade(color, ART.dachJasnosc); gc.fill();
    gc.lineWidth = 1.3; gc.strokeStyle = shade(color, -0.28); gc.stroke();
    const gl = `rgba(24,33,48,${ART.szybaKrycie})`;   // szyba: granatowa, nie czarna
    const pas = (od, doo) => {
      const x = x0 + len * od, wdt = len * (doo - od);
      roundRectOn(gc, x, -cw + 1.1, wdt, cw * 2 - 2.2, 1.6);
    };
    if (B.roof) {                               // van: krótka kabina z przodu + długa paka
      gc.fillStyle = gl; pas(0.70, 0.93); gc.fill();
      gc.fillStyle = shade(color, -0.06); pas(0.08, 0.62); gc.fill();     // paka
      gc.fillStyle = shade(color, -0.24);                                  // relingi
      gc.fillRect(x0 + len * 0.12, -cw * 0.66, len * 0.46, 1.7);
      gc.fillRect(x0 + len * 0.12,  cw * 0.48, len * 0.46, 1.7);
    } else {
      gc.fillStyle = gl; pas(0.06, 0.28); gc.fill();                       // tylna szyba
      gc.fillStyle = shade(color, ART.dachJasnosc + 0.08); pas(0.32, 0.63); gc.fill();   // DACH
      gc.fillStyle = gl; pas(0.67, 0.93); gc.fill();                       // przednia szyba
      gc.fillStyle = "rgba(150,190,255,.20)";                              // odblask na przedniej
      roundRectOn(gc, x0 + len * 0.69, -cw + 1.6, len * 0.07, cw * 2 - 3.2, 1); gc.fill();
    }
    // słupki boczne — domykają szklarnię i oddzielają ją od nadwozia
    gc.fillStyle = shade(color, -0.18);
    gc.fillRect(x0 + len * 0.04, -cw, len * 0.92, 1.2);
    gc.fillRect(x0 + len * 0.04,  cw - 1.2, len * 0.92, 1.2);
  }

  // --- rąbek światła: biały obrys widoczny od góry-lewej (jak podświetlenie murków) ---
  const [rim, gr] = mk();
  gr.fillStyle = "rgba(255,255,255,.85)";
  if (bodyType === "kart") { bodyPath(gr, B, 0); } else { cabPath(gr, B, 0); }
  gr.fill();

  return { shad, wheels, silB, silC, top, cab, rim, w: W, h: H, h1, h2, sc };
}

// Rysuje całą bryłę auta. angle = kąt jazdy; przy podglądach (lobby, wybór
// karoserii) podajemy 0, więc auto stoi przodem w prawo.
function drawCarStack(g, x, y, angle, bodyType, color, mine, sharp) {
  const B = bodyOf(bodyType);
  const S = carSprites(bodyType, color, mine, sharp);
  const ox = -S.w / 2, oy = -S.h / 2;
  const W = S.w, H = S.h;                       // docelowy rozmiar w jednostkach świata
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const locX = (wx, wy) => wx * ca + wy * sa;      // wektor ze świata → układ auta
  const locY = (wx, wy) => -wx * sa + wy * ca;
  const ux = locX(0, -1), uy = locY(0, -1);        // „w górę ekranu" widziane z auta
  const step = CAR_QUALITY >= 2 ? 1 : 2;

  g.save();                                        // cień — w tę samą stronę co cienie murków
  g.translate(x + SH_X * 0.55 * B.height, y + SH_Y * 0.55 * B.height);
  g.rotate(angle);
  g.globalAlpha = ART.cien;
  g.drawImage(S.shad, ox, oy, W, H);
  g.globalAlpha = 1;
  g.restore();

  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.drawImage(S.wheels, ox, oy, W, H);                                   // koła na ziemi
  for (let d = 0; d <= S.h1; d += step) g.drawImage(S.silB, ox + ux * d, oy + uy * d, W, H);
  g.drawImage(S.top, ox + ux * S.h1, oy + uy * S.h1, W, H);              // maska i tył
  for (let d = S.h1; d <= S.h2; d += step) g.drawImage(S.silC, ox + ux * d, oy + uy * d, W, H);
  if (CAR_QUALITY >= 2) {                                              // rąbek od strony światła
    g.globalAlpha = ART.rabek;
    g.drawImage(S.rim, ox + ux * S.h2 + locX(-1.2, -2.2), oy + uy * S.h2 + locY(-1.2, -2.2), W, H);
    g.globalAlpha = 1;
  }
  g.drawImage(S.cab, ox + ux * S.h2, oy + uy * S.h2, W, H);              // dach z szybami
  g.restore();
}


// ====================================================================
// WARIANT 2: gotowe grafiki z Kenney Racing Pack (kenney.nl, licencja CC0).
// Sprite'y są pionowe (auto patrzy w górę) i jednokolorowe — czerwone.
// Kolor gracza robimy OBROTEM ODCIENIA, nie zamalowaniem: dzięki temu
// zostaje oryginalne cieniowanie, szyby i światła.
// Gotowy obrazek (obrócony + przebarwiony) trafia do cache, bo filtry
// canvasa są drogie i nie wolno ich liczyć co klatkę.
// ====================================================================
const KENNEY_PLIKI = {
  sport:  "cars/car_red_5.png",        // smukły
  muscle: "cars/car_red_1.png",        // masywny, dwa pasy
  van:    "cars/car_red_4.png",        // furgon z paką
  kart:   "cars/car_red_small_2.png",  // najmniejszy
};
const KENNEY_IMG = {};
let KENNEY_GOTOWE = false;
const CZEKAJACY_NA_GRAFIKI = [];

// Grafiki wczytują się asynchronicznie, a miniaturki malują się od razu przy
// starcie strony — bez tego haczyka pokazywały wersję rysowaną kodem i dopiero
// kliknięcie w kafelek pokazywało prawdziwą karoserię.
function gdyGrafikiGotowe(fn) {
  if (KENNEY_GOTOWE) fn();
  else CZEKAJACY_NA_GRAFIKI.push(fn);
}

function grafikiGotowe() {
  KENNEY_GOTOWE = Object.keys(KENNEY_IMG).length > 0;
  while (CZEKAJACY_NA_GRAFIKI.length) CZEKAJACY_NA_GRAFIKI.shift()();
}
let UZYJ_KENNEY = true;                // przełącznik: grafiki vs rysowanie kodem

function wczytajKenney(gdy) {
  let zostalo = Object.keys(KENNEY_PLIKI).length;
  for (const k in KENNEY_PLIKI) {
    const im = new Image();
    im.onload = () => { KENNEY_IMG[k] = im; if (--zostalo === 0) { grafikiGotowe(); gdy && gdy(); } };
    im.onerror = () => { if (--zostalo === 0) { grafikiGotowe(); gdy && gdy(); } };
    im.src = KENNEY_PLIKI[k];
  }
}

function hexNaHsl(hex) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255,
        b = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hue = 0;
  if (d) {
    if (mx === r) hue = ((g - b) / d) % 6;
    else if (mx === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60; if (hue < 0) hue += 360;
  }
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [hue, s, l];
}

const KENNEY_BAZA_HUE = 16;            // odcień czerwieni Kenneya
function filtrKoloru(hex) {
  const [h, s, l] = hexNaHsl(hex);
  const obrot = Math.round(h - KENNEY_BAZA_HUE);
  const nasyc = (s / 0.72).toFixed(2);          // 0 = auto szare/białe
  const jasn = (0.72 + l * 0.62).toFixed(2);
  return `hue-rotate(${obrot}deg) saturate(${nasyc}) brightness(${jasn})`;
}

const KEN_SPR = new Map();
function kenneySprite(bodyType, color, mine, sharp) {
  const sc = Math.max(1, Math.min(4, Math.round((sharp || 1) * 2) / 2));
  const key = "K|" + bodyType + "|" + color + "|" + (mine ? 1 : 0) + "|" + sc;
  let s = KEN_SPR.get(key);
  if (!s) {
    s = budujKenney(bodyType, color, !!mine, sc);
    if (KEN_SPR.size >= 64) KEN_SPR.delete(KEN_SPR.keys().next().value);
    KEN_SPR.set(key, s);
  }
  return s;
}

function budujKenney(bodyType, color, mine, sc) {
  const img = KENNEY_IMG[bodyType] || KENNEY_IMG.sport;
  const B = bodyOf(bodyType);
  const W = Math.ceil(B.w + 14), H = Math.ceil(B.h + 14);
  const dl = B.w;                                   // długość auta w jednostkach świata
  const sz = dl * (img.width / img.height);         // szerokość z proporcji sprite'a
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = Math.ceil(W * sc); c.height = Math.ceil(H * sc);
    const g = c.getContext("2d");
    g.setTransform(sc, 0, 0, sc, (W * sc) / 2, (H * sc) / 2);
    return [c, g];
  };
  // Sprite patrzy w górę, a w grze +x to przód — stąd obrót o 90°.
  const poloz = (g) => { g.rotate(Math.PI / 2); g.drawImage(img, -sz / 2, -dl / 2, sz, dl); };
  const filtryDzialaja = (() => {
    const t = document.createElement("canvas").getContext("2d");
    return typeof t.filter === "string";
  })();

  const [glowny, g1] = mk();
  if (mine && filtryDzialaja) {                     // biała obwódka „to ja"
    g1.save(); g1.filter = "brightness(0) invert(1)";
    for (const [dx, dy] of [[-1.6,0],[1.6,0],[0,-1.6],[0,1.6]]) {
      g1.save(); g1.translate(dx, dy); poloz(g1); g1.restore();
    }
    g1.restore();
  }
  g1.save();
  if (filtryDzialaja) g1.filter = filtrKoloru(color);
  poloz(g1);
  g1.restore();

  const [cien, g2] = mk();                          // cień: ta sama sylwetka na czarno
  g2.save();
  if (filtryDzialaja) g2.filter = "brightness(0)";
  poloz(g2);
  g2.restore();

  return { img: glowny, cien, w: W, h: H, sc, filtry: filtryDzialaja };
}

// Rysowanie auta z grafiki. Wysokość udajemy samym cieniem — sprite'y Kenneya
// są płaskim rzutem z góry i tak właśnie mają wyglądać.
function drawCarKenney(g, x, y, angle, bodyType, color, mine, sharp) {
  const B = bodyOf(bodyType);
  const S = kenneySprite(bodyType, color, mine, sharp);
  const ox = -S.w / 2, oy = -S.h / 2;
  g.save();
  g.translate(x + SH_X * 0.5 * B.height, y + SH_Y * 0.5 * B.height);
  g.rotate(angle);
  g.globalAlpha = ART.cien;
  g.drawImage(S.cien, ox, oy, S.w, S.h);
  g.globalAlpha = 1;
  g.restore();
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.drawImage(S.img, ox, oy, S.w, S.h);
  g.restore();
}

// Jedno wejście dla gry i tunera: grafiki, gdy są gotowe, inaczej rysowanie kodem.
function drawCarAny(g, x, y, angle, bodyType, color, mine, sharp) {
  if (UZYJ_KENNEY && KENNEY_GOTOWE) drawCarKenney(g, x, y, angle, bodyType, color, mine, sharp);
  else drawCarStack(g, x, y, angle, bodyType, color, mine, sharp);
}

wczytajKenney();
