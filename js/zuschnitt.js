// Foto zuschneiden für Kontakte und Belege: vier Ecken ziehen, drehen, Kontrast, perspektivisch entzerren.
// Ergebnis ist ein JPEG (Qualität 0,85), längste Seite höchstens 1600 px. Abbrechen liefert null.

const QUALITAET = 0.85;
const MAX_SEITE = 1600;
const ARBEIT_MAX = 2400; // Quellbild wird für Anzeige und Entzerrung höchstens so groß gerechnet
const FEHLER_FORMAT = 'Dieses Bildformat kann der Browser nicht öffnen.';
const RAND = 0.04;
const ECKEN_NAMEN = ['oben links', 'oben rechts', 'unten rechts', 'unten links'];

// Homographie: 3×3-Matrix als neun Werte (zeilenweise, letzter Wert 1), die vier Punkte von auf nach abbildet.
// Löst das 8×8-Gleichungssystem nach Gauß mit Spaltenauswahl.
export function homographie(von, nach) {
  const zeilen = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = von[i];
    const { x: u, y: v } = nach[i];
    zeilen.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
    zeilen.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) {
      if (Math.abs(zeilen[r][c]) > Math.abs(zeilen[p][c])) p = r;
    }
    if (Math.abs(zeilen[p][c]) < 1e-12) throw new Error('Die vier Ecken bilden kein Viereck.');
    [zeilen[c], zeilen[p]] = [zeilen[p], zeilen[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = zeilen[r][c] / zeilen[c][c];
      if (f === 0) continue;
      for (let k = c; k < 9; k++) zeilen[r][k] -= f * zeilen[c][k];
    }
  }
  const h = [];
  for (let i = 0; i < 8; i++) h.push(zeilen[i][8] / zeilen[i][i]);
  h.push(1);
  return h;
}

// Einen Punkt mit der Homographie abbilden
export function punktAbbilden(h, { x, y }) {
  const d = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
}

// Perspektivisch entzerren. ecken: vier Punkte {x, y} im Quellbild, in der Reihenfolge
// oben links, oben rechts, unten rechts, unten links. Für jedes Zielpixel wird über die
// inverse Abbildung bilinear aus dem Quellbild gelesen.
export function entzerren(bild, ecken, breite, hoehe) {
  const h = homographie(
    [{ x: 0, y: 0 }, { x: breite, y: 0 }, { x: breite, y: hoehe }, { x: 0, y: hoehe }],
    ecken,
  );
  const aus = new ImageData(breite, hoehe);
  const q = bild.data;
  const w = bild.width;
  const hq = bild.height;
  const z = aus.data;
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = h[6] * px + h[7] * py + h[8];
      const sx = Math.min(Math.max((h[0] * px + h[1] * py + h[2]) / d - 0.5, 0), w - 1);
      const sy = Math.min(Math.max((h[3] * px + h[4] * py + h[5]) / d - 0.5, 0), hq - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, w - 1);
      const y1 = Math.min(y0 + 1, hq - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * w + x0) * 4;
      const i10 = (y0 * w + x1) * 4;
      const i01 = (y1 * w + x0) * 4;
      const i11 = (y1 * w + x1) * 4;
      const o = (y * breite + x) * 4;
      for (let c = 0; c < 4; c++) {
        const oben = q[i00 + c] + (q[i10 + c] - q[i00 + c]) * fx;
        const unten = q[i01 + c] + (q[i11 + c] - q[i01 + c]) * fx;
        z[o + c] = oben + (unten - oben) * fy;
      }
    }
  }
  return aus;
}

// Zielgröße aus den Kantenlängen, längste Seite höchstens MAX_SEITE
function zielGroesse(e) {
  const laenge = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const breite = Math.max(laenge(e[0], e[1]), laenge(e[3], e[2]));
  const hoehe = Math.max(laenge(e[0], e[3]), laenge(e[1], e[2]));
  const f = Math.min(1, MAX_SEITE / Math.max(breite, hoehe, 1));
  return {
    breite: Math.max(1, Math.round(breite * f)),
    hoehe: Math.max(1, Math.round(hoehe * f)),
  };
}

