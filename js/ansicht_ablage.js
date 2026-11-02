// Ansicht Ablage (#ablage): Fotos und Dokumente zwischen Handy und Laptop. Neueste zuerst, Antippen klappt einen
// Eintrag auf. Am Laptop ist der ganze Inhalt eine Ablagefläche für Dateien. Beim Öffnen gelten alle Einträge als gesehen.
import { alle, loeschen } from './speicher.js';
import { dateiHerunterladen, dateiLaden } from './ablage.js';
import { ablegenOeffnen, dateienZiehen, groesseText } from './ablage_sheet.js';

const GESEHEN_MERKEN = 'ablage-gesehen';
const NOCH_NICHT_DA = 'Die Datei ist noch nicht da. Bitte gleich noch einmal versuchen.';
const OHNE_ZUORDNUNG = 'Ohne Zuordnung';

const txt = (s) => String(s ?? '').trim();

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Neueste Einträge zuerst, gelöschte (Grabsteine) weg. Gibt eine neue Liste zurück.
export function ablageSortiert(liste) {
  return (liste ?? [])
    .filter((e) => e && !e.geloescht)
    .sort((a, b) => (b.erstellt ?? 0) - (a.erstellt ?? 0));
}

// Zeitpunkt als „TT.MM.JJJJ HH:MM“
export function datumUhr(ms) {
  const d = new Date(ms);
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getDate())}.${z(d.getMonth() + 1)}.${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

// Titel eines Eintrags: Firma oder „Ohne Zuordnung“, dahinter die Art
export function eintragTitel(e) {
  const firma = txt(e.firma) || OHNE_ZUORDNUNG;
  const art = txt(e.art);
  return art ? `${firma} · ${art}` : firma;
}

export function dateienAnzahl(n) {
  return n === 1 ? '1 Datei' : `${n} Dateien`;
}

// Ids der Einträge, die beim letzten Öffnen der Ansicht gesehen wurden
export function gesehenLesen() {
  try {
    const liste = JSON.parse(localStorage.getItem(GESEHEN_MERKEN) ?? '[]');
    return new Set(Array.isArray(liste) ? liste : []);
  } catch {
    return new Set();
  }
}

export function gesehenSpeichern(ids) {
  try {
    localStorage.setItem(GESEHEN_MERKEN, JSON.stringify(ids));
  } catch {
    // nicht merkbar: egal, dann bleiben die Hinweise eben stehen
  }
}

// Meldung unter einem Eintrag (Text setzen und zeigen)
function melden(meldung, text) {
  meldung.textContent = text;
  meldung.hidden = false;
}

// Bild im Sheet ansehen (Vorschau)
function bildZeigen(kontext, name, url) {
  const bild = el('img', 'ablage-bild-gross');
  bild.alt = name;
  bild.src = url;
  const huelle = el('div', 'ablage-bild-huelle');
  huelle.append(bild);
  kontext.sheet.oeffnen(name, huelle, { ohneRueckfrage: true });
}

// Öffnen: Bilder in der Vorschau im Sheet, andere Dateien in einem neuen Tab
async function dateiOeffnen(datei, meldung, kontext) {
  meldung.hidden = true;
  const istBild = /^image\//.test(datei.typ ?? '');
  // Das neue Tab muss im Klick entstehen, sonst blockt der Browser es nach dem Laden
  const tab = istBild ? null : window.open('', '_blank');
  try {
    const blob = await dateiLaden(datei);
    if (!blob) throw new Error(NOCH_NICHT_DA);
    const url = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (istBild) {
      bildZeigen(kontext, datei.name, url);
      return;
    }
    if (!tab) throw new Error('Der Browser hat das neue Fenster verhindert. Bitte „Herunterladen“ nutzen.');
    tab.location.href = url;
  } catch (e) {
    tab?.close();
    melden(meldung, e?.message || 'Die Datei konnte nicht geöffnet werden.');
  }
}

async function dateiHerunterladenKlick(datei, meldung) {
  meldung.hidden = true;
  try {
    await dateiHerunterladen(datei);
  } catch (e) {
    melden(meldung, e?.message || 'Die Datei konnte nicht geladen werden.');
  }
}

// Eine Datei des Eintrags: Name, Größe und die Knöpfe
function dateiZeile(datei, meldung, kontext) {
  const name = txt(datei.name) || 'Datei';
  const li = el('li', 'ablage-datei');
  const text = el('span', 'ablage-datei-text');
  text.append(el('span', 'liste-titel', name), el('span', 'liste-unter', groesseText(datei.groesse)));

  const oeffnen = el('button', 'knopf knopf-karte', 'Öffnen');
  oeffnen.type = 'button';
  oeffnen.setAttribute('aria-label', `${name} öffnen`);
  oeffnen.addEventListener('click', () => dateiOeffnen(datei, meldung, kontext));

  const herunter = el('button', 'knopf knopf-karte', 'Herunterladen');
  herunter.type = 'button';
  herunter.setAttribute('aria-label', `${name} herunterladen`);
  herunter.addEventListener('click', () => dateiHerunterladenKlick(datei, meldung));

  const knoepfe = el('div', 'ablage-datei-knoepfe');
  knoepfe.append(oeffnen, herunter);
  li.append(text, knoepfe);
  return li;
}

// Am Laptop: den Ordner im Dokumente-Eingang öffnen
async function ordnerOeffnen(eintrag, meldung) {
  meldung.hidden = true;
  try {
    const antwort = await fetch('/api/ordner-oeffnen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pfad: eintrag.eingang.ordner }),
    });
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  } catch (e) {
    console.warn('Ordner nicht geöffnet:', e?.message);
    melden(meldung, 'Der Ordner konnte nicht geöffnet werden.');
  }
}

