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

// Erkennt Text aus einem Blob (Bilddatei) oder einem Canvas. Liefert den Text als String.
export async function textErkennen(blobOderCanvas, fortschritt) {
  aktuellerFortschritt = fortschritt ?? null;
  const worker = await workerHolen();
  const { data } = await worker.recognize(blobOderCanvas);
  return entitaetenDekodieren((data.text ?? '').trim());
}

// Erkennt Text blockweise: {text, x, y, b, h, sicherheit} je Block. b = Breite, h = Höhe in Pixeln,
// sicherheit = Mittel der Wortsicherheit (0 bis 100). Wörter unter OCR_MIN_SICHERHEIT werden weggelassen, leere Blöcke entfallen.
// Tesseract fasst zweispaltige Karten oft zu einem Absatz zusammen. Daher werden Wortgruppen innerhalb einer
// Zeile an großen Lücken (über max(60 px, 3 Worthöhen)) getrennt; Gruppen mit überschneidenden x-Bereichen
// bilden einen Block (eine Spalte). Zeilen eines Blocks werden mit Zeilenumbruch verbunden.
export async function textBloecke(blobOderCanvas, fortschritt) {
  aktuellerFortschritt = fortschritt ?? null;
  const worker = await workerHolen();
  const { data } = await worker.recognize(blobOderCanvas, {}, { blocks: true });
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
          x: x0,
          y: y0,
          b: x1 - x0,
          h: y1 - y0,
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
