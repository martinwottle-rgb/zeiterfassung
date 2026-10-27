// Texterkennung mit Tesseract.js, vollständig lokal aus web/vendor/. Der Worker wird einmal erzeugt und wiederverwendet.
const VENDOR = new URL('../vendor/', import.meta.url);
const TESSERACT_JS = new URL('tesseract/tesseract.min.js', VENDOR).href;
const WORKER_JS = new URL('tesseract/worker.min.js', VENDOR).href;
const KERN_ORDNER = new URL('tesseract/', VENDOR).href;
const SPRACH_ORDNER = new URL('tessdata/', VENDOR).href;

let skriptLadung = null;
let workerLadung = null;
let aktuellerFortschritt = null;

// Tesseract.js genau einmal per <script> laden
function skriptLaden() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (!skriptLadung) {
    skriptLadung = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_JS;
      s.async = true;
      s.onload = () => {
        if (globalThis.Tesseract) {
          resolve(globalThis.Tesseract);
        } else {
          skriptLadung = null;
          reject(new Error('Die Texterkennung ist nicht verfügbar.'));
        }
      };
      s.onerror = () => {
        skriptLadung = null;
        s.remove();
        reject(new Error('Die Texterkennung konnte nicht geladen werden.'));
      };
      document.head.append(s);
    });
  }
  return skriptLadung;
}

async function workerHolen() {
  if (!workerLadung) {
    workerLadung = (async () => {
      const T = await skriptLaden();
      return T.createWorker('deu+eng', 1, {
        workerPath: WORKER_JS,
        corePath: KERN_ORDNER,
        langPath: SPRACH_ORDNER,
        gzip: true,
        // Fortschritt des jeweils laufenden Auftrags (0 bis 1)
        logger: (m) => aktuellerFortschritt?.(m.progress),
      });
    })().catch((err) => {
      workerLadung = null;
      throw err;
    });
  }
  return workerLadung;
}

// Mindestsicherheit (0 bis 100) eines Wortes. Darunter fällt das Wort weg. 40 statt 60, damit auch
// schwächer erkannte Wörter (z. B. „Außendienst“, „www.“-Adressen) bleiben; die Müllbereinigung in kontakte.js
// fängt kurze Fragmente ab.
const OCR_MIN_SICHERHEIT = 40;

// Ausnahme: Ein reines Buchstabenwort mit Umlaut oder ß (mind. 4 Buchstaben) bleibt auch unter der Schwelle.
// Tesseract gibt solche Wörter bei sehr niedriger Sicherheit oft richtig aus (z. B. „Außendienst“ mit 0),
// Logo- und Icon-Reste ohne Umlaut fallen weiterhin weg.
const UMLAUTWORT = (s) => /^\p{L}{4,}$/u.test(s) && /[äöüÄÖÜß]/.test(s);
const wortBleibt = (w) => {
  const t = w.text?.trim();
  return !!t && ((w.confidence ?? 0) >= OCR_MIN_SICHERHEIT || UMLAUTWORT(t));
};

// Tesseract liefert HTML-Entitäten im Text („&amp;“ statt „&“). Sie werden hier zurückgewandelt.
const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function entitaetenDekodieren(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (ganz, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ganz;
    }
    const wert = ENTITAETEN[name.toLowerCase()];
    return wert ?? ganz;
  });
}

// Vorverarbeitung vor Tesseract: Graustufen, Hintergrund schätzen und das Bild durch ihn teilen (Beleuchtung und
// gemusterten Grund ausgleichen), dann Tonwerte auf das 1. bis 99. Perzentil spreizen. Die längere Seite wird auf
// höchstens 2400 px gebracht; kleine Bilder werden dafür höchstens verdoppelt.
const MAX_SEITE = 2400;
const MAX_FAKTOR = 2;
// Liegt die Summe der Wortsicherheiten darunter, probiert die Erkennung zusätzlich eine adaptive Schwelle
const SCHWACH_SUMME = 1200;

