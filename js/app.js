// Start, Darstellung, Hash-Navigation, Sheet-Hilfe und Neuzeichnen der Ansichten.
import { alle, einstellungenLaden, einstellungenSpeichern, exportieren } from './speicher.js';
import { heute, jetztMinuten } from './zeit.js';
import { mitternachtPruefen } from './stempeln.js';
import { abgleichen, einrichtungLaden } from './abgleich.js';
import { abwesenheitAm, sollMinuten, stempelZustand } from './rechnen.js';

const ANSICHTEN = ['heute', 'woche', 'monat', 'reisen', 'abwesenheiten', 'einstellungen'];
const ansicht = document.getElementById('ansicht');
const rahmen = document.querySelector('.rahmen');
const hintergrund = document.getElementById('sheet-hintergrund');
const sheetEl = document.getElementById('sheet');

// Darstellung: Eingaben auf die Werte von data-theme abbilden
const DARSTELLUNG = { system: 'system', hell: 'light', light: 'light', dunkel: 'dark', dark: 'dark' };

function darstellungAnwenden(wert) {
  const html = document.documentElement;
  if (!wert || wert === 'system') html.removeAttribute('data-theme');
  else html.setAttribute('data-theme', wert);
}

// Hash wie #woche/2026-10-19 zerlegen. Unbekannte Namen zeigen „Heute“.
function ausHash() {
  const teile = location.hash.replace(/^#/, '').split('/');
  const name = ANSICHTEN.includes(teile[0]) ? teile[0] : 'heute';
  const parameter = teile.length > 1 ? decodeURIComponent(teile.slice(1).join('/')) : null;
  return { name, parameter };
}

function navAktualisieren(name) {
  for (const link of document.querySelectorAll('.navi [data-ziel]')) {
    if (link.dataset.ziel === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

// Sheet-Hilfe ----------------------------------------------------------

let sheetOffen = false;
let fokusVorher = null;
let ausblendTimer = null;
let ausblendEnde = null;

function fokussierbare() {
  return [...sheetEl.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )];
}

// Laufendes Ausblenden abbrechen (Sheet wird wieder geöffnet)
function ausblendenAbbrechen() {
  clearTimeout(ausblendTimer);
  ausblendTimer = null;
  if (ausblendEnde) sheetEl.removeEventListener('transitionend', ausblendEnde);
  ausblendEnde = null;
}

function oeffnen(titel, element) {
  if (!sheetOffen) fokusVorher = document.activeElement;
  ausblendenAbbrechen();

  const titelZeile = document.createElement('h2');
  titelZeile.id = 'sheet-titel';
  titelZeile.textContent = titel;
  sheetEl.replaceChildren(titelZeile, element);
  sheetEl.setAttribute('aria-labelledby', 'sheet-titel');
  sheetEl.tabIndex = -1;

  hintergrund.hidden = false;
  sheetEl.hidden = false;
  rahmen?.toggleAttribute('inert', true);

  if (!sheetOffen) {
    sheetOffen = true;
    // Im nächsten Frame einblenden, damit die Übergänge greifen
    requestAnimationFrame(() => {
      void sheetEl.offsetWidth;
      hintergrund.classList.add('offen');
      sheetEl.classList.add('offen');
    });
  }

  // Erstes Eingabefeld bekommt den Fokus, sonst das Sheet selbst
  requestAnimationFrame(() => {
    const erstes = element.querySelector('input:not([type="hidden"]), select, textarea');
    (erstes ?? sheetEl).focus({ preventScroll: true });
  });
}

function schliessen() {
  if (!sheetOffen) return;
  sheetOffen = false;
  hintergrund.classList.remove('offen');
  sheetEl.classList.remove('offen');
  rahmen?.toggleAttribute('inert', false);

  const ziel = fokusVorher;
  fokusVorher = null;

  // Nach dem Übergang ausblenden (oder spätestens nach 400 ms)
  const fertig = () => {
    ausblendenAbbrechen();
    if (!sheetOffen) {
      hintergrund.hidden = true;
      sheetEl.hidden = true;
      sheetEl.replaceChildren();
    }
  };
  ausblendEnde = (e) => {
    if (e.target === sheetEl) fertig();
  };
  sheetEl.addEventListener('transitionend', ausblendEnde);
  ausblendTimer = setTimeout(fertig, 400);

  if (ziel && ziel.isConnected && typeof ziel.focus === 'function') {
    ziel.focus({ preventScroll: true });
  }
}

// Tab bleibt im Sheet, Escape schließt
function tasteImSheet(e) {
  if (!sheetOffen) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    schliessen();
    return;
  }
  if (e.key !== 'Tab') return;
  const liste = fokussierbare();
  if (liste.length === 0) {
    e.preventDefault();
    sheetEl.focus();
    return;
  }
  const erster = liste[0];
  const letzter = liste[liste.length - 1];
  const aktiv = document.activeElement;
  const drinnen = sheetEl.contains(aktiv);
  if (e.shiftKey && (!drinnen || aktiv === erster)) {
    e.preventDefault();
    letzter.focus();
  } else if (!e.shiftKey && (!drinnen || aktiv === letzter)) {
    e.preventDefault();
    erster.focus();
  }
}

document.addEventListener('keydown', tasteImSheet);
hintergrund.addEventListener('click', schliessen);

const sheet = { oeffnen, schliessen };

// Ansichten zeichnen ----------------------------------------------------

let angezeigt = null; // Name der zuletzt gezeigten Ansicht
let laufend = 0; // Zähler: nur das neueste Zeichnen darf noch etwas schreiben
let minutenTimer = null;

async function darstellungSetzen(wert) {
  const norm = DARSTELLUNG[wert] ?? 'system';
  darstellungAnwenden(norm);
  const e = await einstellungenLaden();
  await einstellungenSpeichern({ ...e, darstellung: norm });
}

// Fokus in #ansicht merken: aria-label, sonst Tag und Text. Null, wenn nichts in #ansicht den Fokus hat.
function fokusMerken() {
  const aktiv = document.activeElement;
  if (!aktiv || aktiv === ansicht || !ansicht.contains(aktiv)) return null;
  const label = aktiv.getAttribute('aria-label');
  if (label) return { label };
  const text = aktiv.textContent.trim();
  return text ? { tag: aktiv.tagName, text } : null;
}

// Nach dem Neuzeichnen das Element mit gleichem aria-label (sonst gleichem Tag und Text) fokussieren, ohne zu scrollen.
function fokusWiederherstellen(merk) {
  if (!merk) return;
  const kandidaten = merk.label
    ? [...ansicht.querySelectorAll('[aria-label]')]
    : [...ansicht.querySelectorAll(merk.tag)];
  const treffer = kandidaten.find((e) => (merk.label
    ? e.getAttribute('aria-label') === merk.label
    : e.textContent.trim() === merk.text));
  treffer?.focus({ preventScroll: true });
}

// Zeichnet die Ansicht aus dem Hash neu. Behält Bildlaufposition, Fokus nur bei Ansichtswechsel.
async function zeichnen() {
  const token = ++laufend;
  const { name, parameter } = ausHash();
  const wechsel = name !== angezeigt;
  const scroll = window.scrollY;
  let fokus = null;
  navAktualisieren(name);

  // Ansichtsmodul laden. Fehlt es, kommt eine ruhige Meldung.
  let modul = null;
  try {
    modul = await import(`./ansicht_${name}.js`);
  } catch (e) {
    console.warn('Ansichtsmodul nicht geladen:', name, e);
  }
  if (token !== laufend) return;

  let einst;
  let daten;
  try {
    einst = await einstellungenLaden();
    if (token !== laufend) return;
    daten = {
      bloecke: await alle('bloecke'),
      abwesenheiten: await alle('abwesenheiten'),
      einstellungen: einst,
    };
  } catch (e) {
    console.error(e);
    if (token !== laufend) return;
    const p = document.createElement('p');
    p.className = 'leer';
    p.textContent = 'Die Daten konnten nicht geladen werden.';
    ansicht.replaceChildren(p);
    return;
  }
  if (token !== laufend) return;
  darstellungAnwenden(einst.darstellung);

  if (wechsel) ansicht.removeAttribute('data-monat');

  if (!modul) {
    const p = document.createElement('p');
    p.className = 'leer';
    p.textContent = 'Diese Ansicht ist noch nicht fertig.';
    ansicht.replaceChildren(p);
  } else {
    const kontext = {
      parameter,
      daten,
      neuZeichnen: () => zeichnen(),
      sheet,
      darstellungSetzen,
      jetzt: jetztMinuten(),
      heute: heute(),
      laptop,
      abgleichJetzt: () => abgleichStarten('manuell'),
      abgleichStatus: () => ({ ...abgleichZustand }),
    };
    try {
      fokus = wechsel ? null : fokusMerken();
      await modul.zeigen(ansicht, kontext);
    } catch (e) {
      console.error(e);
      if (token !== laufend) return;
      const p = document.createElement('p');
      p.className = 'leer';
      p.textContent = 'Diese Ansicht konnte nicht angezeigt werden.';
      ansicht.replaceChildren(p);
    }
  }
  if (token !== laufend) return;

  if (wechsel) {
    window.scrollTo(0, 0);
    // Fokus nur beim Wechsel, nicht beim ersten Start
    if (angezeigt !== null) ansicht.focus({ preventScroll: true });
    angezeigt = name;
  } else {
    fokusWiederherstellen(fokus);
    window.scrollTo(0, scroll);
  }
}

// Jede volle Minute: Mitternacht prüfen, „Heute“ neu zeichnen
function naechsteMinute() {
  clearTimeout(minutenTimer);
  const jetzt = new Date();
  const rest = 60000 - (jetzt.getSeconds() * 1000 + jetzt.getMilliseconds());
  minutenTimer = setTimeout(async () => {
    try {
      await mitternachtPruefen();
    } catch (e) {
      console.error(e);
    }
    try {
      await erinnerungPruefen();
    } catch (e) {
      console.error(e);
    }
    if (ausHash().name === 'heute') zeichnen();
    naechsteMinute();
  }, rest);
}

// Service Worker nur, wenn der Browser ihn kann und sw.js da ist
async function swRegistrieren() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const url = new URL('../sw.js', import.meta.url);
    const antwort = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!antwort.ok) return;
    await navigator.serviceWorker.register(url);
  } catch {
    // Fehler still ignorieren
  }
}

