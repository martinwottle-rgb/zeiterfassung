// IndexedDB-Speicher für Blöcke, Abwesenheiten, Reisen, Kontakte, Belege, Bilder und Einstellungen.
// Keine Abhängigkeiten. Jede schreibende Funktion meldet 'daten-geaendert'.

import { b64AusBytes, bytesAusB64 } from './krypto.js';

const DB_NAME = 'zeiterfassung';
const DB_VERSION = 4;
const ARTEN = ['bloecke', 'abwesenheiten', 'reisen', 'kontakte', 'belege', 'ablage'];
const EINSTELLUNGEN_SCHLUESSEL = 'einstellungen';

// Eine Verbindung pro Seite, als Promise zwischengespeichert.
let verbindung = null;

function db() {
  if (!verbindung) {
    verbindung = new Promise((res, rej) => {
      const oeffnen = indexedDB.open(DB_NAME, DB_VERSION);
      oeffnen.onupgradeneeded = () => {
        const d = oeffnen.result;
        // Nur fehlende Speicher anlegen, vorhandene (Version 1 und 2) bleiben unberührt.
        if (!d.objectStoreNames.contains('bloecke')) d.createObjectStore('bloecke', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('abwesenheiten')) d.createObjectStore('abwesenheiten', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('einstellungen')) d.createObjectStore('einstellungen'); // ohne keyPath, Schlüssel wird angegeben
        if (!d.objectStoreNames.contains('reisen')) d.createObjectStore('reisen', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kontakte')) d.createObjectStore('kontakte', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('belege')) d.createObjectStore('belege', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('bilder')) d.createObjectStore('bilder', { keyPath: 'id' });
        // Ablage (Version 4): Dateien zwischen Handy und Laptop, die Dateien selbst liegen in 'bilder'
        if (!d.objectStoreNames.contains('ablage')) d.createObjectStore('ablage', { keyPath: 'id' });
      };
      oeffnen.onsuccess = () => {
        const d = oeffnen.result;
        // Bei Versionswechsel (anderer Tab) Verbindung schließen, beim nächsten Zugriff neu öffnen
        d.onversionchange = () => { d.close(); verbindung = null; };
        res(d);
      };
      oeffnen.onerror = () => { verbindung = null; rej(oeffnen.error); };
    });
  }
  return verbindung;
}

// Wartet auf eine IndexedDB-Anfrage und gibt ihr Ergebnis zurück.
function warte(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

// Wartet, bis eine Transaktion vollständig abgeschlossen ist.
function abschluss(t) {
  return new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transaktion abgebrochen'));
  });
}

async function transaktion(speicher, modus) {
  const d = await db();
  return d.transaction(speicher, modus);
}

function melden() {
  window.dispatchEvent(new Event('daten-geaendert'));
}

function pruefeArt(art) {
  if (!ARTEN.includes(art)) throw new Error('Unbekannte Art: ' + art);
}

// Neuer Änderungszeitpunkt: jetzt, aber immer größer als der alte Wert desselben Eintrags.
function neuerStempel(alt) {
  const jetzt = Date.now();
  return alt && typeof alt.geaendert === 'number' && alt.geaendert >= jetzt ? alt.geaendert + 1 : jetzt;
}

// Heute in Ortszeit als JJJJ-MM-TT (nicht toISOString, das wäre UTC).
function heuteText() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function vorgaben() {
  return {
    sollMinuten: [480, 480, 480, 480, 480, 0, 0],
    urlaubstage: 30,
    start: heuteText(),
    startSaldo: 0,
    darstellung: 'system',
    urlaubStartRest: null,
    urlaubUebertrag: {},
    pauseAuto: false,
    erinnerung: false,
    arbeitsort: '',
    kartenEnde: '', // Endziffern der Firmenkreditkarte (Belege: Karte oder privat)
  };
}

// Alle Einträge einer Art, auch Grabsteine (geloescht: true).
export async function alle(art) {
  pruefeArt(art);
  const t = await transaktion([art], 'readonly');
  return warte(t.objectStore(art).getAll());
}

// Speichert einen Eintrag. Fehlt die id, wird eine vergeben. Gibt eine Kopie zurück.
export async function speichern(art, obj) {
  pruefeArt(art);
  const t = await transaktion([art], 'readwrite');
  const speicher = t.objectStore(art);
  const kopie = { ...obj };
  if (!kopie.id) kopie.id = crypto.randomUUID();
  const alt = await warte(speicher.get(kopie.id));
  kopie.geaendert = neuerStempel(alt);
  speicher.put(kopie);
  await abschluss(t);
  melden();
  return { ...kopie };
}