function leinwand(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Blob (Bilddatei) in ein Canvas bringen; ein Canvas bleibt unverändert
async function quelleAlsCanvas(q) {
  if (!(q instanceof Blob)) return q;
  const bmp = await createImageBitmap(q);
  const c = leinwand(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

// Quadratischer Mittelwert über ein Fenster mit Radius r (zweimal anwenden ergibt einen weicheren Verlauf)
function boxBlur(a, w, h, r) {
  const t = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let i = -r; i <= r; i++) s += a[o + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      t[o + x] = s / k;
      s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += t[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / k;
      s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Hintergrund durch Division ausgleichen, Ergebnis 0 bis 255 mit gespreizten Tonwerten
function normalisieren(g, w, h) {
  const r = Math.max(2, Math.round(0.03 * w));
  const bg = boxBlur(boxBlur(g, w, h, r), w, h, r);
  const n = new Float32Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n.length; i++) {
    const v = Math.min(255, (g[i] / Math.max(bg[i], 1)) * 200);
    n[i] = v;
    hist[Math.round(v)]++;
  }
  let p1 = 0;
  let p99 = 255;
  let acc = 0;
  let p1Gefunden = false;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (!p1Gefunden && acc >= n.length * 0.01) { p1 = v; p1Gefunden = true; }
    if (acc >= n.length * 0.99) { p99 = v; break; }
  }
  const spanne = Math.max(1, p99 - p1);
  for (let i = 0; i < n.length; i++) n[i] = Math.min(1, Math.max(0, (n[i] - p1) / spanne)) * 255;
  return n;
}

// Adaptive Schwelle: Pixel, die deutlich dunkler sind als ihr Umfeld, werden schwarz, der Rest weiß
function schwelle(n, w, h) {
  const r = Math.max(2, Math.round(0.02 * w));
  const mittel = boxBlur(n, w, h, r);
  const out = new Float32Array(n.length);
  for (let i = 0; i < n.length; i++) out[i] = n[i] < mittel[i] - 12 ? 0 : 255;
  return out;
}

// Liefert das vorbereitete Canvas und den Maßstab (vorbereitet / Original), um Koordinaten zurückzurechnen
async function vorbereiten(quelle, modus) {
  const src = await quelleAlsCanvas(quelle);
  const W = src.width;
  const H = src.height;
  const skala = Math.min(MAX_SEITE / Math.max(W, H), MAX_FAKTOR);
  const w = Math.max(1, Math.round(W * skala));
  const h = Math.max(1, Math.round(H * skala));
  const c = leinwand(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const bild = ctx.getImageData(0, 0, w, h);
  const d = bild.data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) {
    const k = 4 * i;
    g[i] = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
  }
  let aus = normalisieren(g, w, h);
  if (modus === 'adaptiv') aus = schwelle(aus, w, h);
  for (let i = 0; i < aus.length; i++) {
    const k = 4 * i;
    d[k] = d[k + 1] = d[k + 2] = aus[i];
    d[k + 3] = 255;
  }
  ctx.putImageData(bild, 0, 0);
  return { canvas: c, skala };
}

// Erkennt Text aus einem Blob (Bilddatei) oder einem Canvas. Liefert den Text als String.
export async function textErkennen(blobOderCanvas, fortschritt) {
  aktuellerFortschritt = fortschritt ?? null;
  const worker = await workerHolen();
  const { canvas } = await vorbereiten(blobOderCanvas, 'grau');
  const { data } = await worker.recognize(canvas);
  return entitaetenDekodieren((data.text ?? '').trim());
}

// Erkennt Text blockweise: {text, x, y, b, h, sicherheit} je Block. b = Breite, h = Höhe in Pixeln,
// sicherheit = Mittel der Wortsicherheit (0 bis 100). Wörter unter OCR_MIN_SICHERHEIT werden weggelassen, leere Blöcke entfallen.
// Tesseract fasst zweispaltige Karten oft zu einem Absatz zusammen. Daher werden Wortgruppen innerhalb einer
// Zeile an großen Lücken (über max(60 px, 3 Worthöhen)) getrennt; Gruppen mit überschneidenden x-Bereichen
// bilden einen Block (eine Spalte). Zeilen eines Blocks werden mit Zeilenumbruch verbunden.
function alleWoerter(data) {
  return (data.blocks ?? []).flatMap((b) => (b.paragraphs ?? []).flatMap((p) => (p.lines ?? []).flatMap((l) => l.words ?? [])));
}

// Ein Erkennungslauf mit einem Modus; punkte = Summe der Wortsicherheiten der behaltenen Wörter
async function durchlauf(worker, quelle, modus) {
  let canvas;
  let skala = 1;
  if (modus === 'original') {
    canvas = await quelleAlsCanvas(quelle);
  } else {
    ({ canvas, skala } = await vorbereiten(quelle, modus));
  }
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const punkte = alleWoerter(data).filter(wortBleibt).reduce((s, w) => s + (w.confidence ?? 0), 0);
  return { liste: blockeAusDaten(data, skala), punkte };
}

// Mehrere Durchläufe (vorbereitet grau, unverändert), das Ergebnis mit der größeren Wortsicherheit gewinnt.
// Liegt die Summe darunter, kommt die adaptive Schwelle dazu.
export async function textBloecke(blobOderCanvas, fortschritt) {
  aktuellerFortschritt = fortschritt ?? null;
  const worker = await workerHolen();
  const laeufe = [];
  for (const m of ['grau', 'original']) laeufe.push(await durchlauf(worker, blobOderCanvas, m));
  let besten = laeufe.reduce((a, e) => (e.punkte > a.punkte ? e : a));
  if (besten.punkte < SCHWACH_SUMME) {
    const zweit = await durchlauf(worker, blobOderCanvas, 'adaptiv');
    laeufe.push(zweit);
    if (zweit.punkte > besten.punkte) besten = zweit;
  }
  // Text der anderen Läufe: hilft beim Lesen, wenn ein Wort dort richtig steht („Großekathöfer“ statt „GroBekathofer“)
  besten.liste.nebentext = laeufe.filter((e) => e !== besten).map((e) => e.liste.map((b) => b.text).join('\n\n')).join('\n\n');
  return besten.liste;
}

// Aus der Tesseract-Ausgabe die Blöcke bilden; Koordinaten zurück auf das Originalmaß (÷ skala)
function blockeAusDaten(data, skala) {
  const liste = [];
  for (const block of data.blocks ?? []) {
    for (const absatz of block.paragraphs ?? []) {
      // Segmente: zusammenhängende Wortgruppen je Zeile
      const segmente = [];
      for (const zeile of absatz.lines ?? []) {
        const sicher = (zeile.words ?? []).filter(wortBleibt);
        if (!sicher.length) continue;
        const hoehen = sicher.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
        const schwelle = Math.max(60, 3 * hoehen[Math.floor(hoehen.length / 2)]);
        let aktuell = [sicher[0]];
        for (let i = 1; i < sicher.length; i++) {
          if (sicher[i].bbox.x0 - sicher[i - 1].bbox.x1 > schwelle) {
            segmente.push(aktuell);
            aktuell = [];
          }
          aktuell.push(sicher[i]);
        }
        segmente.push(aktuell);
      }
      if (!segmente.length) continue;

      // Segmente mit überschneidenden x-Bereichen zu einem Block zusammenfassen
      const teile = segmente.map((ws) => ({
        ws,
        x0: Math.min(...ws.map((w) => w.bbox.x0)),
        y0: Math.min(...ws.map((w) => w.bbox.y0)),
        x1: Math.max(...ws.map((w) => w.bbox.x1)),
        y1: Math.max(...ws.map((w) => w.bbox.y1)),
      }));
      const eltern = teile.map((_, i) => i);
      const finde = (i) => {
        while (eltern[i] !== i) {
          eltern[i] = eltern[eltern[i]];
          i = eltern[i];
        }
        return i;
      };
      for (let i = 0; i < teile.length; i++) {
        for (let j = i + 1; j < teile.length; j++) {
          const a = teile[i];
          const b = teile[j];
          if (a.x0 < b.x1 && b.x0 < a.x1) eltern[finde(i)] = finde(j);
        }
      }
      const gruppen = new Map();
      teile.forEach((t, i) => {
        const wurzel = finde(i);
        if (!gruppen.has(wurzel)) gruppen.set(wurzel, []);
        gruppen.get(wurzel).push(t);
      });

      for (const g of gruppen.values()) {
        g.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
        const zeilen = g.map((t) => t.ws.map((w) => entitaetenDekodieren(w.text.trim())).join(' '));
        const woerter = g.flatMap((t) => t.ws);
        const x0 = Math.min(...g.map((t) => t.x0));
        const y0 = Math.min(...g.map((t) => t.y0));
        const x1 = Math.max(...g.map((t) => t.x1));
        const y1 = Math.max(...g.map((t) => t.y1));
        const summe = woerter.reduce((s, w) => s + w.confidence, 0);
        liste.push({
          text: zeilen.join('\n'),
          x: Math.round(x0 / skala),
          y: Math.round(y0 / skala),
          b: Math.round((x1 - x0) / skala),
          h: Math.round((y1 - y0) / skala),
          sicherheit: Math.round(summe / woerter.length),
        });
      }
    }
  }
  liste.sort((a, b) => a.x - b.x || a.y - b.y);
  return liste;
}

// Worker beenden und Speicher freigeben
export async function ocrBeenden() {
  const ladung = workerLadung;
  workerLadung = null;
  if (!ladung) return;
  try {
    const worker = await ladung;
    await worker.terminate();
  } catch {
    // Worker war nicht mehr erreichbar: nichts zu beenden
  }
}
