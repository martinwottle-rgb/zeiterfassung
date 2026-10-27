// Ansicht Kontakte: Kopf mit „Kontakt erfassen“, Suche (Name, Firma, Ort, Groß und Klein egal) und Sortierung
// (zuletzt erfasst, Nachname, Vorname, Firma, Ort). Abschnitte mit klebenden Überschriften.
// Hinweis und Filter für noch nicht geprüfte Kontakte. Jede Zeile zeigt Name, Firma und Ort sowie den
// Outlook-Zustand als Punkt mit Text für Screenreader, bei ungeprüften Kontakten stattdessen „ungeprüft“.
// Antippen öffnet das Detail. Die Liste kommt direkt aus dem Speicher (kontext.daten kennt keine Kontakte).
import { alle } from './speicher.js';
import { kontaktName } from './kontakte.js';
import { kontaktErfassen, kontaktSeiteZeichnen, outlookZustand } from './kontakt_sheet.js';
import { ausDatumText } from './zeit.js';

const SORTIERUNGEN = [
  { wert: 'erstellt', text: 'Zuletzt erfasst' },
  { wert: 'nachname', text: 'Nachname' },
  { wert: 'vorname', text: 'Vorname' },
  { wert: 'firma', text: 'Firma' },
  { wert: 'ort', text: 'Ort' },
];
const MERKEN = 'zeit.kontakteSort';
const vergleich = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

// Zähler für eindeutige Ids der Abschnittsüberschriften
let folge = 0;

// Gemerkte Sortierung lesen, sonst „Zuletzt erfasst“
function sortierungLesen() {
  try {
    const wert = localStorage.getItem(MERKEN);
    if (SORTIERUNGEN.some((s) => s.wert === wert)) return wert;
  } catch { /* Speicher nicht verfügbar: Vorgabe */ }
  return 'erstellt';
}

function sortierungMerken(wert) {
  try { localStorage.setItem(MERKEN, wert); } catch { /* nicht merkbar: egal */ }
}

const text = (s) => String(s ?? '').trim();
const tagVon = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const tagPlus = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Anzahl mit Einzahl und Mehrzahl
function anzahlText(n) {
  if (n === 0) return 'Noch keine Kontakte';
  return `${n} ${n === 1 ? 'Kontakt' : 'Kontakte'}`;
}

// Suchtext je Kontakt, klein geschrieben
function suchText(k) {
  return [kontaktName(k), k.firma, k.ort].filter(Boolean).join(' ').toLocaleLowerCase('de-DE');
}

// Vergleich über Nachname, dann Vorname (Gleichstand)
function namenVergleich(a, b) {
  return vergleich.compare(text(a.nachname), text(b.nachname)) || vergleich.compare(text(a.vorname), text(b.vorname));
}

// Erster Buchstabe ohne Akzent (Ä zu A); alles ohne Buchstabe oder leer gilt als „#“
function buchstabe(s) {
  const grund = text(s).normalize('NFD').replace(/\p{M}/gu, '').charAt(0).toLocaleUpperCase('de-DE');
  return /\p{L}/u.test(grund) ? grund : '#';
}

// Nachname oder Vorname: Buchstaben zuerst, dann „#“, leere Werte ganz ans Ende
function feldVergleich(feld, mitBuchstaben) {
  return (a, b) => {
    const wa = text(a[feld]);
    const wb = text(b[feld]);
    if (mitBuchstaben) {
      const d = Number(buchstabe(wa) === '#') - Number(buchstabe(wb) === '#');
      if (d) return d;
    }
    if (!wa !== !wb) return wa ? -1 : 1;
    return vergleich.compare(wa, wb) || namenVergleich(a, b);
  };
}

// Zuletzt erfasst: neueste oben, ohne Zeitstempel ganz ans Ende
function erstelltVergleich(a, b) {
  const ea = !(a.erstellt > 0);
  const eb = !(b.erstellt > 0);
  if (ea && eb) return namenVergleich(a, b);
  if (ea !== eb) return ea ? 1 : -1;
  return (b.erstellt - a.erstellt) || namenVergleich(a, b);
}

function vergleichFuer(wahl) {
  switch (wahl) {
    case 'nachname': return feldVergleich('nachname', true);
    case 'vorname': return feldVergleich('vorname', true);
    case 'firma': return feldVergleich('firma', false);
    case 'ort': return feldVergleich('ort', false);
    default: return erstelltVergleich;
  }
}

// Abschnitt zuletzt erfasst: Heute, Gestern, Diese Woche (ab Montag), sonst Monat und Jahr
function erfassungsAbschnitt(erstellt, heuteTag) {
  if (!(erstellt > 0)) return { schluessel: 'ohne', titel: 'Ohne Datum' };
  const tag = tagVon(new Date(erstellt));
  if (tag >= heuteTag) return { schluessel: 'heute', titel: 'Heute' };
  if (tag.getTime() === tagPlus(heuteTag, -1).getTime()) return { schluessel: 'gestern', titel: 'Gestern' };
  const montag = tagPlus(heuteTag, -((heuteTag.getDay() + 6) % 7));
  if (tag >= montag) return { schluessel: 'woche', titel: 'Diese Woche' };
  const monat = tag.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return { schluessel: `m:${tag.getFullYear()}-${tag.getMonth()}`, titel: monat };
}