// Graustufen mit Tonwertspreizung: 1 % und 99 % der Helligkeit werden auf Schwarz und Weiß gelegt
function kontrastStrecken(bild) {
  const d = bild.data;
  const n = bild.width * bild.height;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = g;
    d[i + 1] = g;
    d[i + 2] = g;
    hist[g]++;
  }
  const untere = n * 0.01;
  const obere = n * 0.99;
  let lo = 0;
  let hi = 255;
  let summe = 0;
  for (let v = 0; v < 256; v++) {
    summe += hist[v];
    if (summe >= untere) { lo = v; break; }
  }
  summe = 0;
  for (let v = 0; v < 256; v++) {
    summe += hist[v];
    if (summe >= obere) { hi = v; break; }
  }
  if (hi <= lo) return bild;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const g = lut[d[i]];
    d[i] = g;
    d[i + 1] = g;
    d[i + 2] = g;
  }
  return bild;
}

// Bild laden: zuerst createImageBitmap, sonst <img> (Safari wandelt HEIC dort um).
// Ergebnis ist ein Canvas, höchstens ARBEIT_MAX groß.
function ladeAlsImg(datei) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => resolve({ quelle: img, ende: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(FEHLER_FORMAT));
    };
    img.src = url;
  });
}

async function arbeitsLeinwand(datei) {
  let quelle = null;
  let ende = () => {};
  try {
    quelle = await createImageBitmap(datei);
    ende = () => quelle.close();
  } catch {
    try {
      const geladen = await ladeAlsImg(datei);
      quelle = geladen.quelle;
      ende = geladen.ende;
    } catch {
      throw new Error(FEHLER_FORMAT);
    }
  }
  const w0 = quelle.naturalWidth || quelle.width;
  const h0 = quelle.naturalHeight || quelle.height;
  if (!w0 || !h0) {
    ende();
    throw new Error(FEHLER_FORMAT);
  }
  const f = Math.min(1, ARBEIT_MAX / Math.max(w0, h0));
  const leinwand = document.createElement('canvas');
  leinwand.width = Math.max(1, Math.round(w0 * f));
  leinwand.height = Math.max(1, Math.round(h0 * f));
  const ctx = leinwand.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(quelle, 0, 0, leinwand.width, leinwand.height);
  ende();
  return leinwand;
}

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svgEl(tag, attribute) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attribute)) e.setAttribute(k, v);
  return e;
}

function startEcken() {
  return [
    { x: RAND, y: RAND },
    { x: 1 - RAND, y: RAND },
    { x: 1 - RAND, y: 1 - RAND },
    { x: RAND, y: 1 - RAND },
  ];
}

