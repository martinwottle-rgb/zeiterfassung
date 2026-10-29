// Start, Darstellung, Hash-Navigation, Sheet-Hilfe und Neuzeichnen der Ansichten.
import { alle, einstellungenLaden, einstellungenSpeichern, exportieren } from './speicher.js';
import * as speicher from './speicher.js'; // bildLaden kommt aus speicher.js, wird zur Laufzeit geprüft (typeof)
import { heute, jetztMinuten } from './zeit.js';
import { mitternachtPruefen } from './stempeln.js';
import { abgleichen, bildHolen, einrichtungLaden } from './abgleich.js';
import { abwesenheitAm, sollMinuten, stempelZustand } from './rechnen.js';

const ANSICHTEN = ['heute', 'woche', 'monat', 'abwesenheiten', 'reisen', 'belege', 'kontakte', 'einstellungen'];
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

// Monat und Abwesenheiten gehören zum Reiter „Zeit“ (woche). Einstellungen hat ein eigenes Zahnrad.
const REITER_VON = { monat: 'woche', abwesenheiten: 'woche' };

function navAktualisieren(name) {
  const reiter = REITER_VON[name] ?? name;
  for (const link of document.querySelectorAll('[data-ziel]')) {
    if (link.dataset.ziel === reiter) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

// Sheet-Hilfe ----------------------------------------------------------

let sheetOffen = false;
let fokusVorher = null;
let ausblendTimer = null;
let ausblendEnde = null;
let geaendert = false; // seit dem Öffnen hat ein Feld im Sheet eine Änderung gemeldet
let ohneRueckfrage = false; // die Ansicht hat {ohneRueckfrage: true} übergeben
let rueckfrageEl = null; // offene Rückfrage „Änderungen verwerfen?“
let sheetKopf = null; // Kopfzeile mit Titel und Schließen-Knopf
let sheetZug = null; // eine Wischbewegung am Sheet: { id, x, y, imKopf, zieht, offset, verlauf }

const SHEET_KOPF_HOEHE = 64; // oberste Pixel des Sheets: dort wischt man immer
const SHEET_WEG_ANTEIL = 0.25; // ab diesem Anteil der Höhe schließt das Sheet beim Loslassen
const SHEET_TEMPO = 0.5; // px/ms nach unten: schließt das Sheet auch bei kurzem Weg
const SHEET_EINGABE = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])';

function bewegungReduziert() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

// Stile vom Wischen entfernen: die Klassen (.offen) bestimmen dann wieder Lage und Übergang
function gestenStilLeeren() {
  sheetEl.style.transition = '';
  sheetEl.style.transform = '';
  hintergrund.style.transition = '';
  hintergrund.style.opacity = '';
}

function rueckfrageWeg() {
  rueckfrageEl?.remove();
  rueckfrageEl = null;
}

// Rückfrage im Sheet, direkt unter der Kopfzeile. „Weiter bearbeiten“ hat den Fokus.
function rueckfrageZeigen() {
  if (rueckfrageEl || !sheetKopf) return;
  const box = document.createElement('div');
  box.className = 'sheet-rueckfrage';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-labelledby', 'sheet-rueckfrage-text');

  const text = document.createElement('p');
  text.id = 'sheet-rueckfrage-text';
  text.className = 'sheet-rueckfrage-text';
  text.textContent = 'Änderungen verwerfen?';

  const knoepfe = document.createElement('div');
  knoepfe.className = 'sheet-rueckfrage-knoepfe';

  const verwerfen = document.createElement('button');
  verwerfen.type = 'button';
  verwerfen.className = 'knopf gefahr';
  verwerfen.textContent = 'Verwerfen';
  verwerfen.addEventListener('click', () => {
    geaendert = false;
    rueckfrageWeg();
    schliessen();
  });

  const weiter = document.createElement('button');
  weiter.type = 'button';
  weiter.className = 'knopf haupt';
  weiter.textContent = 'Weiter bearbeiten';
  weiter.addEventListener('click', () => {
    rueckfrageWeg();
    (sheetEl.querySelector('input:not([type="hidden"]), select, textarea') ?? sheetEl).focus({ preventScroll: true });
  });

  knoepfe.append(verwerfen, weiter);
  box.append(text, knoepfe);
  sheetKopf.after(box);
  rueckfrageEl = box;
  sheetEl.scrollTop = 0; // die Frage soll oben sichtbar sein
  weiter.focus({ preventScroll: true });
}

