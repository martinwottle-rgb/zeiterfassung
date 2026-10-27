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

// Bild (z. B. webp, heic) über ein Canvas als JPEG; transparente Bereiche werden weiß
async function alsJpeg(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return canvasAlsBlob(c, 'image/jpeg', JPEG_QUALITAET);
}

// Bildblob in das PDF-Dokument einbetten: JPEG und PNG direkt, alle anderen Typen über JPEG
async function bildEinbetten(doc, blob) {
  if (blob.type === 'image/jpeg') return doc.embedJpg(await blob.arrayBuffer());
  if (blob.type === 'image/png') return doc.embedPng(await blob.arrayBuffer());
  const jpeg = await alsJpeg(blob);
  return doc.embedJpg(await jpeg.arrayBuffer());
}

// Belegbilder und PDF-Dateien in ein PDF; Reihenfolge der belege und ihrer bilder = Reihenfolge der Seiten.
// bildLaden(id) liefert Promise<Blob|null>; fehlende Bilder (null) werden übersprungen.
export async function belegePdf(belege, bildLaden) {
  const { PDFDocument } = await pdfLibLaden();
  const doc = await PDFDocument.create();
  let seiten = 0;

  for (const beleg of belege ?? []) {
    for (const id of beleg.bilder ?? []) {
      const blob = await bildLaden(id);
      if (!blob) continue;

      // PDF-Datei: alle Seiten unverändert übernehmen
      if (blob.type === 'application/pdf') {
        const quelle = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
        const kopien = await doc.copyPages(quelle, quelle.getPageIndices());
        for (const seite of kopien) doc.addPage(seite);
        seiten += kopien.length;
        continue;
      }

      // Bild: auf eine A4-Seite einpassen, Seitenverhältnis erhalten, zentriert, mit Rand
      const bild = await bildEinbetten(doc, blob);
      const quer = bild.width > bild.height;
      const [breite, hoehe] = quer ? A4_QUER : A4_HOCH;
      const skala = Math.min((breite - 2 * RAND) / bild.width, (hoehe - 2 * RAND) / bild.height);
      const w = bild.width * skala;
      const h = bild.height * skala;
      const seite = doc.addPage([breite, hoehe]);
      seite.drawImage(bild, { x: (breite - w) / 2, y: (hoehe - h) / 2, width: w, height: h });
      seiten++;
    }
  }

  if (!seiten) throw new Error('Keine Belegbilder vorhanden.');

  doc.setTitle('Belege');
  doc.setCreator('');
  doc.setProducer('');
  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// Erste Seite einer PDF-Datei als JPEG (weißer Hintergrund); die längere Seite hat `breite` Pixel
export async function pdfErsteSeite(blob, breite = 1600) {
  const pdfjs = await pdfjsLaden();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try {
    const seite = await pdf.getPage(1);
    const basis = seite.getViewport({ scale: 1 });
    const skala = breite / Math.max(basis.width, basis.height);
    const ansicht = seite.getViewport({ scale: skala });
    const c = document.createElement('canvas');
    c.width = Math.ceil(ansicht.width);
    c.height = Math.ceil(ansicht.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await seite.render({ canvasContext: ctx, viewport: ansicht }).promise;
    return await canvasAlsBlob(c, 'image/jpeg', JPEG_QUALITAET);
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
