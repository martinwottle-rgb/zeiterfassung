// Visitenkarte im Foto finden: OpenCV.js (lokal aus web/vendor/opencv/) sucht die Karte nach der Methode von
// tools/karte_finden_versuch.py (Funktion karte_finden, Lab-Farbkanten, Konturen, minAreaRect, Bewertung).
// karteErkennen(quelle) liefert {ecken, wert} oder null. Die Ecken stehen in Originalkoordinaten, oben links
// zuerst, dann im Uhrzeigersinn. karteErkennenEcken(quelle) liefert nur das Ecken-Array oder null.
// Alle cv.Mat-Objekte werden danach wieder freigegeben.
const OPENCV_JS = new URL('../vendor/opencv/opencv.js', import.meta.url).href;
const SUCH_SEITE = 640; // lange Seite des Bildes, auf dem gesucht wird (wie in der Python-Vorlage)
const SCHWELLEN = [0.2, 0.3, 0.45]; // Kantenschwellen auf dem normierten Kantenbild
const FLAECHE_MIN = 0.05; // Anteil der Konvexhülle an der Suchfläche
const FLAECHE_MAX = 0.9;
const SEITEN = [1.3, 2.0]; // Seitenverhältnis einer Visitenkarte (lang zu kurz)
const MINDESTWERT = 0.3; // darunter gilt: keine Karte gefunden
const WARTEZEIT = 60000; // ms, bis OpenCV nach dem Laden bereit sein muss

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