// Löscht nie wirklich, sondern setzt den Grabstein (geloescht: true).
export async function loeschen(art, id) {
  pruefeArt(art);
  const t = await transaktion([art], 'readwrite');
  const speicher = t.objectStore(art);
  const alt = await warte(speicher.get(id));
  if (!alt) return null; // nichts zu tun, Transaktion endet von selbst
  const grab = { ...alt, geloescht: true, geaendert: neuerStempel(alt) };
  speicher.put(grab);
  await abschluss(t);
  melden();
  return { ...grab };
}

// Lädt die Einstellungen. Fehlende Werte kommen aus den Vorgaben.
// Beim allerersten Laden werden die Vorgaben gespeichert, damit 'start' fest bleibt.
export async function einstellungenLaden() {
  const t = await transaktion(['einstellungen'], 'readwrite');
  const speicher = t.objectStore('einstellungen');
  const gespeichert = await warte(speicher.get(EINSTELLUNGEN_SCHLUESSEL));
  if (gespeichert !== undefined) return { ...vorgaben(), ...gespeichert };
  const erste = { ...vorgaben(), geaendert: Date.now() };
  speicher.put(erste, EINSTELLUNGEN_SCHLUESSEL);
  await abschluss(t);
  melden();
  return { ...erste };
}

export async function einstellungenSpeichern(e) {
  const t = await transaktion(['einstellungen'], 'readwrite');
  const speicher = t.objectStore('einstellungen');
  const alt = await warte(speicher.get(EINSTELLUNGEN_SCHLUESSEL));
  const neu = { ...e, geaendert: neuerStempel(alt) };
  speicher.put(neu, EINSTELLUNGEN_SCHLUESSEL);
  await abschluss(t);
  melden();
  return { ...neu };
}

// Bilder (Visitenkarten, Notizen, Belege): Base64 im Eintrag, nie im Export.
// Eintrag: {id, typ, daten (Base64), hochgeladen, geaendert}.

// Fotos werden vor dem Speichern verkleinert: längere Seite höchstens BILD_PIXEL, JPEG. Spart Platz auf dem iPhone
// und hält die Dateien unter 1 MB für den Abgleich. PDFs und schon kleine Bilder bleiben unverändert.
const BILD_STUFEN = [{ pixel: 2000, qualitaet: 0.82 }, { pixel: 1600, qualitaet: 0.75 }];
const BILD_KLEIN_GENUG = 600 * 1024;
const BILD_ZIEL = 900 * 1024;

export async function bildVerkleinern(blob) {
  if (!blob?.type?.startsWith('image/') || typeof createImageBitmap !== 'function') return blob;
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return blob; // Format kann der Browser nicht lesen: Original behalten
  }
  try {
    const lang = Math.max(bmp.width, bmp.height);
    if (blob.size <= BILD_KLEIN_GENUG && lang <= BILD_STUFEN[0].pixel) return blob;
    let ergebnis = blob;
    for (const stufe of BILD_STUFEN) {
      const f = Math.min(1, stufe.pixel / lang);
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * f);
      c.height = Math.round(bmp.height * f);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const neu = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', stufe.qualitaet));
      if (neu && neu.size < ergebnis.size) ergebnis = neu;
      if (ergebnis.size <= BILD_ZIEL) break;
    }
    return ergebnis;
  } finally {
    bmp.close();
  }
}

// Speichert ein Bild (vorher verkleinert, siehe bildVerkleinern) und gibt seine id zurück. Startet den Abgleich (daten-geaendert).
// Mit { original: true } bleibt das Bild unverändert (Ablage: „Original behalten“).
export async function bildSpeichern(original, { original: unveraendert = false } = {}) {
  const blob = unveraendert ? original : await bildVerkleinern(original);
  const id = crypto.randomUUID();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const t = await transaktion(['bilder'], 'readwrite');
  t.objectStore('bilder').put({
    id, typ: blob.type || 'application/octet-stream', daten: b64AusBytes(bytes), hochgeladen: false, geaendert: Date.now(),
  });
  await abschluss(t);
  melden();
  return id;
}

// Bild als Blob, oder null, wenn es das Bild nicht gibt.
export async function bildLaden(id) {
  const t = await transaktion(['bilder'], 'readonly');
  const eintrag = await warte(t.objectStore('bilder').get(id));
  if (!eintrag) return null;
  return new Blob([bytesAusB64(eintrag.daten)], { type: eintrag.typ });
}