// Laptop: einmal beim Start ermitteln. Auf dem iPhone gibt es /api/status nicht, dann bleibt es false.
let laptop = false;
async function laptopErmitteln() {
  try {
    const antwort = await fetch('/api/status', { cache: 'no-store' });
    if (!antwort.ok) return false;
    return (await antwort.json()).laptop === true;
  } catch {
    return false; // kein Laptop-Server
  }
}

// Sicherung am Laptop beim Start und stündlich (eine Datei pro Tag, wird überschrieben): der lokale Server legt sie unter %LOCALAPPDATA%\Zeiterfassung\sicherungen ab.
async function laptopSicherung() {
  if (!laptop) return;
  try {
    const daten = await exportieren();
    const antwort = await fetch('/api/sicherung', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten),
    });
    if (!antwort.ok) console.error('Sicherung fehlgeschlagen', antwort.status);
  } catch {
    // Netzfehler: beim nächsten Durchlauf wieder versuchen
  }
}

// Abgleich mit GitHub ---------------------------------------------------
// Ein Abgleich läuft nach dem anderen. Wird während eines Laufs einer verlangt, folgt danach einer.
// Token und Passwort werden nie ausgegeben; Fehlertexte kommen aus abgleich.js.

const abgleichZustand = { laeuft: false, zuletzt: null, fehler: null };
let abgleichNachholen = false;
let abgleichTimer = null;

