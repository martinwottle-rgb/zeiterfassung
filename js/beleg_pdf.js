// PDF aus Belegbildern zusammensetzen, erste Seite als JPEG für Texterkennung und Vorschau. Vollständig lokal aus web/vendor/pdf/.
const VENDOR = new URL('../vendor/pdf/', import.meta.url);
const PDF_LIB_JS = new URL('pdf-lib.min.js', VENDOR).href;
const PDFJS_JS = new URL('pdf.min.js', VENDOR).href;
const PDFJS_WORKER_JS = new URL('pdf.worker.min.js', VENDOR).href;

// A4 in Punkt (1 pt = 1/72 Zoll), hochkant und quer
const A4_HOCH = [595.28, 841.89];
const A4_QUER = [841.89, 595.28];
const RAND = 24;
const JPEG_QUALITAET = 0.9;

let pdfLibLadung = null;
let pdfjsLadung = null;

// Skript genau einmal per <script> laden; liefert das globale Objekt, das das Skript setzt
function skriptLaden(url, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => {
      if (globalThis[globalName]) resolve(globalThis[globalName]);
      else reject(new Error('Die PDF-Bibliothek ist nicht verfügbar.'));
    };
    s.onerror = () => {
      s.remove();
      reject(new Error('Die PDF-Bibliothek konnte nicht geladen werden.'));
    };
    document.head.append(s);
  });
}

// pdf-lib (window.PDFLib), bei Fehler beim nächsten Aufruf erneut versuchen
function pdfLibLaden() {
  if (!pdfLibLadung) {
    pdfLibLadung = skriptLaden(PDF_LIB_JS, 'PDFLib').catch((err) => {
      pdfLibLadung = null;
      throw err;
    });
  }
  return pdfLibLadung;
}

// pdf.js (window.pdfjsLib) mit lokalem Worker
function pdfjsLaden() {
  if (!pdfjsLadung) {
    pdfjsLadung = skriptLaden(PDFJS_JS, 'pdfjsLib')
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_JS;
        return lib;
      })
      .catch((err) => {
        pdfjsLadung = null;
        throw err;
      });
  }
  return pdfjsLadung;
}

// Canvas als Blob, im Erfolgsfall mit dem gewünschten Typ
function canvasAlsBlob(c, typ, qualitaet) {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Das Bild konnte nicht umgewandelt werden.'))),
      typ,
      qualitaet,
    );
  });
}

// Verkleinerung für die Ausgabe: längere Bildseite in Pixel und JPEG-Qualität. 1600 px auf A4 sind gut 190 dpi,
// Kassenbons bleiben lesbar. Wird das PDF größer als ZIEL_BYTES, folgt ein zweiter Lauf mit der kleineren Stufe.
const STUFEN = [{ pixel: 1600, qualitaet: 0.7 }, { pixel: 1200, qualitaet: 0.6 }];
const ZIEL_BYTES = 4 * 1024 * 1024;
// Kleine PDF-Dateien (meist Rechnungen mit echtem Text) bleiben unverändert, größere werden Seite für Seite als Bild verkleinert
const PDF_UNVERAENDERT_BIS = 300 * 1024;

// Canvas mit weißem Hintergrund (transparente Bereiche werden weiß)
function weissesCanvas(breite, hoehe) {
  const c = document.createElement('canvas');
  c.width = breite;
  c.height = hoehe;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, breite, hoehe);
  return { c, ctx };
}

// Bild (jeder Typ, den der Browser lesen kann) verkleinert als JPEG; kleine Bilder werden nicht vergrößert
async function verkleinertesJpeg(blob, stufe) {
  const bmp = await createImageBitmap(blob);
  const faktor = Math.min(1, stufe.pixel / Math.max(bmp.width, bmp.height));
  const { c, ctx } = weissesCanvas(Math.round(bmp.width * faktor), Math.round(bmp.height * faktor));
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return canvasAlsBlob(c, 'image/jpeg', stufe.qualitaet);
}

// Dateityp aus den ersten Bytes, weil der gespeicherte Typ fehlen oder falsch sein kann (z. B. nach dem Abgleich)
async function echterTyp(blob) {
  const b = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return blob.type || '';
}

// JPEG auf eine A4-Seite einpassen: Seitenverhältnis erhalten, zentriert, mit Rand
async function jpegSeite(doc, jpeg) {
  const bild = await doc.embedJpg(await jpeg.arrayBuffer());
  const quer = bild.width > bild.height;
  const [breite, hoehe] = quer ? A4_QUER : A4_HOCH;
  const skala = Math.min((breite - 2 * RAND) / bild.width, (hoehe - 2 * RAND) / bild.height);
  const w = bild.width * skala;
  const h = bild.height * skala;
  const seite = doc.addPage([breite, hoehe]);
  seite.drawImage(bild, { x: (breite - w) / 2, y: (hoehe - h) / 2, width: w, height: h });
}