// Alle Bilder, die noch nicht auf GitHub liegen (mit Typ und Daten, für den Abgleich).
export async function bilderOhneUpload() {
  const t = await transaktion(['bilder'], 'readonly');
  const liste = await warte(t.objectStore('bilder').getAll());
  return liste.filter((b) => !b.hochgeladen);
}

// Markiert ein Bild als hochgeladen. Kein 'daten-geaendert', sonst würde der Abgleich sich selbst anstoßen.
export async function bildHochgeladen(id) {
  const t = await transaktion(['bilder'], 'readwrite');
  const speicher = t.objectStore('bilder');
  const alt = await warte(speicher.get(id));
  if (alt) speicher.put({ ...alt, hochgeladen: true });
  await abschluss(t);
}

// Legt ein vom Abgleich geholtes Bild ab (schon hochgeladen). Kein 'daten-geaendert'.
export async function bildAblegen(eintrag) {
  const t = await transaktion(['bilder'], 'readwrite');
  t.objectStore('bilder').put({
    id: eintrag.id, typ: eintrag.typ, daten: eintrag.daten, hochgeladen: true, geaendert: Date.now(),
  });
  await abschluss(t);
}

// Komplette Sicherung als Objekt (wird vom Aufrufer als JSON gespeichert).
// Kontakte und Belege sind optionale Felder wie Reisen; Bilder kommen nie in den Export.
export async function exportieren() {
  const bloecke = await alle('bloecke');
  const abwesenheiten = await alle('abwesenheiten');
  const reisen = await alle('reisen');
  const kontakte = await alle('kontakte');
  const belege = await alle('belege');
  const ablage = await alle('ablage');
  const einstellungen = await einstellungenLaden();
  // Version bleibt 1: die Prüfung beim Import verlangt sie, die übrigen Felder sind optional.
  return { version: 1, bloecke, abwesenheiten, reisen, kontakte, belege, ablage, einstellungen };
}

// Schreibt einen Eintrag nur, wenn er neu ist oder neuer als der vorhandene (gleich: vorhandenen behalten).
function zusammenfuehren(speicher, eintrag, zaehler) {
  speicher.get(eintrag.id).onsuccess = (ev) => {
    const alt = ev.target.result;
    if (!alt || (eintrag.geaendert ?? 0) > (alt.geaendert ?? 0)) {
      speicher.put(eintrag);
      zaehler.n++;
    }
  };
}

// Führt eine Sicherung in einer Transaktion mit dem Bestand zusammen.
export async function importieren(daten) {
  const t = await transaktion(['bloecke', 'abwesenheiten', 'reisen', 'kontakte', 'belege', 'ablage', 'einstellungen'], 'readwrite');
  const z = { n: 0 };                     // Anzahl tatsächlich übernommener Einträge
  for (const b of daten?.bloecke ?? []) if (b?.id != null) zusammenfuehren(t.objectStore('bloecke'), b, z);
  for (const a of daten?.abwesenheiten ?? []) if (a?.id != null) zusammenfuehren(t.objectStore('abwesenheiten'), a, z);
  // Alte Sicherungen ohne 'reisen', 'kontakte' oder 'belege': die Schleifen tun dann nichts
  for (const r of daten?.reisen ?? []) if (r?.id != null) zusammenfuehren(t.objectStore('reisen'), r, z);
  for (const k of daten?.kontakte ?? []) if (k?.id != null) zusammenfuehren(t.objectStore('kontakte'), k, z);
  for (const b of daten?.belege ?? []) if (b?.id != null) zusammenfuehren(t.objectStore('belege'), b, z);
  for (const a of daten?.ablage ?? []) if (a?.id != null) zusammenfuehren(t.objectStore('ablage'), a, z);
  // Einstellungen nur übernehmen, wenn sie neuer sind
  const e = daten?.einstellungen;
  if (e) {
    const speicher = t.objectStore('einstellungen');
    speicher.get(EINSTELLUNGEN_SCHLUESSEL).onsuccess = (ev) => {
      const alt = ev.target.result;
      if (!alt || (e.geaendert ?? 0) > (alt.geaendert ?? 0)) {
        speicher.put(e, EINSTELLUNGEN_SCHLUESSEL);
        z.n++;
      }
    };
  }
  await abschluss(t);
  // Nur melden, wenn wirklich etwas übernommen wurde; die Quelle sagt der App, dass kein neuer Abgleich nötig ist
  if (z.n > 0) window.dispatchEvent(new CustomEvent('daten-geaendert', { detail: { quelle: 'import' } }));
  return z.n;
}
