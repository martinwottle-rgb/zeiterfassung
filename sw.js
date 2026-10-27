// Offline-Zwischenspeicher der Zeiterfassung.
// Strategie: zuerst das Netz (Ã„nderungen kommen sofort an), bei Fehler der Zwischenspeicher (offline lÃ¤uft die App).
// /api/ wird nie zwischengespeichert. Bei neuer VERSION werden alte Caches gelÃ¶scht.
const VERSION = 'z13';
const CACHE = 'zeiterfassung-' + VERSION;
const DATEIEN = [
  './',
  './index.html',
  './stil.css',
  './manifest.webmanifest',
  './symbol-192.png',
  './symbol-512.png',
  './apple-touch-icon.png',
  './js/app.js',
  './js/stempeln.js',
  './js/tag_sheet.js',
  './js/zeit.js',
  './js/feiertage.js',
  './js/rechnen.js',
  './js/speicher.js',
  './js/ansicht_heute.js',
  './js/ansicht_woche.js',
  './js/ansicht_monat.js',
  './js/ansicht_abwesenheiten.js',
  './js/ansicht_einstellungen.js',
  './js/krypto.js',
  './js/abgleich.js',
  './js/reisen.js',
  './js/laender.js',
  './js/reise_sheet.js',
  './js/vorschlaege.js',
  './js/ansicht_reisen.js',
  './js/reisekosten_knopf.js',
  './js/zeit_segment.js',
  './js/kontakte.js',
  './js/zuschnitt.js',
  './js/ocr.js',
  './js/ansicht_kontakte.js',
  './js/kontakt_sheet.js',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-lstm.wasm.js',
  './vendor/tessdata/deu.traineddata.gz',
  './vendor/tessdata/eng.traineddata.gz',
  './vendor/pdf/pdf-lib.min.js',
  './vendor/pdf/pdf.min.js',
  './vendor/pdf/pdf.worker.min.js',
  './vorschlaege.css',
];

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil(
    // Einzeln laden: fehlt eine Datei, scheitert nicht die ganze Installation
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(DATEIEN.map((d) => cache.add(d))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n.startsWith('zeiterfassung-') && n !== CACHE)
        .map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== 'GET') return;
  const adresse = new URL(anfrage.url);
  if (adresse.origin !== self.location.origin) return;
  if (adresse.pathname.includes('/api/')) return;          // Daten nie aus dem Zwischenspeicher

  ereignis.respondWith(
    fetch(anfrage)
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((cache) => cache.put(anfrage, kopie));
        }
        return antwort;
      })
      .catch(() => caches.match(anfrage).then((gespeichert) => {
        if (gespeichert) return gespeichert;
        if (anfrage.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