// Löschen: erst die Rückfrage, dann der Grabstein (30 Tage im Papierkorb)
function loeschenZone(eintrag, meldung) {
  const zone = el('div', 'ablage-loeschen');
  const start = el('button', 'knopf gefahr knopf-karte', 'Löschen');
  start.type = 'button';

  const ja = el('button', 'knopf gefahr knopf-karte', 'Ja, löschen');
  ja.type = 'button';
  const nein = el('button', 'knopf knopf-karte', 'Nein, behalten');
  nein.type = 'button';

  start.addEventListener('click', () => {
    const frage = el('p', 'notiz', 'Wirklich löschen? Er liegt danach 30 Tage im Papierkorb.');
    const reihe = el('div', 'karte-aktion');
    reihe.append(ja, nein);
    zone.replaceChildren(frage, reihe);
    nein.focus();
  });
  nein.addEventListener('click', () => zone.replaceChildren(start));
  ja.addEventListener('click', async () => {
    ja.disabled = true;
    nein.disabled = true;
    try {
      // Die Ansicht zeichnet sich nach dem Speichern selbst neu (daten-geaendert)
      await loeschen('ablage', eintrag.id);
    } catch (e) {
      console.error(e);
      ja.disabled = false;
      nein.disabled = false;
      melden(meldung, 'Löschen hat nicht geklappt. Bitte noch einmal versuchen.');
    }
  });
  zone.append(start);
  return zone;
}

// Aufgeklappter Inhalt eines Eintrags: Notiz, Dateien, Ordner (Laptop), Löschen
function inhaltBauen(eintrag, kontext) {
  const box = el('div', 'ablage-inhalt');
  const meldung = el('p', 'notiz fehler');
  meldung.setAttribute('role', 'status');
  meldung.hidden = true;

  if (txt(eintrag.notiz)) box.append(el('p', 'ablage-notiz', txt(eintrag.notiz)));

  const dateien = el('ul', 'ablage-dateien');
  for (const datei of eintrag.dateien ?? []) dateien.append(dateiZeile(datei, meldung, kontext));
  box.append(dateien);

  const aktionen = el('div', 'karte-aktion');
  if (kontext.laptop && eintrag.eingang) {
    const ordner = el('button', 'knopf knopf-karte', 'Ordner öffnen');
    ordner.type = 'button';
    ordner.addEventListener('click', () => ordnerOeffnen(eintrag, meldung));
    aktionen.append(ordner);
  }
  box.append(aktionen, loeschenZone(eintrag, meldung), meldung);
  return box;
}

// Ein Eintrag der Liste: zugeklappt Titel und Unterzeile, aufgeklappt der Inhalt
function eintragBauen(eintrag, kontext) {
  const li = el('li');
  const details = el('details', 'ablage-eintrag');
  const kopf = el('summary', 'liste-zeile ablage-kopf');
  const text = el('span', 'liste-text');
  text.append(el('span', 'liste-titel', eintragTitel(eintrag)));
  const unter = [
    datumUhr(eintrag.erstellt ?? 0),
    eintrag.quelle === 'laptop' ? 'vom Laptop' : 'vom iPhone',
    dateienAnzahl((eintrag.dateien ?? []).length),
    eintrag.eingang ? 'im Eingang' : '',
  ].filter(Boolean).join(' · ');
  text.append(el('span', 'liste-unter', unter));
  kopf.append(text);
  details.append(kopf, inhaltBauen(eintrag, kontext));
  li.append(details);
  return li;
}

export async function zeigen(ziel, kontext) {
  const liste = ablageSortiert(await alle('ablage'));

  const flaeche = el('div', 'ablage-flaeche');

  const kopf = el('header', 'kopf glas');
  const titel = el('div');
  titel.append(el('h1', null, 'Ablage'));
  const anzahl = el('p', 'notiz zahl', liste.length === 1 ? '1 Eintrag' : `${liste.length} Einträge`);
  titel.append(anzahl);
  const ablegen = el('button', 'knopf haupt', kontext.laptop ? 'Datei aufs Handy' : 'Ablegen');
  ablegen.type = 'button';
  ablegen.addEventListener('click', () => ablegenOeffnen(kontext));
  const aktion = el('nav', 'aktionen');
  aktion.setAttribute('aria-label', 'Ablage');
  aktion.append(ablegen);
  kopf.append(titel, aktion);
  flaeche.append(kopf);

  if (kontext.laptop) flaeche.append(el('p', 'notiz ablage-ziehen-hinweis', 'Dateien hierher ziehen'));

  if (liste.length === 0) {
    flaeche.append(el('p', 'leer', 'Noch nichts abgelegt.'));
  } else {
    const ul = el('ul', 'liste ablage-liste');
    for (const eintrag of liste) ul.append(eintragBauen(eintrag, kontext));
    flaeche.append(ul);
  }

  ziel.replaceChildren(flaeche);
  // Alles Gezeigte gilt als gesehen (die Karte auf Heute zählt dann nichts mehr)
  gesehenSpeichern(liste.map((e) => e.id));
  // Die Fläche gehört zu dieser Zeichnung: beim Neuzeichnen oder Verlassen fällt sie mit weg
  if (kontext.laptop) dateienZiehen(flaeche, kontext);
}