// Öffnet das Zuschnitt-Sheet. Liefert ein JPEG-Blob, oder null, wenn abgebrochen wird.
// Scheitert das Laden des Bildes, wird ein Fehler mit deutscher Meldung geworfen.
export async function zuschneiden(datei, kontext) {
  const leinwand0 = await arbeitsLeinwand(datei);

  return new Promise((resolve) => {
    let leinwand = leinwand0;
    let ecken = startEcken();
    let kontrast = false;
    let beendet = false;
    let ziehend = null;

    const huelle = el('div', 'zuschnitt');
    const hinweis = el('p', 'zuschnitt-hinweis', 'Ziehe die vier Ecken an die Kanten des Dokuments.');
    const buehne = el('div', 'zuschnitt-buehne');
    const anzeige = el('canvas', 'zuschnitt-leinwand');
    anzeige.setAttribute('aria-hidden', 'true');

    const rahmen = svgEl('svg', { class: 'zuschnitt-rahmen', viewBox: '0 0 1 1', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const abdunklung = svgEl('path', { class: 'zuschnitt-abdunklung' });
    const linie = svgEl('polygon', { class: 'zuschnitt-linie' });
    rahmen.append(abdunklung, linie);

    const eckKnoepfe = ECKEN_NAMEN.map((name) => {
      const knopf = el('button', 'zuschnitt-ecke');
      knopf.type = 'button';
      knopf.setAttribute('aria-label', `Ecke ${name}`);
      return knopf;
    });

    buehne.append(anzeige, rahmen, ...eckKnoepfe);

    const werkzeuge = el('div', 'zuschnitt-werkzeuge');
    const drehKnopf = el('button', 'zuschnitt-knopf', 'Drehen');
    const ganzKnopf = el('button', 'zuschnitt-knopf', 'Ganzes Bild');
    const kontrastKnopf = el('button', 'zuschnitt-knopf', 'Kontrast');
    drehKnopf.type = ganzKnopf.type = kontrastKnopf.type = 'button';
    kontrastKnopf.setAttribute('aria-pressed', 'false');
    werkzeuge.append(drehKnopf, ganzKnopf, kontrastKnopf);

    const status = el('p', 'zuschnitt-status');
    status.setAttribute('role', 'status');

    const aktionen = el('div', 'zuschnitt-aktionen');
    const abbrechenKnopf = el('button', 'zuschnitt-knopf', 'Abbrechen');
    const fertigKnopf = el('button', 'zuschnitt-knopf zuschnitt-knopf-haupt', 'Fertig');
    abbrechenKnopf.type = fertigKnopf.type = 'button';
    aktionen.append(abbrechenKnopf, fertigKnopf);

    huelle.append(hinweis, buehne, werkzeuge, status, aktionen);

    const alleKnoepfe = [drehKnopf, ganzKnopf, kontrastKnopf, abbrechenKnopf, fertigKnopf];

    function sperren(an) {
      for (const k of alleKnoepfe) k.disabled = an;
    }

    function statusSetzen(text, fehler = false) {
      status.textContent = text;
      status.classList.toggle('fehler', fehler);
    }

    // Bildgröße in der Anzeige: so groß wie möglich, höchstens 60 % der Höhe des Fensters
    function anordnen() {
      const breite = huelle.clientWidth;
      if (!breite) return;
      const maxH = Math.min(window.innerHeight * 0.6, 520);
      const s = Math.min(breite / leinwand.width, maxH / leinwand.height);
      buehne.style.width = `${Math.floor(leinwand.width * s)}px`;
      buehne.style.height = `${Math.floor(leinwand.height * s)}px`;
    }

    function zeigen() {
      anzeige.width = leinwand.width;
      anzeige.height = leinwand.height;
      anzeige.getContext('2d').drawImage(leinwand, 0, 0);
      anzeige.classList.toggle('kontrast', kontrast);
    }

    function rahmenZeichnen() {
      const punkte = ecken.map((e) => `${e.x},${e.y}`).join(' ');
      linie.setAttribute('points', punkte);
      const loch = ecken.map((e, i) => `${i ? 'L' : 'M'}${e.x},${e.y}`).join(' ');
      abdunklung.setAttribute('d', `M0,0 H1 V1 H0 Z ${loch} Z`);
      ecken.forEach((e, i) => {
        eckKnoepfe[i].style.left = `${e.x * 100}%`;
        eckKnoepfe[i].style.top = `${e.y * 100}%`;
      });
    }

    function pixelEcken() {
      return ecken.map((e) => ({ x: e.x * leinwand.width, y: e.y * leinwand.height }));
    }

    function ende(ergebnis) {
      if (beendet) return;
      beendet = true;
      beobachter.disconnect();
      window.removeEventListener('resize', anordnen);
      resolve(ergebnis);
    }

    // Schließt das Sheet auch dann, wenn die App es über Escape oder den Hintergrund schließt
    const beobachter = new MutationObserver(() => {
      if (!beendet && !huelle.isConnected) ende(null);
    });

    // Ecken: Zeigen und Ziehen mit Pointer Events (Maus und Finger), Pfeiltasten für Tastatur
    eckKnoepfe.forEach((knopf, i) => {
      knopf.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          knopf.setPointerCapture(e.pointerId);
        } catch {
          // Ohne Fangen läuft das Ziehen trotzdem, solange der Zeiger über der Ecke bleibt
        }
        ziehend = { index: i, id: e.pointerId };
        knopf.classList.add('zieht');
      });
      knopf.addEventListener('pointermove', (e) => {
        if (!ziehend || ziehend.id !== e.pointerId) return;
        const r = buehne.getBoundingClientRect();
        ecken[i] = {
          x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
          y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
        };
        rahmenZeichnen();
      });
      const loslassen = (e) => {
        if (!ziehend || ziehend.id !== e.pointerId) return;
        ziehend = null;
        knopf.classList.remove('zieht');
      };
      knopf.addEventListener('pointerup', loslassen);
      knopf.addEventListener('pointercancel', loslassen);
      knopf.addEventListener('keydown', (e) => {
        const schritt = e.shiftKey ? 0.05 : 0.01;
        const richtung = {
          ArrowLeft: [-schritt, 0],
          ArrowRight: [schritt, 0],
          ArrowUp: [0, -schritt],
          ArrowDown: [0, schritt],
        }[e.key];
        if (!richtung) return;
        e.preventDefault();
        ecken[i] = {
          x: Math.min(Math.max(ecken[i].x + richtung[0], 0), 1),
          y: Math.min(Math.max(ecken[i].y + richtung[1], 0), 1),
        };
        rahmenZeichnen();
      });
    });

    // 90 Grad im Uhrzeigersinn: die Ecken wandern mit dem Bildinhalt mit
    drehKnopf.addEventListener('click', () => {
      const alt = leinwand;
      const neu = document.createElement('canvas');
      neu.width = alt.height;
      neu.height = alt.width;
      const ctx = neu.getContext('2d');
      ctx.translate(neu.width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(alt, 0, 0);
      leinwand = neu;
      // Punkt (x, y) wandert auf (1 - y, x). Danach liegt die alte untere linke Ecke oben links,
      // deshalb wird die Reihenfolge um eine Stelle weitergereicht.
      const gedreht = ecken.map((e) => ({ x: 1 - e.y, y: e.x }));
      ecken = [gedreht[3], gedreht[0], gedreht[1], gedreht[2]];
      zeigen();
      anordnen();
      rahmenZeichnen();
    });

    ganzKnopf.addEventListener('click', () => {
      ecken = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
      rahmenZeichnen();
    });

    kontrastKnopf.addEventListener('click', () => {
      kontrast = !kontrast;
      kontrastKnopf.setAttribute('aria-pressed', String(kontrast));
      anzeige.classList.toggle('kontrast', kontrast);
    });

    abbrechenKnopf.addEventListener('click', () => {
      ende(null);
      kontext.sheet.schliessen();
    });

    // Entzerren und JPEG erzeugen
    async function ausgabe() {
      const punkte = pixelEcken();
      const g = zielGroesse(punkte);
      const daten = leinwand.getContext('2d').getImageData(0, 0, leinwand.width, leinwand.height);
      const bild = entzerren(daten, punkte, g.breite, g.hoehe);
      if (kontrast) kontrastStrecken(bild);
      const c = document.createElement('canvas');
      c.width = g.breite;
      c.height = g.hoehe;
      c.getContext('2d').putImageData(bild, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', QUALITAET));
      if (!blob) throw new Error('Das Foto konnte nicht gespeichert werden.');
      return blob;
    }

    fertigKnopf.addEventListener('click', async () => {
      sperren(true);
      statusSetzen('Das Foto wird zugeschnitten.');
      await new Promise((r) => setTimeout(r, 30));
      try {
        const blob = await ausgabe();
        ende(blob);
        kontext.sheet.schliessen();
      } catch (err) {
        statusSetzen(err.message || 'Das Foto konnte nicht verarbeitet werden.', true);
        sperren(false);
      }
    });

    zeigen();
    rahmenZeichnen();
    kontext.sheet.oeffnen('Foto zuschneiden', huelle);
    beobachter.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', anordnen);
    anordnen();
    requestAnimationFrame(anordnen);
  });
}