// Das ganze Bild in Originalgröße als RGBA-Pixel (ImageData)
function volleDaten(quelle) {
  const W = quelle.width;
  const H = quelle.height;
  if (!W || !H) throw new Error('Das Bild ist leer.');
  if (typeof ImageData !== 'undefined' && quelle instanceof ImageData) return quelle;
  const c = flaeche(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(quelle, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}

// np.percentile(werte, p) mit linearer Interpolation (Standard von numpy)
function perzentil(werte, p) {
  const s = Float32Array.from(werte).sort();
  const pos = (s.length - 1) * (p / 100);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (pos - lo) * (s[hi] - s[lo]);
}

// Kantenbild wie kantenbild(lab, w, h) in Python: je Lab-Kanal der Sobel-Betrag, durch das 99. Perzentil geteilt,
// dann das Maximum über die Kanäle. Gewichte: b (Index 2) 1,0, a (Index 1) 1,0, L (Index 0) 0,5.
function kantenbild(cv, lab, w, h) {
  const gr = new Float32Array(w * h);
  const kanaele = new cv.MatVector();
  const gx = new cv.Mat();
  const gy = new cv.Mat();
  const betrag = new cv.Mat();
  try {
    cv.split(lab, kanaele);
    for (const [kanal, gewicht] of [[2, 1.0], [1, 1.0], [0, 0.5]]) {
      const c = kanaele.get(kanal);
      try {
        cv.Sobel(c, gx, cv.CV_32F, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
        cv.Sobel(c, gy, cv.CV_32F, 0, 1, 3, 1, 0, cv.BORDER_DEFAULT);
      } finally {
        c.delete();
      }
      cv.magnitude(gx, gy, betrag);
      const m = betrag.data32F;
      const p99 = perzentil(m, 99) + 1e-6;
      for (let i = 0; i < w * h; i++) {
        const v = Math.fround(m[i] / p99) * gewicht;
        if (v > gr[i]) gr[i] = v;
      }
    }
  } finally {
    kanaele.delete();
    gx.delete();
    gy.delete();
    betrag.delete();
  }
  return gr;
}

// Rundung wie Python round() (Banker's Rounding, Hälfte zur geraden Zahl)
function pyRunden(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// Anteil der Punkte auf dem Rechteckumfang, an denen (aufgeweitet) eine Kante liegt (umfang_abdeckung)
function umfangAbdeckung(box, kantenD, w, h) {
  const n = 240;
  const je = n / 4;
  let treffer = 0;
  for (let i = 0; i < 4; i++) {
    const a = box[i];
    const b = box[(i + 1) % 4];
    for (let k = 0; k < je; k++) {
      const t = k * (1 / je);
      const xi = pyRunden(a.x + (b.x - a.x) * t);
      const yi = pyRunden(a.y + (b.y - a.y) * t);
      if (xi >= 0 && xi < w && yi >= 0 && yi < h && kantenD[yi * w + xi]) treffer++;
    }
  }
  return treffer / n;
}

// Ecken im Uhrzeigersinn, oben links zuerst (Bildkoordinaten, y nach unten). Die Sortierung nach dem Winkel um
// die Mitte ergibt die Reihenfolge; der Startpunkt ist die Ecke, die am nächsten bei oben links (-135 Grad) liegt.
function uhrzeigerOben(punkte) {
  const cx = (punkte[0].x + punkte[1].x + punkte[2].x + punkte[3].x) / 4;
  const cy = (punkte[0].y + punkte[1].y + punkte[2].y + punkte[3].y) / 4;
  const winkel = punkte.map((p) => Math.atan2(p.y - cy, p.x - cx));
  const reihe = [0, 1, 2, 3].sort((i, j) => winkel[i] - winkel[j]);
  const ziel = (-3 * Math.PI) / 4;
  const abstand = (i) => {
    const d = ((winkel[i] - ziel + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return Math.abs(d);
  };
  let start = 0;
  for (let k = 1; k < 4; k++) {
    if (abstand(reihe[k]) < abstand(reihe[start])) start = k;
  }
  return [0, 1, 2, 3].map((j) => {
    const p = punkte[reihe[(start + j) % 4]];
    return { x: p.x, y: p.y };
  });
}

// Karte im Foto suchen (Ablauf wie karte_finden in tools/karte_finden_versuch.py). Liefert {ecken, wert} oder null.
// ecken: vier Punkte {x, y} in Originalkoordinaten, oben links zuerst, im Uhrzeigersinn. wert: Bewertung (Sicherheit).
export async function karteErkennen(quelle) {
  await opencvLaden();
  const cv = globalThis.cv;
  const frei = [];
  const halte = (objekt) => {
    frei.push(objekt);
    return objekt;
  };
  try {
    const voll = volleDaten(quelle);
    const H = voll.height;
    const W = voll.width;
    const f = SUCH_SEITE / Math.max(H, W);
    const w = Math.floor(W * f);
    const h = Math.floor(H * f);

    // Python liest BGR, der Browser liefert RGBA: hier RGBA -> RGB -> verkleinern -> weichzeichnen -> Lab (L, a, b)
    const rgba = halte(cv.matFromImageData(voll));
    const rgb = halte(new cv.Mat());
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    const klein = halte(new cv.Mat());
    cv.resize(rgb, klein, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    const weich = halte(new cv.Mat());
    cv.GaussianBlur(klein, weich, new cv.Size(0, 0), 1.5, 1.5, cv.BORDER_DEFAULT);
    const lab = halte(new cv.Mat());
    cv.cvtColor(weich, lab, cv.COLOR_RGB2Lab);

    const gr = kantenbild(cv, lab, w, h);
    const kern5 = halte(cv.Mat.ones(5, 5, cv.CV_8U));
    const kern7 = halte(cv.Mat.ones(7, 7, cv.CV_8U));
    const punkt = new cv.Point(-1, -1);
    const rand = cv.morphologyDefaultBorderValue();

    let beste = { wert: 0, box: null };
    for (const schwelle of SCHWELLEN) {
      const s32 = Math.fround(schwelle);
      const kanten = halte(new cv.Mat(h, w, cv.CV_8UC1));
      const kd = kanten.data;
      for (let i = 0; i < w * h; i++) kd[i] = gr[i] > s32 ? 255 : 0;

      const kantenD = halte(new cv.Mat());
      cv.dilate(kanten, kantenD, kern5, punkt, 1, cv.BORDER_CONSTANT, rand);
      const geschlossen = halte(new cv.Mat());
      cv.morphologyEx(kanten, geschlossen, cv.MORPH_CLOSE, kern7, punkt, 1, cv.BORDER_CONSTANT, rand);

      const konturen = halte(new cv.MatVector());
      const hierarchie = halte(new cv.Mat());
      cv.findContours(geschlossen, konturen, hierarchie, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < konturen.size(); i++) {
        const cnt = konturen.get(i);
        const hull = new cv.Mat();
        try {
          cv.convexHull(cnt, hull, false, true);
          const ha = cv.contourArea(hull);
          if (ha < FLAECHE_MIN * w * h || ha > FLAECHE_MAX * w * h) continue;
          const rect = cv.minAreaRect(hull);
          const rw = rect.size.width;
          const rh = rect.size.height;
          const verh = Math.max(rw, rh) / Math.max(Math.min(rw, rh), 1);
          if (verh < SEITEN[0] || verh > SEITEN[1]) continue;
          const box = cv.RotatedRect.points(rect).map((p) => ({ x: p.x, y: p.y }));
          const abdeckung = umfangAbdeckung(box, kantenD.data, w, h);
          const fuellt = ha / (rw * rh);
          const wert = abdeckung ** 2 * fuellt * ((rw * rh) / (w * h)) ** 0.25;
          if (wert > beste.wert) beste = { wert, box };
        } finally {
          cnt.delete();
          hull.delete();
        }
      }
    }

    // nur überzeugende Funde; sonst null
    if (!beste.box || beste.wert < MINDESTWERT) return null;
    const punkte = beste.box.map((p) => ({ x: p.x / f, y: p.y / f }));
    return { ecken: uhrzeigerOben(punkte), wert: beste.wert };
  } finally {
    for (const objekt of frei) {
      try {
        objekt.delete();
      } catch {
        // schon freigegeben
      }
    }
  }
}

// Wie karteErkennen, aber nur die Ecken (Array mit vier Punkten) oder null
export async function karteErkennenEcken(quelle) {
  const erg = await karteErkennen(quelle);
  return erg ? erg.ecken : null;
}
