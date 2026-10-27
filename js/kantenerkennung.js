// Visitenkarte im Foto finden: OpenCV.js (lokal aus web/vendor/opencv/) sucht das Viereck der Karte.
// karteErkennen(quelle) liefert die vier Ecken in Originalkoordinaten (oben links, oben rechts,
// unten rechts, unten links) oder null. Alle cv.Mat-Objekte werden danach wieder freigegeben.
const OPENCV_JS = new URL('../vendor/opencv/opencv.js', import.meta.url).href;
const MAX_SEITE = 800; // Rechnung auf dem verkleinerten Bild (lange Seite)
const FLAECHE = [0.08, 0.95]; // Anteil der Karte an der Bildfläche
const SEITEN = [1.3, 2.0]; // Seitenverhältnis einer Visitenkarte (lang zu kurz)
const WARTEZEIT = 60000; // ms, bis OpenCV nach dem Laden bereit sein muss
// Toleranzen für approxPolyDP (Anteil am Umfang), der Reihe nach, bis die Kontur vier Ecken hat
const TOLERANZEN = [0.02, 0.03, 0.045, 0.06];

let skriptLadung = null;

const bereit = () => !!globalThis.cv && typeof globalThis.cv.Mat === 'function';

// Ist OpenCV geladen und einsatzbereit? (ohne Laden, für den Scanner)
export function istBereit() {
  return bereit();
}

// Achtung: OpenCV ist ein Objekt mit eigener then-Methode. Es darf NICHT als Promise-Ergebnis übergeben werden
// (das ergäbe eine endlose Schleife aus Microtasks), deshalb liefert das Laden nur true; cv wird über globalThis.cv gelesen.
// opencv.js genau einmal per <script> laden. Nach dem Laden wartet die Funktion, bis die WebAssembly-Laufzeit
// fertig ist (das Erscheinen von cv.Mat), höchstens WARTEZEIT lang.
function opencvLaden() {
  if (bereit()) return Promise.resolve(true);
  if (!skriptLadung) {
    skriptLadung = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = OPENCV_JS;
      s.async = true;
      s.onload = () => {
        const beginn = performance.now();
        const warten = () => {
          if (bereit()) {
            resolve(true);
          } else if (performance.now() - beginn > WARTEZEIT) {
            skriptLadung = null;
            reject(new Error('OpenCV ist nicht bereit geworden.'));
          } else {
            setTimeout(warten, 50);
          }
        };
        warten();
      };
      s.onerror = () => {
        skriptLadung = null;
        s.remove();
        reject(new Error('OpenCV konnte nicht geladen werden.'));
      };
      document.head.append(s);
    });
  }
  return skriptLadung;
}

// Zeichenfläche in Bildgröße (OffscreenCanvas, sonst normales Canvas)
function flaeche(breite, hoehe) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(breite, hoehe);
  const c = document.createElement('canvas');
  c.width = breite;
  c.height = hoehe;
  return c;
}

// Quelle (ImageBitmap, Canvas oder ImageData) verkleinert als Pixeldaten holen. Rundum wird ein schwarzer Rand
// von 3 % gelegt, damit eine Karte, die bis an den Bildrand reicht, eine geschlossene Kontur hat.
// sx, sy rechnen Koordinaten des verkleinerten Bildes auf das Original zurück, pad ist der Rand in Pixeln.
function verkleinert(quelle) {
  const W = quelle.width;
  const H = quelle.height;
  if (!W || !H) throw new Error('Das Bild ist leer.');
  const f = Math.min(1, MAX_SEITE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * f));
  const h = Math.max(1, Math.round(H * f));
  const pad = Math.round(0.03 * Math.max(w, h));
  const c = flaeche(w + 2 * pad, h + 2 * pad);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w + 2 * pad, h + 2 * pad);
  if (typeof ImageData !== 'undefined' && quelle instanceof ImageData) {
    // ImageData lässt sich nur in ein Canvas in Originalgröße setzen, von dort verkleinert zeichnen
    const voll = flaeche(W, H);
    voll.getContext('2d').putImageData(quelle, 0, 0);
    ctx.drawImage(voll, pad, pad, w, h);
  } else {
    ctx.drawImage(quelle, pad, pad, w, h);
  }
  return {
    bild: ctx.getImageData(0, 0, w + 2 * pad, h + 2 * pad),
    sx: W / w,
    sy: H / h,
    pad,
  };
}