// Belegbilder und PDF-Dateien in ein PDF; Reihenfolge der belege und ihrer bilder = Reihenfolge der Seiten.
// bildLaden(id) liefert Promise<Blob|null>; fehlende Bilder (null) werden übersprungen.
// Alle Bilder werden verkleinert (siehe STUFEN), damit die Datei klein bleibt.
// Ein einzelnes kaputtes Bild bricht das PDF nicht ab. Belege ohne einzige Seite (kein, fehlendes oder kaputtes Bild)
// stehen danach in blob.ausgelassen.
export async function belegePdf(belege, bildLaden) {
  const blobs = new Map();
  const laden = async (id) => {
    if (!blobs.has(id)) blobs.set(id, await bildLaden(id));
    return blobs.get(id);
  };
  let ergebnis = null;
  for (const stufe of STUFEN) {
    ergebnis = await pdfBauen(belege, laden, stufe);
    if (ergebnis.size <= ZIEL_BYTES) break;
  }
  return ergebnis;
}

async function pdfBauen(belege, bildLaden, stufe) {
  const { PDFDocument } = await pdfLibLaden();
  const doc = await PDFDocument.create();
  let seiten = 0;
  const ausgelassen = [];

  for (const beleg of belege ?? []) {
    let eigene = 0;
    for (const id of beleg.bilder ?? []) {
      try {
        eigene += await seiteAnhaengen(doc, PDFDocument, await bildLaden(id), stufe);
      } catch (err) {
        console.error('Belegbild übersprungen', id, err);
      }
    }
    if (!eigene) ausgelassen.push(beleg);
    seiten += eigene;
  }

  if (!seiten) throw new Error('Keine Belegbilder vorhanden.');

  doc.setTitle('Belege');
  doc.setCreator('');
  doc.setProducer('');
  const bytes = await doc.save();
  const ergebnis = new Blob([bytes], { type: 'application/pdf' });
  ergebnis.ausgelassen = ausgelassen;
  return ergebnis;
}

// Ein Bild oder eine PDF-Datei als Seite(n) anhängen; gibt die Zahl der neuen Seiten zurück
async function seiteAnhaengen(doc, PDFDocument, blob, stufe) {
  if (!blob) return 0;
  if ((await echterTyp(blob)) !== 'application/pdf') {
    await jpegSeite(doc, await verkleinertesJpeg(blob, stufe));
    return 1;
  }
  // Kleine PDF-Datei: alle Seiten unverändert übernehmen
  if (blob.size <= PDF_UNVERAENDERT_BIS) {
    const quelle = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
    const kopien = await doc.copyPages(quelle, quelle.getPageIndices());
    for (const seite of kopien) doc.addPage(seite);
    return kopien.length;
  }
  // Große PDF-Datei (z. B. gescannte Hotelrechnung): jede Seite als verkleinertes Bild
  const jpegs = await pdfSeitenAlsJpeg(blob, stufe.pixel, stufe.qualitaet);
  for (const jpeg of jpegs) await jpegSeite(doc, jpeg);
  return jpegs.length;
}

// Eine Seite einer geöffneten pdf.js-Datei als JPEG; die längere Seite hat `breite` Pixel
async function seiteAlsJpeg(pdf, nr, breite, qualitaet) {
  const seite = await pdf.getPage(nr);
  const basis = seite.getViewport({ scale: 1 });
  const ansicht = seite.getViewport({ scale: breite / Math.max(basis.width, basis.height) });
  const { c, ctx } = weissesCanvas(Math.ceil(ansicht.width), Math.ceil(ansicht.height));
  await seite.render({ canvasContext: ctx, viewport: ansicht }).promise;
  return canvasAlsBlob(c, 'image/jpeg', qualitaet);
}

// Alle Seiten einer PDF-Datei als JPEG
async function pdfSeitenAlsJpeg(blob, breite, qualitaet) {
  const pdfjs = await pdfjsLaden();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try {
    const liste = [];
    for (let nr = 1; nr <= pdf.numPages; nr++) liste.push(await seiteAlsJpeg(pdf, nr, breite, qualitaet));
    return liste;
  } finally {
    await pdf.destroy();
  }
}

// Erste Seite einer PDF-Datei als JPEG (weißer Hintergrund); die längere Seite hat `breite` Pixel
export async function pdfErsteSeite(blob, breite = 1600) {
  const pdfjs = await pdfjsLaden();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try {
    return await seiteAlsJpeg(pdf, 1, breite, JPEG_QUALITAET);
  } finally {
    await pdf.destroy();
  }
}

// Anzahl der Seiten einer PDF-Datei
export async function pdfSeitenzahl(blob) {
  const { PDFDocument } = await pdfLibLaden();
  const doc = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
  return doc.getPageCount();
}