function einrichtungVollstaendig(e) {
  return Boolean(e && e.repo && e.token && e.passwort && e.pfad);
}

function abgleichMelden() {
  window.dispatchEvent(new CustomEvent('abgleich-status', { detail: { ...abgleichZustand } }));
}

// grund ist nur zur Übersicht (start, sichtbar, takt, daten, manuell).
async function abgleichStarten(grund) {
  if (abgleichZustand.laeuft) {
    abgleichNachholen = true;
    return;
  }
  if (!einrichtungVollstaendig(einrichtungLaden())) return;
  abgleichZustand.laeuft = true;
  abgleichMelden();
  try {
    await abgleichen(einrichtungLaden());
    abgleichZustand.zuletzt = Date.now();
    abgleichZustand.fehler = null;
  } catch (e) {
    abgleichZustand.fehler = e?.message || 'Der Abgleich ist fehlgeschlagen.';
    console.warn('Abgleich fehlgeschlagen', grund, abgleichZustand.fehler);
  } finally {
    abgleichZustand.laeuft = false;
    abgleichMelden();
  }
  if (abgleichNachholen) {
    abgleichNachholen = false;
    abgleichStarten('nachholen');
  } else if (aenderungWaehrendLauf) {
    aenderungWaehrendLauf = false;
    abgleichNachAenderung();
  }
}