// Median der Helligkeitswerte (Histogramm), für die Canny-Schwellen
function medianWert(daten) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < daten.length; i++) hist[daten[i]]++;
  const halb = daten.length / 2;
  let summe = 0;
  for (let v = 0; v < 256; v++) {
    summe += hist[v];
    if (summe >= halb) return v;
  }
  return 128;
}

// Ecken so ordnen: oben links (kleinste x+y), oben rechts (kleinste y−x), unten rechts (größte x+y), unten links (größte y−x)
function ordnen(p) {
  const finde = (werte, dir) => {
    let best = 0;
    for (let i = 1; i < 4; i++) if (dir * (werte[i] - werte[best]) > 0) best = i;
    return best;
  };
  const summe = p.map((q) => q.x + q.y);
  const diff = p.map((q) => q.y - q.x);
  return [p[finde(summe, -1)], p[finde(diff, -1)], p[finde(summe, 1)], p[finde(diff, 1)]];
}

// Verhältnis lange zu kurze Seite eines geordneten Vierecks
function seitenVerhaeltnis(e) {
  const d = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const breite = (d(e[0], e[1]) + d(e[3], e[2])) / 2;
  const hoehe = (d(e[0], e[3]) + d(e[1], e[2])) / 2;
  return Math.max(breite, hoehe) / Math.max(Math.min(breite, hoehe), 1e-9);
}

// Ecken eines RotatedRect (Konvention wie cv.boxPoints)
function rechteckEcken(r) {
  const a = (r.angle * Math.PI) / 180;
  const b = Math.cos(a) * 0.5;
  const c = Math.sin(a) * 0.5;
  const w = r.size.width;
  const h = r.size.height;
  const cx = r.center.x;
  const cy = r.center.y;
  const p0 = { x: cx - c * h - b * w, y: cy + b * h - c * w };
  const p1 = { x: cx + c * h - b * w, y: cy - b * h - c * w };
  return [p0, p1, { x: 2 * cx - p0.x, y: 2 * cy - p0.y }, { x: 2 * cx - p1.x, y: 2 * cy - p1.y }];
}

// Eine Binärmaske (Kanten oder Flächen) auswerten. Liefert die Vierecke (mit Fläche) und die Rechtecke
// (kleinstes umschließendes Rechteck), jeweils nur im Bereich FLAECHE und SEITEN. Gibt eigene Mats frei.
function kandidatenAus(cv, maske, gesamt, istRahmen) {
  const frei = [];
  const halte = (objekt) => {
    frei.push(objekt);
    return objekt;
  };
  const vierecke = [];
  const rechtecke = [];
  try {
    const konturen = halte(new cv.MatVector());
    const hierarchie = halte(new cv.Mat());
    cv.findContours(maske, konturen, hierarchie, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < konturen.size(); i++) {
      const cnt = konturen.get(i);
      const huelle = new cv.Mat();
      const naeherung = new cv.Mat();
      try {
        cv.convexHull(cnt, huelle, false, true);
        const flaecheWert = cv.contourArea(huelle);
        if (flaecheWert < FLAECHE[0] * gesamt || flaecheWert > FLAECHE[1] * gesamt) continue;
        const umfang = cv.arcLength(huelle, true);
        for (const tol of TOLERANZEN) {
          cv.approxPolyDP(huelle, naeherung, tol * umfang, true);
          if (naeherung.rows === 4 && cv.isContourConvex(naeherung)) break;
        }
        if (naeherung.rows === 4 && cv.isContourConvex(naeherung)) {
          const d = naeherung.data32S;
          const punkte = ordnen([0, 1, 2, 3].map((k) => ({ x: d[2 * k], y: d[2 * k + 1] })));
          const verh = seitenVerhaeltnis(punkte);
          if (verh >= SEITEN[0] && verh <= SEITEN[1] && !istRahmen(punkte)) {
            vierecke.push({ flaeche: flaecheWert, ecken: punkte });
          }
        }
        const rechteck = cv.minAreaRect(huelle);
        const kurz = Math.min(rechteck.size.width, rechteck.size.height);
        const lang = Math.max(rechteck.size.width, rechteck.size.height);
        const fuellung = flaecheWert / Math.max(rechteck.size.width * rechteck.size.height, 1);
        if (kurz > 0 && lang / kurz >= SEITEN[0] && lang / kurz <= SEITEN[1] && fuellung >= 0.8
          && !istRahmen(rechteckEcken(rechteck))) {
          rechtecke.push({ flaeche: flaecheWert, rechteck });
        }
      } finally {
        cnt.delete();
        huelle.delete();
        naeherung.delete();
      }
    }
  } finally {
    for (const objekt of frei) {
      try {
        objekt.delete();
      } catch {
        // schon freigegeben
      }
    }
  }
  return { vierecke, rechtecke };
}

