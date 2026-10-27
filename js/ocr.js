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

// Erkennt Text aus einem Blob (Bilddatei) oder einem Canvas. Liefert den Text als String.
export async function textErkennen(blobOderCanvas, fortschritt) {
  aktuellerFortschritt = fortschritt ?? null;
  const worker = await workerHolen();
  const { data } = await worker.recognize(blobOderCanvas);
  return (data.text ?? '').trim();
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
