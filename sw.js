// Offline-Zwischenspeicher der Zeiterfassung.
// Strategie: zuerst das Netz (Änderungen kommen sofort an), bei Fehler der Zwischenspeicher (offline läuft die App).
// /api/ wird nie zwischengespeichert. Bei neuer VERSION werden alte Caches gelöscht.
const VERSION = 'z6';
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
  './vorschlaege.css',
];

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(DATEIEN)).then(() => self.skipWaiting())
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