// 5 s nach der letzten Änderung. Ereignisse während eines Laufs können vom Abgleich selbst stammen (importieren)
// oder vom Nutzer; deshalb danach einmal nachprüfen. Ist nichts neu, lädt der Abgleich auch nichts hoch.
let aenderungWaehrendLauf = false;
function abgleichNachAenderung() {
  if (abgleichZustand.laeuft) {
    aenderungWaehrendLauf = true;
    return;
  }
  clearTimeout(abgleichTimer);
  abgleichTimer = setTimeout(() => abgleichStarten('daten'), 5000);
}

// Erinnerungen ----------------------------------------------------------
// Benachrichtigungen nur mit Erlaubnis. 18 Uhr: nichts eingetragen. 20 Uhr: noch eingestempelt. Je Tag und Art einmal.

const ERINNERT_SCHLUESSEL = 'zeit.erinnert';
const gemerkt = new Set(); // Rückfall, falls localStorage nicht schreibt

// Gemerkte Erinnerungen von heute: { 'JJJJ-MM-TT': ['arbeit'] }. Ältere Tage fallen weg.
function erinnertLesen() {
  try {
    const wert = JSON.parse(localStorage.getItem(ERINNERT_SCHLUESSEL) ?? 'null');
    return wert && typeof wert === 'object' ? wert : {};
  } catch {
    return {};
  }
}

function erinnertSchon(datum, art) {
  if (gemerkt.has(`${datum}|${art}`)) return true;
  const liste = erinnertLesen()[datum];
  return Array.isArray(liste) && liste.includes(art);
}

function erinnertMerken(datum, art) {
  gemerkt.add(`${datum}|${art}`);
  const liste = erinnertLesen()[datum];
  const merk = { [datum]: [...(Array.isArray(liste) ? liste : []), art] };
  try {
    localStorage.setItem(ERINNERT_SCHLUESSEL, JSON.stringify(merk));
  } catch {
    // Speicher gesperrt: der Rückfall oben hält die Erinnerung für diese Sitzung
  }
}

function benachrichtigen(text) {
  try {
    new Notification('Zeiterfassung', { body: text });
  } catch (e) {
    console.error(e);
  }
}

// Jede volle Minute aufgerufen.
async function erinnerungPruefen() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const einst = await einstellungenLaden();
  if (einst.erinnerung !== true) return;
  const jetzt = jetztMinuten();
  if (jetzt < 18 * 60) return;
  const d = heute();
  const bloecke = await alle('bloecke');
  const abw = await alle('abwesenheiten');
  const zustand = stempelZustand(bloecke, d);

  if (jetzt >= 20 * 60 && zustand === 'arbeit' && !erinnertSchon(d, 'arbeit')) {
    erinnertMerken(d, 'arbeit');
    benachrichtigen('Du bist noch eingestempelt.');
    return;
  }
  if (zustand === 'aus' && !erinnertSchon(d, 'leer')) {
    const a = abwesenheitAm(abw, d);
    const ganztaegig = a !== null && !a.halbtag;
    // Feiertage und arbeitsfreie Tage haben Soll 0
    if (!ganztaegig && sollMinuten(d, einst, abw) > 0) {
      erinnertMerken(d, 'leer');
      benachrichtigen('Heute ist noch nichts eingetragen.');
    }
  }
}

// Ereignisse ------------------------------------------------------------

window.addEventListener('hashchange', () => zeichnen());
window.addEventListener('daten-geaendert', () => {
  zeichnen();
  abgleichNachAenderung();
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    await mitternachtPruefen();
  } catch (e) {
    console.error(e);
  }
  zeichnen();
  abgleichStarten('sichtbar');
});

// Start
(async function start() {
  try {
    const einst = await einstellungenLaden();
    darstellungAnwenden(einst.darstellung);
  } catch (e) {
    console.error(e);
  }
  try {
    await mitternachtPruefen();
  } catch (e) {
    console.error(e);
  }
  laptop = await laptopErmitteln();
  swRegistrieren();
  laptopSicherung();
  setInterval(laptopSicherung, 60 * 60 * 1000);
  abgleichStarten('start');
  setInterval(() => abgleichStarten('takt'), 10 * 60 * 1000);
  naechsteMinute();
  zeichnen();
})();