// Schließen durch den Nutzer (×, Escape, Hintergrund, Wischen): bei ungesicherten Änderungen erst fragen
function nutzerSchliessen() {
  if (!sheetOffen) return;
  if (geaendert && !ohneRueckfrage) rueckfrageZeigen();
  else schliessen();
}

// × und Escape: offene Rückfrage schließt nur die Rückfrage, sonst das Sheet (mit Nachfrage)
function kreuzGedrueckt() {
  if (rueckfrageEl) rueckfrageWeg();
  else nutzerSchliessen();
}

function oeffnen(titel, element, optionen = {}) {
  if (!sheetOffen) fokusVorher = document.activeElement;
  ausblendenAbbrechen();
  rueckfrageWeg();
  gestenStilLeeren();
  geaendert = false;
  ohneRueckfrage = optionen.ohneRueckfrage === true;

  const titelZeile = document.createElement('h2');
  titelZeile.id = 'sheet-titel';
  titelZeile.textContent = titel;

  const schliessenKnopf = document.createElement('button');
  schliessenKnopf.type = 'button';
  schliessenKnopf.className = 'sheet-schliessen';
  schliessenKnopf.setAttribute('aria-label', 'Schließen');
  schliessenKnopf.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  schliessenKnopf.addEventListener('click', kreuzGedrueckt);

  sheetKopf = document.createElement('div');
  sheetKopf.className = 'sheet-kopf';
  sheetKopf.append(titelZeile, schliessenKnopf);

  sheetEl.replaceChildren(sheetKopf, element);
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

// Schließt ohne Nachfrage. Die Ansicht ruft das selbst auf (nach dem Sichern), Abbrechen ebenso.
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
      sheetKopf = null;
      rueckfrageEl = null;
      gestenStilLeeren();
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
    kreuzGedrueckt();
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
hintergrund.addEventListener('click', () => {
  if (!rueckfrageEl) nutzerSchliessen();
});

// Ungesicherte Änderungen: jede Eingabe im Sheet merkt sich das
function aenderungMelden() {
  geaendert = true;
}
sheetEl.addEventListener('input', aenderungMelden);
sheetEl.addEventListener('change', aenderungMelden);

// Herunterziehen zum Schließen (iOS-Stil). Touch Events, weil iOS Pointer Events bei eigenem Scrollen abbricht.
// Verlauf für die Geschwindigkeit beim Loslassen: { y, t } in px und ms.
function geschwindigkeit(verlauf) {
  if (verlauf.length < 2) return 0;
  const jetzt = verlauf[verlauf.length - 1];
  const alt = verlauf.find((p) => jetzt.t - p.t <= 100) ?? verlauf[verlauf.length - 2];
  const dt = jetzt.t - alt.t;
  return dt > 0 ? (jetzt.y - alt.y) / dt : 0;
}

sheetEl.addEventListener('touchstart', (e) => {
  if (sheetZug && e.touches.length === 1) sheetZug = null; // hängengebliebene Geste (Ende nicht gemeldet): verwerfen
  if (!sheetOffen || e.touches.length !== 1 || sheetZug) return;
  if (e.target.closest?.(SHEET_EINGABE)) return; // Eingabefelder, Auswahl, Textbereiche: nie wischen
  const t = e.touches[0];
  const imKopf = t.clientY - sheetEl.getBoundingClientRect().top <= SHEET_KOPF_HOEHE;
  if (!imKopf && sheetEl.scrollTop > 0) return; // der Inhalt scrollt noch
  sheetZug = { id: t.identifier, x: t.clientX, y: t.clientY, imKopf, zieht: false, offset: 0, verlauf: [] };
}, { passive: true });

sheetEl.addEventListener('touchmove', (e) => {
  const z = sheetZug;
  if (!z) return;
  const t = [...e.changedTouches].find((c) => c.identifier === z.id);
  if (!t) return;
  const dx = t.clientX - z.x;
  const dy = t.clientY - z.y;

  if (!z.zieht) {
    if (!z.imKopf && sheetEl.scrollTop > 0) { sheetZug = null; return; } // der Inhalt hat zu scrollen begonnen
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { sheetZug = null; return; } // waagerecht: nicht übernehmen
    if (dy <= 6) return; // kleine Bewegung oder nach oben: normales Scrollen
    z.zieht = true;
    sheetEl.style.transition = 'none';
    hintergrund.style.transition = 'none';
  }
  if (Math.abs(dx) > Math.abs(dy)) { // während des Ziehens seitlich: abbrechen und zurückfedern
    sheetZug = null;
    gestenStilLeeren();
    return;
  }

  e.preventDefault(); // das Sheet folgt dem Finger, der Inhalt scrollt nicht mit
  z.offset = Math.max(0, dy);
  z.verlauf.push({ y: t.clientY, t: performance.now() });
  if (z.verlauf.length > 12) z.verlauf.shift();
  if (!bewegungReduziert()) {
    const hoehe = sheetEl.offsetHeight || 1;
    sheetEl.style.transform = `translateY(${z.offset}px)`;
    hintergrund.style.opacity = String(Math.max(0, 1 - z.offset / hoehe));
  }
}, { passive: false });

// Loslassen: weit genug oder schnell nach unten schließt das Sheet, sonst federt es zurück
function sheetZiehEnde(e) {
  const z = sheetZug;
  if (!z || (e.touches && e.touches.length > 0)) return;
  sheetZug = null;
  if (!z.zieht) return;
  const hoehe = sheetEl.offsetHeight || 1;
  const weit = z.offset > hoehe * SHEET_WEG_ANTEIL;
  const schnell = geschwindigkeit(z.verlauf) > SHEET_TEMPO;
  const schliessenJa = e.type === 'touchend' && z.offset > 0 && (weit || schnell);
  if (!schliessenJa || rueckfrageEl) {
    gestenStilLeeren(); // federt über die Klasse .sheet zurück
    return;
  }
  if (geaendert && !ohneRueckfrage) {
    gestenStilLeeren();
    rueckfrageZeigen();
    return;
  }
  // Weiter nach unten gleiten: gestenStilLeeren löst die Lage, schliessen() setzt translateY(100%)
  gestenStilLeeren();
  schliessen();
}
sheetEl.addEventListener('touchend', sheetZiehEnde);
sheetEl.addEventListener('touchcancel', sheetZiehEnde);

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
      abgleichStatus: () => ({ ...abgleichZustand, eingerichtet: einrichtungVollstaendig(einrichtungLaden()) }),
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

// Name der App: am Laptop der lokale Name, sonst „Arbeitsmappe“. Der lokale Name ist in zwei Teile geteilt, damit er nicht als Wort im Quelltext steht.
const LOKALER_NAME = 'Seyd' + 'elmann';
const NEUTRALER_NAME = 'Arbeitsmappe';

function namenSetzen() {
  const name = laptop ? LOKALER_NAME : NEUTRALER_NAME;
  document.title = name;
  const marke = document.querySelector('.marke');
  if (marke) marke.textContent = name;
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
    outlookUebernehmen(); // nur am Laptop, siehe unten
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

// Outlook-Automatik (nur am Laptop) --------------------------------------
// Kontakte ohne outlook-Eintrag oder mit outlook.status „offen“ gehen nacheinander an POST /api/outlook-kontakt.
// Ein Lauf nach dem anderen. Auslöser: nach jedem Abgleich und 3 s nach einer Datenänderung (entprellt).
// Das Ergebnis wird gespeichert, danach ist der Status nicht mehr „offen“: die Schleife endet von selbst.

const OUTLOOK_VERZOEGERUNG = 3000;
let outlookLaeuft = false;
let outlookNochmal = false;
let outlookTimer = null;

// Bild-Ids eines Kontakts: jedes Feld mit „bild“ im Namen. Notizfotos heißen „Notiz.jpg“, sonst „Visitenkarte.jpg“.
function kontaktBildIds(k) {
  return Object.entries(k)
    // Originale vor dem Zuschneiden („bildKarteOriginal“) gehen nicht nach Outlook
    .filter(([feld, wert]) => /bild/i.test(feld) && !/original$/i.test(feld) && typeof wert === 'string' && wert !== '')
    .map(([feld, id]) => ({ id, name: /notiz/i.test(feld) ? 'Notiz.jpg' : 'Visitenkarte.jpg' }));
}

function blobAlsBase64(blob) {
  return new Promise((ok, fehler) => {
    const leser = new FileReader();
    leser.onload = () => {
      const text = String(leser.result);
      ok(text.slice(text.indexOf(',') + 1));
    };
    leser.onerror = () => fehler(leser.error);
    leser.readAsDataURL(blob);
  });
}

// Bilder für den Versand: { bilder: { id: {name, daten} }, fehlt: Anzahl }. Fehlt ein Bild lokal (Kontakt vom iPhone
// über den Abgleich), wird es von GitHub geholt. Liefert auch das nichts (iPhone hat es noch nicht hochgeladen),
// geht der Kontakt trotzdem ohne dieses Foto nach Outlook; das Foto wird später nachgereicht (fotoFehlt).
async function outlookBilder(k) {
  const bilder = {};
  let fehlt = 0;
  for (const { id, name } of kontaktBildIds(k)) {
    let blob = typeof speicher.bildLaden === 'function' ? await speicher.bildLaden(id) : null;
    if (!blob) {
      try {
        blob = await bildHolen(id, einrichtungLaden());
      } catch (e) {
        console.warn('Bild nicht geholt, Kontakt geht ohne Foto', e?.message);
        blob = null;
      }
    }
    if (!blob) {
      fehlt += 1;
      continue;
    }
    bilder[id] = { name, daten: await blobAlsBase64(blob) };
  }
  return { bilder, fehlt };
}

// Fehlende Fotos höchstens alle 10 Minuten neu versuchen (jeder Versuch fragt GitHub)
const FOTO_NACHREICHEN_MS = 10 * 60 * 1000;
const fotoVersuch = new Map(); // Kontakt-id → Zeit des letzten Nachreich-Versuchs

// Notiz für Outlook: Kontaktnotiz und Lead-Block. lead.js per dynamischem Import, damit ein Fehler dort die App nicht stoppt.
async function outlookNotizMitLead(k) {
  try {
    const { outlookNotiz } = await import('./lead.js');
    return outlookNotiz(k.notiz ?? '', k.lead);
  } catch (e) {
    console.warn('Lead-Block nicht erstellt', e);
    return k.notiz ?? '';
  }
}

// Ein Durchlauf. Netzfehler: der Rest bleibt offen, der nächste Auslöser versucht es erneut.
async function outlookLauf() {
  let kontakte;
  try {
    kontakte = await alle('kontakte');
  } catch (e) {
    console.error(e);
    return;
  }
  // Nur von Martin geprüfte Kontakte (geprueft === true) gehen an Outlook. Dazu kommen übernommene Kontakte,
  // deren Foto noch fehlte, sobald der letzte Versuch 10 Minuten her ist.
  const jetzt = Date.now();
  const fotoNachreichen = (k) => k.outlook?.fotoFehlt && k.outlook.status !== 'offen'
    && jetzt - (fotoVersuch.get(k.id) ?? 0) >= FOTO_NACHREICHEN_MS;
  const offen = kontakte.filter((k) => !k.geloescht && k.geprueft === true
    && (!k.outlook || k.outlook.status === 'offen' || fotoNachreichen(k)));
  for (const k of offen) {
    let antwort;
    let fehlt = 0;
    try {
      const nachreichen = k.outlook?.status !== 'offen' && k.outlook?.fotoFehlt;
      if (nachreichen) fotoVersuch.set(k.id, jetzt);
      const erg = await outlookBilder(k);
      fehlt = erg.fehlt;
      // Foto fehlt immer noch: nichts Neues zu senden
      if (nachreichen && fehlt >= k.outlook.fotoFehlt) continue;
      const bilder = erg.bilder;
      // Eigener Kontakt (vorher angelegt oder aktualisiert, EntryID bekannt): der Server überschreibt ihn.
      // Der Server reicht nur kontakt und bilder weiter, daher stehen eigen und entry_id im kontakt.
      const { outlook: o, ...rest } = k;
      const outlook = nachreichen ? { ...o, vorher: o.status } : o;
      const eigen = Boolean(outlook?.entryId) && ['angelegt', 'aktualisiert'].includes(outlook?.vorher);
      // Lead-Daten kommen als Block unter die Notiz (Outlook kennt keine Lead-Felder)
      const mitLead = { ...rest, notiz: await outlookNotizMitLead(rest) };
      const kontakt = eigen ? { ...mitLead, eigen: true, entry_id: outlook.entryId } : mitLead;
      const antwortRoh = await fetch('/api/outlook-kontakt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kontakt, bilder }),
      });
      antwort = await antwortRoh.json();
    } catch (e) {
      console.warn('Outlook-Übernahme nicht möglich, Kontakt bleibt offen', e);
      return;
    }
    try {
      // Während des Sendens kann Martin den Kontakt geändert haben: dann nichts überschreiben, er bleibt offen
      const frisch = (await alle('kontakte')).find((x) => x.id === k.id);
      if (!frisch || frisch.geaendert !== k.geaendert) continue;
      await speicher.speichern('kontakte', {
        ...frisch,
        outlook: {
          status: antwort?.status ?? 'fehler',
          meldung: antwort?.meldung ?? '',
          zeit: Date.now(),
          entryId: antwort?.entry_id || frisch.outlook?.entryId || '',
          // Anzahl Fotos, die noch nachgereicht werden (0: alles in Outlook)
          fotoFehlt: antwort?.status && antwort.status !== 'fehler' ? fehlt : 0,
        },
      });
    } catch (e) {
      console.error(e);
      return;
    }
  }
}

// Nie zwei Läufe gleichzeitig: ein Auslöser während eines Laufs führt danach einen weiteren Lauf aus.
async function outlookUebernehmen() {
  if (!laptop) return;
  if (outlookLaeuft) {
    outlookNochmal = true;
    return;
  }
  outlookLaeuft = true;
  try {
    do {
      outlookNochmal = false;
      await outlookLauf();
    } while (outlookNochmal);
  } catch (e) {
    console.error(e);
  } finally {
    outlookLaeuft = false;
  }
}

// Entprellt: 3 s nach der letzten Datenänderung
function outlookNachAenderung() {
  clearTimeout(outlookTimer);
  outlookTimer = setTimeout(() => outlookUebernehmen(), OUTLOOK_VERZOEGERUNG);
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
window.addEventListener('daten-geaendert', (e) => {
  zeichnen();
  // Vom Abgleich übernommene Daten lösen keinen neuen Abgleich aus (sonst läuft er im Kreis)
  if (e.detail?.quelle !== 'import') abgleichNachAenderung();
  outlookNachAenderung();
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
window.addEventListener('online', () => abgleichStarten('online'));

// Ziehen zum Aktualisieren ----------------------------------------------
// Nur Touch und Stift, nur ganz oben und nur nach unten. Der Indikator folgt mit halbem Weg (höchstens 90 px).
// Ab 70 px Indikatorweg rastet er ein; beim Loslassen darüber läuft der Abgleich, sonst federt er sofort zurück.
const ZIEH_SCHWELLE = 70;
const ZIEH_MAX = 90;
const SYNC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14.6-4.5"/><path d="M19 3.5v4h-4"/><path d="M20 12a8 8 0 0 1-14.6 4.5"/><path d="M5 16.5v4h4"/></svg>';

const zieher = document.createElement('div');
zieher.className = 'zieh-indikator';
zieher.setAttribute('aria-hidden', 'true');
zieher.innerHTML = SYNC_SVG;
document.body.append(zieher);

let zug = null; // { id, x, y, zieht, offset }: eine Ziehbewegung mit einem Finger
let ziehLaedt = false;

function zieherSetzen(offset, federt) {
  zieher.classList.toggle('federt', federt);
  zieher.classList.toggle('sichtbar', offset > 0);
  zieher.classList.toggle('bereit', offset >= ZIEH_SCHWELLE);
  zieher.style.setProperty('--zug', `${offset}px`);
  zieher.style.setProperty('--dreh', `${offset * 4}deg`);
}

function zugAbbrechen() {
  zug = null;
  zieherSetzen(0, true);
}

// Höchstens so lange dreht der Kreis; ein längerer Abgleich läuft unsichtbar weiter (das Etikett auf „Heute“ zeigt ihn).
const ZIEH_HOECHSTENS_MS = 2500;
const warten = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function ziehenAusloesen(offset) {
  ziehLaedt = true;
  zieher.classList.add('laedt');
  zieherSetzen(offset, false);
  try {
    const abgleich = einrichtungVollstaendig(einrichtungLaden()) ? abgleichStarten('ziehen') : Promise.resolve();
    await Promise.race([abgleich, warten(ZIEH_HOECHSTENS_MS)]);
    await zeichnen();
  } catch (e) {
    console.error(e);
  } finally {
    ziehLaedt = false;
    zieher.classList.remove('laedt');
    zieherSetzen(0, true);
  }
}

// Touch Events statt Pointer Events: iOS Safari löst bei Pointer Events pointercancel aus, sobald es selbst scrollen will.
// Nur Touch kommt hier an, die Maus bleibt außen vor.
ansicht.addEventListener('touchstart', (e) => {
  if (zug && e.touches.length === 1) zugAbbrechen();   // hängengebliebener Zug (Ende nicht gemeldet): verwerfen
  if (e.touches.length !== 1 || zug || ziehLaedt || sheetOffen || window.scrollY !== 0) return;
  const t = e.touches[0];
  zug = { id: t.identifier, x: t.clientX, y: t.clientY, zieht: false, offset: 0 };
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!zug) return;
  const t = [...e.changedTouches].find((c) => c.identifier === zug.id);
  if (!t) return;
  const dx = t.clientX - zug.x;
  const dy = t.clientY - zug.y;
  if (window.scrollY !== 0 || sheetOffen) return zugAbbrechen();
  if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) return zugAbbrechen(); // seitlich
  if (dy < -8 && -dy > Math.abs(dx)) return zugAbbrechen(); // nach oben
  if (dy <= 0) return;
  // Am oberen Rand nach unten: der Browser soll weder scrollen noch neu laden
  e.preventDefault();
  if (!zug.zieht) {
    if (dy <= 6) return;
    zug.zieht = true;
  }
  if (Math.abs(dx) > dy) return zugAbbrechen(); // während des Ziehens seitlich
  zug.offset = Math.min(dy * 0.5, ZIEH_MAX);
  zieherSetzen(zug.offset, false);
}, { passive: false });

// iOS meldet das Ende nicht immer mit derselben Finger-Kennung: Ende ist, wenn kein Finger mehr liegt.
function zugEnde(e) {
  if (!zug) return;
  if (e.touches && e.touches.length > 0) return;
  const offset = zug.offset;
  const ausloesen = e.type === 'touchend' && zug.zieht && offset >= ZIEH_SCHWELLE;
  zug = null;
  if (ausloesen) ziehenAusloesen(offset);
  else zieherSetzen(0, true);
}
document.addEventListener('touchend', zugEnde);
document.addEventListener('touchcancel', zugEnde);
// Sicherheitsnetz: App verlässt den Vordergrund, oder der Kreis steht ohne Finger und ohne Abgleich herum
document.addEventListener('visibilitychange', () => { if (document.hidden && !ziehLaedt) zugAbbrechen(); });
setInterval(() => {
  if (!zug && !ziehLaedt && zieher.classList.contains('sichtbar')) zieherSetzen(0, true);
}, 1000);

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
  namenSetzen();
  swRegistrieren();
  laptopSicherung();
  setInterval(laptopSicherung, 60 * 60 * 1000);
  abgleichStarten('start');
  setInterval(() => abgleichStarten('takt'), 10 * 60 * 1000);
  naechsteMinute();
  zeichnen();
})();
