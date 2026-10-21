// IndexedDB-Speicher für Blöcke, Abwesenheiten, Reisen und Einstellungen.
// Keine Abhängigkeiten. Jede schreibende Funktion meldet 'daten-geaendert'.

const DB_NAME = 'zeiterfassung';
const DB_VERSION = 2;
const ARTEN = ['bloecke', 'abwesenheiten', 'reisen'];
const EINSTELLUNGEN_SCHLUESSEL = 'einstellungen';

// Eine Verbindung pro Seite, als Promise zwischengespeichert.
let verbindung = null;

function db() {
  if (!verbindung) {
    verbindung = new Promise((res, rej) => {
      const oeffnen = indexedDB.open(DB_NAME, DB_VERSION);
      oeffnen.onupgradeneeded = () => {
        const d = oeffnen.result;
        // Nur fehlende Speicher anlegen, vorhandene (Version 1) bleiben unberührt.
        if (!d.objectStoreNames.contains('bloecke')) d.createObjectStore('bloecke', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('abwesenheiten')) d.createObjectStore('abwesenheiten', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('einstellungen')) d.createObjectStore('einstellungen'); // ohne keyPath, Schlüssel wird angegeben
        if (!d.objectStoreNames.contains('reisen')) d.createObjectStore('reisen', { keyPath: 'id' });
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

// Komplette Sicherung als Objekt (wird vom Aufrufer als JSON gespeichert).
export async function exportieren() {
  const bloecke = await alle('bloecke');
  const abwesenheiten = await alle('abwesenheiten');
  const reisen = await alle('reisen');
  const einstellungen = await einstellungenLaden();
  // Version bleibt 1: die Prüfung beim Import verlangt sie, Reisen sind ein optionales Feld.
  return { version: 1, bloecke, abwesenheiten, reisen, einstellungen };
}

// Schreibt einen Eintrag nur, wenn er neu ist oder neuer als der vorhandene (gleich: vorhandenen behalten).
function zusammenfuehren(speicher, eintrag) {
  speicher.get(eintrag.id).onsuccess = (ev) => {
    const alt = ev.target.result;
    if (!alt || (eintrag.geaendert ?? 0) > (alt.geaendert ?? 0)) speicher.put(eintrag);
  };
}

// Führt eine Sicherung in einer Transaktion mit dem Bestand zusammen.
export async function importieren(daten) {
  const t = await transaktion(['bloecke', 'abwesenheiten', 'reisen', 'einstellungen'], 'readwrite');
  for (const b of daten?.bloecke ?? []) if (b?.id != null) zusammenfuehren(t.objectStore('bloecke'), b);
  for (const a of daten?.abwesenheiten ?? []) if (a?.id != null) zusammenfuehren(t.objectStore('abwesenheiten'), a);
  // Alte Sicherungen ohne 'reisen': die Schleife tut dann nichts
  for (const r of daten?.reisen ?? []) if (r?.id != null) zusammenfuehren(t.objectStore('reisen'), r);
  // Einstellungen nur übernehmen, wenn sie neuer sind
  const e = daten?.einstellungen;
  if (e) {
    const speicher = t.objectStore('einstellungen');
    speicher.get(EINSTELLUNGEN_SCHLUESSEL).onsuccess = (ev) => {
      const alt = ev.target.result;
      if (!alt || (e.geaendert ?? 0) > (alt.geaendert ?? 0)) speicher.put(e, EINSTELLUNGEN_SCHLUESSEL);
    };
  }
  await abschluss(t);
  melden();
}