// Abschnitt nach Buchstabe (Nachname, Vorname)
function buchstabenAbschnitt(s) {
  const b = buchstabe(s);
  return { schluessel: `b:${b}`, titel: b };
}

// Abschnitt nach Firma oder Ort, ohne Wert eigener Abschnitt
function wertAbschnitt(s, ohne) {
  const w = text(s);
  return w ? { schluessel: `w:${w.toLocaleLowerCase('de-DE')}`, titel: w } : { schluessel: 'ohne', titel: ohne };
}

function abschnittVon(k, wahl, heuteTag) {
  switch (wahl) {
    case 'nachname': return buchstabenAbschnitt(k.nachname);
    case 'vorname': return buchstabenAbschnitt(k.vorname);
    case 'firma': return wertAbschnitt(k.firma, 'Ohne Firma');
    case 'ort': return wertAbschnitt(k.ort, 'Ohne Ort');
    default: return erfassungsAbschnitt(k.erstellt, heuteTag);
  }
}

// Zeilentext je Sortierung: Vorname Nachname, Nachname, Vorname; sonst der Anzeigename
function zeilenTitel(k, wahl) {
  const vn = text(k.vorname);
  const nn = text(k.nachname);
  if (wahl === 'vorname' && (vn || nn)) return [vn, nn].filter(Boolean).join(' ');
  if (wahl === 'nachname' && nn) return vn ? `${nn}, ${vn}` : nn;
  return kontaktName(k);
}

// Eine Zeile als Link auf #kontakte/<id>: Name, darunter Firma und Ort, rechts der Outlook-Punkt oder „ungeprüft“
function zeileBauen(k, wahl) {
  const zeile = document.createElement('a');
  zeile.href = '#kontakte/' + encodeURIComponent(k.id);
  zeile.className = 'liste-zeile kontakt-zeile';

  const textBlock = document.createElement('span');
  textBlock.className = 'liste-text';
  const titel = document.createElement('span');
  titel.className = 'liste-titel';
  titel.textContent = zeilenTitel(k, wahl);
  textBlock.append(titel);
  const unter = [k.firma, k.ort].filter(Boolean).join(' · ');
  if (unter) {
    const zeileUnter = document.createElement('span');
    zeileUnter.className = 'liste-unter';
    zeileUnter.textContent = unter;
    textBlock.append(zeileUnter);
  }

  const outlook = document.createElement('span');
  outlook.className = 'kontakt-outlook';
  if (k.geprueft !== true) {
    const ungeprueft = document.createElement('span');
    ungeprueft.className = 'kontakte-sort-ungeprueft';
    ungeprueft.textContent = 'ungeprüft';
    outlook.append(ungeprueft);
  } else {
    const o = outlookZustand(k);
    if (o.art === 'fehler' && o.meldung) outlook.title = o.meldung;
    const punkt = document.createElement('span');
    punkt.className = `kontakt-punkt ${o.art}`;
    punkt.setAttribute('aria-hidden', 'true');
    const sr = document.createElement('span');
    sr.className = 'nur-sr';
    sr.textContent = o.text;
    outlook.append(punkt, sr);
  }

  zeile.append(textBlock, outlook);
  return zeile;
}

// Abschnitt mit klebender Überschrift und Liste; die Liste ist per aria-labelledby benannt
function abschnittBauen(titel) {
  folge += 1;
  const id = `kontakte-sort-kopf-${folge}`;
  const box = document.createElement('div');
  box.className = 'kontakte-sort-abschnitt';
  const kopf = document.createElement('h2');
  kopf.className = 'kontakte-sort-kopf';
  kopf.id = id;
  kopf.textContent = titel;
  const ul = document.createElement('ul');
  ul.className = 'liste kontakte-sort-liste';
  ul.setAttribute('aria-labelledby', id);
  box.append(kopf, ul);
  return { box, ul };
}