// Die Masken, die nacheinander probiert werden. Helle Karten auf hellem Tisch haben kaum Kontrast, deshalb
// gibt es Canny-Schwellen aus dem Median (normal und mit kräftiger Verdickung), schwache feste Schwellen auf dem
// angeglichenen Bild (Histogrammausgleich) und Otsu-Schwellen für helle und dunkle Karten.
function masken(cv, weich, eq, median) {
  const liste = [];
  const kern3 = cv.Mat.ones(3, 3, cv.CV_8U);
  const kern5 = cv.Mat.ones(5, 5, cv.CV_8U);
  const punkt = new cv.Point(-1, -1);
  const kantenMaske = (bild, lo, hi, kern, iter) => {
    const k = new cv.Mat();
    cv.Canny(bild, k, lo, hi);
    const d = new cv.Mat();
    cv.dilate(k, d, kern, punkt, iter, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    k.delete();
    return d;
  };
  liste.push(() => kantenMaske(weich, Math.max(0, 0.66 * median), Math.min(255, 1.33 * median), kern3, 1));
  liste.push(() => kantenMaske(eq, 12, 36, kern3, 1));
  liste.push(() => kantenMaske(eq, 12, 36, kern5, 2));
  liste.push(() => kantenMaske(eq, 25, 75, kern5, 2));
  liste.push(() => kantenMaske(weich, 30, 90, kern5, 2));
  const schwelle = (bild, typ) => () => {
    const d = new cv.Mat();
    cv.threshold(bild, d, 0, 255, typ | cv.THRESH_OTSU);
    return d;
  };
  liste.push(schwelle(eq, cv.THRESH_BINARY));
  liste.push(schwelle(eq, cv.THRESH_BINARY_INV));
  liste.push(schwelle(weich, cv.THRESH_BINARY));
  liste.push(schwelle(weich, cv.THRESH_BINARY_INV));
  return { liste, kern3, kern5 };
}

// Schnittpunkt zweier Geraden durch Segmente (a x + b y = c), oder null bei Parallelität
function schnitt(l, m) {
  const det = l.a * m.b - m.a * l.b;
  if (Math.abs(det) < 1e-9) return null;
  return { x: (l.c * m.b - m.c * l.b) / det, y: (l.a * m.c - m.a * l.c) / det };
}

// Linien aus HoughLinesP: je Segment Länge, Richtung (0 bis π), Mitte und Geradenform.
function linienLesen(lines, minLen) {
  const liste = [];
  for (let i = 0; i < lines.rows; i++) {
    const d = lines.data32S;
    const x1 = d[4 * i];
    const y1 = d[4 * i + 1];
    const x2 = d[4 * i + 2];
    const y2 = d[4 * i + 3];
    const laenge = Math.hypot(x2 - x1, y2 - y1);
    if (laenge < minLen) continue;
    let ang = Math.atan2(y2 - y1, x2 - x1);
    if (ang < 0) ang += Math.PI;
    const a = y2 - y1;
    const b = x1 - x2;
    liste.push({
      x1, y1, x2, y2, laenge, ang,
      mx: (x1 + x2) / 2,
      my: (y1 + y2) / 2,
      a,
      b,
      c: a * x1 + b * y1,
    });
  }
  return liste.sort((p, q) => q.laenge - p.laenge);
}

// Kantenstärke der vier Seiten eines Vierecks (Gradientenbetrag, Stichproben je Seite). Gewertet wird die
// schwächste Seite: Eine echte Karte hat an allen vier Seiten Kontrast, ein Ausschnitt aus Glanz oder Text nicht.
function kantenStaerke(e, mag, w, h) {
  const S = 24;
  let minimum = Infinity;
  for (let k = 0; k < 4; k++) {
    const p = e[k];
    const q = e[(k + 1) % 4];
    let summe = 0;
    for (let t = 0; t < S; t++) {
      const x = Math.round(p.x + ((q.x - p.x) * t) / S);
      const y = Math.round(p.y + ((q.y - p.y) * t) / S);
      if (x >= 0 && y >= 0 && x < w && y < h) summe += mag[y * w + x];
    }
    minimum = Math.min(minimum, summe / S);
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

// Kartenkandidaten aus Linienpaaren: Für jede Richtung i werden alle Paare paralleler Linien (Abstand mindestens
// mindest) mit allen Paaren senkrechter Linien kombiniert. Jedes Viereck wird geprüft (konvex, Fläche, Seiten,
// Rahmen) und nach der Kantenstärke an seinen Seiten bewertet.
function linienKandidaten(lines, w, h, istRahmen, mindest, mag) {
  const grenze = (Math.PI / 180) * 7; // Toleranz der Richtung
  const gesamt = w * h;
  const kandidaten = [];
  const richtungen = lines.slice(0, 20);
  for (const i of richtungen) {
    const dx = Math.cos(i.ang);
    const dy = Math.sin(i.ang);
    const nx = -dy;
    const ny = dx;
    const parallel = [];
    const senkrecht = [];
    for (const j of lines) {
      let d = Math.abs(i.ang - j.ang);
      d = Math.min(d, Math.PI - d);
      if (d <= grenze) parallel.push(j);
      else if (Math.abs(Math.PI / 2 - d) <= grenze) senkrecht.push(j);
    }
    const P = parallel.slice(0, 14).map((l) => ({ l, v: l.mx * nx + l.my * ny }));
    const Q = senkrecht.slice(0, 14).map((l) => ({ l, v: l.mx * dx + l.my * dy }));
    for (let a = 0; a < P.length; a++) {
      for (let b = a + 1; b < P.length; b++) {
        if (Math.abs(P[a].v - P[b].v) < mindest) continue;
        for (let c = 0; c < Q.length; c++) {
          for (let d = c + 1; d < Q.length; d++) {
            if (Math.abs(Q[c].v - Q[d].v) < mindest) continue;
            const L = [P[a].l, P[b].l];
            const M = [Q[c].l, Q[d].l];
            const ecken = [schnitt(L[0], M[0]), schnitt(L[1], M[0]), schnitt(L[1], M[1]), schnitt(L[0], M[1])];
            if (ecken.some((pt) => !pt)) continue;
            const ordnet = ordnen(ecken);
            let vorzeichen = 0;
            let konvex = true;
            for (let k = 0; k < 4; k++) {
              const p1 = ordnet[k];
              const p2 = ordnet[(k + 1) % 4];
              const p3 = ordnet[(k + 2) % 4];
              const kreuz = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
              if (!vorzeichen) vorzeichen = Math.sign(kreuz);
              else if (Math.sign(kreuz) !== vorzeichen) konvex = false;
            }
            if (!konvex) continue;
            const flaecheWert = Math.abs(
              (ordnet[0].x * ordnet[1].y - ordnet[1].x * ordnet[0].y)
              + (ordnet[1].x * ordnet[2].y - ordnet[2].x * ordnet[1].y)
              + (ordnet[2].x * ordnet[3].y - ordnet[3].x * ordnet[2].y)
              + (ordnet[3].x * ordnet[0].y - ordnet[0].x * ordnet[3].y),
            ) / 2;
            if (flaecheWert < FLAECHE[0] * gesamt || flaecheWert > FLAECHE[1] * gesamt) continue;
            const verh = seitenVerhaeltnis(ordnet);
            if (verh < SEITEN[0] || verh > SEITEN[1]) continue;
            const rand = 0.02 * Math.max(w, h);
            if (ordnet.some((pt) => pt.x < -rand || pt.y < -rand || pt.x > w + rand || pt.y > h + rand)) continue;
            if (istRahmen(ordnet)) continue;
            const staerke = kantenStaerke(ordnet, mag, w, h) * Math.sqrt(flaecheWert / gesamt);
            kandidaten.push({ ecken: ordnet, staerke, flaeche: flaecheWert });
          }
        }
      }
    }
  }
  kandidaten.sort((p, q) => q.staerke - p.staerke);
  return kandidaten;
}

// Betrag des Gradienten je Pixel (Sobel, auf dem angeglichenen Bild)
function gradientBetrag(cv, eq, w, h) {
  const gx = new cv.Mat();
  const gy = new cv.Mat();
  try {
    cv.Sobel(eq, gx, cv.CV_32F, 1, 0, 3);
    cv.Sobel(eq, gy, cv.CV_32F, 0, 1, 3);
    const x = gx.data32F;
    const y = gy.data32F;
    const mag = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) mag[i] = Math.hypot(x[i], y[i]);
    return mag;
  } finally {
    gx.delete();
    gy.delete();
  }
}

// Linien im Bild (Kanten mit geringer Schwelle, HoughLinesP) und daraus die Kartenkandidaten
function linienSuchen(cv, eq, w, h, istRahmen) {
  const kanten = new cv.Mat();
  const lines = new cv.Mat();
  try {
    cv.Canny(eq, kanten, 12, 36);
    const minDim = Math.min(w, h);
    cv.HoughLinesP(kanten, lines, 1, Math.PI / 180, 25, 0.12 * minDim, 0.03 * Math.max(w, h));
    const liste = linienLesen(lines, 0.12 * minDim).filter((l) => !istRahmen([{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }, { x: l.mx, y: l.my }, { x: l.mx, y: l.my }]));
    const mag = gradientBetrag(cv, eq, w, h);
    return linienKandidaten(liste, w, h, istRahmen, 0.2 * minDim, mag);
  } finally {
    kanten.delete();
    lines.delete();
  }
}

// Karte im Foto suchen. Verfahren: verkleinern, Graustufen, weichzeichnen, dann verschiedene Masken
// (Canny mit Median-Schwellen, dilatieren, Konturen; Otsu). Gesucht wird die größte konvexe Kontur mit vier
// Ecken (approxPolyDP) in plausibler Größe und Form. Die erste Maske mit einem solchen Viereck gewinnt.
// Gibt es keines, dient das kleinste umschließende Rechteck der größten plausiblen Kontur als Rückfall.
export async function karteErkennen(quelle) {
  await opencvLaden();
  const cv = globalThis.cv;
  const { bild, sx, sy, pad } = verkleinert(quelle);
  const frei = [];
  const halte = (objekt) => {
    frei.push(objekt);
    return objekt;
  };
  try {
    const w = bild.width;
    const h = bild.height;
    const gesamt = w * h;

    const src = halte(cv.matFromImageData(bild));
    const grau = halte(new cv.Mat());
    cv.cvtColor(src, grau, cv.COLOR_RGBA2GRAY);
    const weich = halte(new cv.Mat());
    cv.GaussianBlur(grau, weich, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    const median = medianWert(weich.data);
    const eq = halte(new cv.Mat());
    cv.equalizeHist(weich, eq);

    const { liste, kern3, kern5 } = masken(cv, weich, eq, median);
    halte(kern3);
    halte(kern5);
    // Der Rand um das Foto (Polsterung und Bildkante) ist kein Kartenkandidat: Vierecke, deren Ecken alle auf
    // dem Bildrand liegen, werden verworfen.
    const amRand = (p) => {
      // Toleranz 4 % der Bildgröße: Kanten liegen durch Weichzeichnen und Dilatieren ein Stück außerhalb des Fotos
      const t = 0.04 * Math.max(w, h);
      return Math.abs(p.x - pad) <= t || Math.abs(p.x - (w - pad - 1)) <= t
        || Math.abs(p.y - pad) <= t || Math.abs(p.y - (h - pad - 1)) <= t;
    };
    // Ecken außerhalb des Bildes (Rechteck um eine schräge Kontur) sind ebenfalls unbrauchbar
    const istRahmen = (ps) => ps.filter(amRand).length >= 4
      || ps.some((p) => p.x < 0 || p.y < 0 || p.x > w - 1 || p.y > h - 1);
    // Zuerst die Linienmethode (Hough): zwei Paare paralleler Kanten der Karte. Gibt sie nichts her,
    // werden die Masken mit Konturen ausgewertet: gewonnen hat das größte Viereck, sonst das größte Rechteck.
    const linien = linienSuchen(cv, eq, w, h, istRahmen);
    let ecken = linien[0]?.ecken ?? null;
    if (!ecken) {
      const alleVierecke = [];
      const alleRechtecke = [];
      for (const erzeuge of liste) {
        const maske = erzeuge();
        try {
          const { vierecke, rechtecke } = kandidatenAus(cv, maske, gesamt, istRahmen);
          alleVierecke.push(...vierecke);
          alleRechtecke.push(...rechtecke);
        } finally {
          maske.delete();
        }
      }
      if (alleVierecke.length) {
        alleVierecke.sort((a, b) => b.flaeche - a.flaeche);
        ecken = alleVierecke[0].ecken;
      } else if (alleRechtecke.length) {
        alleRechtecke.sort((a, b) => b.flaeche - a.flaeche);
        ecken = ordnen(rechteckEcken(alleRechtecke[0].rechteck));
      }
    }
    if (!ecken) return null;
    return ecken.map((p) => ({ x: (p.x - pad) * sx, y: (p.y - pad) * sy }));
  } finally {
    for (const objekt of frei) {
      try {
        objekt.delete();
      } catch {
        // schon freigegeben oder nie angelegt
      }
    }
  }
}