export async function zeigen(ziel, kontext) {
  // Route #kontakte/<id>: Detailseite. Unbekannte oder gelöschte Ids zeigen einen Hinweis.
  if (kontext?.parameter) {
    const id = kontext.parameter;
    const gefunden = (await alle('kontakte')).find((k) => String(k.id) === id && !k.geloescht) ?? null;
    await kontaktSeiteZeichnen(ziel, gefunden, kontext);
    return;
  }
  const kontakte = (await alle('kontakte')).filter((k) => !k.geloescht);
  const heuteTag = tagVon(kontext?.heute ? ausDatumText(kontext.heute) : new Date());
  const ungeprueftAnzahl = kontakte.filter((k) => k.geprueft !== true).length;
  let nurUngeprueft = false;

  ziel.innerHTML = `
    <header class="kopf glas">
      <div>
        <h1>Kontakte</h1>
        <p class="notiz zahl" data-anzahl></p>
      </div>
      <nav class="aktionen" aria-label="Kontakte">
        <button type="button" class="knopf haupt" data-erfassen>Kontakt erfassen</button>
      </nav>
    </header>
    <div class="kontakte-sort-zeile">
      <div class="kontakt-suche">
        <label class="nur-sr" for="kontakt-suche-feld">Kontakte suchen</label>
        <input type="search" id="kontakt-suche-feld" name="suche" placeholder="Name, Firma oder Ort" autocomplete="off" enterkeyhint="search">
      </div>
      <div class="kontakte-sort">
        <label class="kontakte-sort-name" for="kontakte-sort-feld">Sortieren</label>
        <select id="kontakte-sort-feld" name="sortieren">${SORTIERUNGEN.map((s) => `<option value="${s.wert}">${s.text}</option>`).join('')}</select>
      </div>
    </div>
    <button type="button" class="kontakte-sort-hinweis" data-hinweis hidden></button>
    <div class="kontakte-sort-liste-bereich" data-liste></div>
  `;

  ziel.querySelector('[data-anzahl]').textContent = anzahlText(kontakte.length);
  ziel.querySelector('[data-erfassen]').addEventListener('click', () => kontaktErfassen(kontext));

  const liste = ziel.querySelector('[data-liste]');
  const suche = ziel.querySelector('#kontakt-suche-feld');
  const sortWahl = ziel.querySelector('#kontakte-sort-feld');
  const hinweis = ziel.querySelector('[data-hinweis]');
  sortWahl.value = sortierungLesen();

  // Hinweis oben über der Liste, solange ungeprüfte Kontakte da sind oder der Filter an ist
  function hinweisZeichnen() {
    hinweis.hidden = !(ungeprueftAnzahl > 0 || nurUngeprueft);
    hinweis.replaceChildren();
    const titelText = nurUngeprueft
      ? 'Alle anzeigen'
      : `${anzahlText(ungeprueftAnzahl)} noch nicht geprüft`;
    const unterText = nurUngeprueft
      ? 'Es sind nur ungeprüfte Kontakte zu sehen.'
      : 'Mit neuer Erkennung neu einlesen und prüfen, dann gehen sie nach Outlook.';
    const t = document.createElement('span');
    t.className = 'kontakte-sort-hinweis-titel';
    t.textContent = titelText;
    const u = document.createElement('span');
    u.className = 'kontakte-sort-hinweis-unter';
    u.textContent = unterText;
    hinweis.append(t, u);
  }

  // Abschnittsüberschriften kleben unter dem Kopf: Abstand aus Kopfhöhe und Kopfposition
  function klebeOffset() {
    const kopf = ziel.querySelector('.kopf');
    if (!kopf) return;
    const oben = parseFloat(getComputedStyle(kopf).top) || 0;
    ziel.style.setProperty('--kontakte-sort-oben', `${oben + kopf.offsetHeight + 8}px`);
  }

  function listeZeichnen() {
    const q = suche.value.trim().toLocaleLowerCase('de-DE');
    const wahl = sortWahl.value;
    const basis = nurUngeprueft ? kontakte.filter((k) => k.geprueft !== true) : kontakte;
    const treffer = (q ? basis.filter((k) => suchText(k).includes(q)) : basis.slice())
      .sort(vergleichFuer(wahl));
    liste.replaceChildren();
    if (kontakte.length === 0) {
      const leer = document.createElement('p');
      leer.className = 'leer';
      leer.textContent = 'Noch keine Kontakte. Fotografiere eine Visitenkarte, um zu beginnen.';
      liste.append(leer);
      return;
    }
    if (treffer.length === 0) {
      const leer = document.createElement('p');
      leer.className = 'leer';
      leer.textContent = nurUngeprueft && !q
        ? 'Alle Kontakte sind geprüft.'
        : 'Kein Kontakt passt zur Suche.';
      liste.append(leer);
      return;
    }
    let abschnitt = null;
    let schluesselLetzter = null;
    for (const k of treffer) {
      const a = abschnittVon(k, wahl, heuteTag);
      if (!abschnitt || a.schluessel !== schluesselLetzter) {
        abschnitt = abschnittBauen(a.titel);
        liste.append(abschnitt.box);
        schluesselLetzter = a.schluessel;
      }
      const eintrag = document.createElement('li');
      eintrag.append(zeileBauen(k, wahl));
      abschnitt.ul.append(eintrag);
    }
  }

  suche.addEventListener('input', listeZeichnen);
  sortWahl.addEventListener('change', () => {
    sortierungMerken(sortWahl.value);
    listeZeichnen();
  });
  hinweis.addEventListener('click', () => {
    nurUngeprueft = !nurUngeprueft;
    hinweisZeichnen();
    listeZeichnen();
  });

  hinweisZeichnen();
  listeZeichnen();
  klebeOffset();
  const kopf = ziel.querySelector('.kopf');
  if (kopf && 'ResizeObserver' in window) new ResizeObserver(klebeOffset).observe(kopf);
}
