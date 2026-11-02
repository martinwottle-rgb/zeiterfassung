// Ansicht Dienstreisen: Reisen eines Jahres, nach Monat gruppiert (neueste oben), je Reise eine Karte.
// Antippen öffnet die Reise zum Bearbeiten, „Reise hinzufügen“ das Sheet für eine neue Reise.
// Am Laptop je Monat der Excel-Knopf (gleiche Funktion wie in der Monatsansicht).
// Zeit kommt nur aus kontext.heute.
import { alle } from './speicher.js';
import { reisekostenMonat, reisenGruppieren } from './reisen.js';
import { euro, landAnzeige, reiseOeffnen } from './reise_sheet.js';
import { reisekostenKnopfVerdrahten } from './reisekosten_knopf.js';
import { monatsname } from './zeit.js';

const PFEIL_LINKS = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';
const PFEIL_RECHTS = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

// Ausgabe nur escaped verwenden.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Jahr aus dem Hash (#reisen/2026), sonst das Jahr von heute
function jahrParameter(s, heuteText) {
  if (typeof s === 'string' && /^\d{4}$/.test(s)) return Number(s);
  return Number(heuteText.slice(0, 4));
}

// '2026-10-13' zu [2026, 10, 13]
function teile(datum) {
  return datum.split('-').map(Number);
}

// „13. bis 18. Oktober“. Über Monatsgrenzen steht der Monat je Datum, über Jahresgrenzen zusätzlich das Jahr.
// Ein Tag: „13. Oktober“.
function zeitraumText(von, bis) {
  const [j1, m1, t1] = teile(von);
  const [j2, m2, t2] = teile(bis);
  const mitJahr = j1 !== j2;
  const kurz = (t, m, j) => `${t}. ${monatsname(m)}${mitJahr ? ` ${j}` : ''}`;
  if (von === bis) return kurz(t1, m1, j1);
  if (m1 === m2 && j1 === j2) return `${t1}. bis ${t2}. ${monatsname(m2)}`;
  return `${kurz(t1, m1, j1)} bis ${kurz(t2, m2, j2)}`;
}

// „1 Tag“, „6 Tage“
function tageText(n) {
  return `${n} ${n === 1 ? 'Tag' : 'Tage'}`;
}

// Karte einer Reise: Anlass groß, darunter Land, Zeitraum, Tage; rechts die Summe.
function reiseKarte(g, nr) {
  return `<button type="button" class="karte reisen-karte" data-nr="${nr}">` +
    `<span class="reisen-text">` +
      `<span class="reisen-anlass">${esc(g.anlass || 'Ohne Anlass')}</span>` +
      `<span class="reisen-land">${esc(landAnzeige(g.land))}</span>` +
      `<span class="reisen-zeit">${esc(zeitraumText(g.von, g.bis))}</span>` +
      `<span class="reisen-tage">${esc(tageText(g.tage.length))}</span>` +
    `</span>` +
    `<span class="reisen-summe zahl">${esc(euro(g.summe))}</span>` +
    `</button>`;
}

// Abschnitt eines Monats: Überschrift mit Monatssumme, Karten, am Laptop der Excel-Knopf
function monatAbschnitt(key, gruppen, reise, laptop, nr) {
  const [j, m] = key.split('-').map(Number);
  const titel = `${monatsname(m)} ${j}`;
  const karten = gruppen.map((g) => reiseKarte(g, nr.wert++)).join('');
  const excel = laptop
    ? `<div class="karte-aktion reisen-aktion">` +
      `<button type="button" class="knopf haupt" data-excel${reise.tage.length === 0 ? ' disabled' : ''}>Reisekostentabelle erstellen</button>` +
      `<button type="button" class="knopf klein" data-ordner hidden>Ordner öffnen</button>` +
      `</div>` +
      `<p class="notiz reise-status" role="status" aria-live="polite" data-status></p>`
    : '';
  return `<section class="reisen-monat" data-monat="${esc(key)}" aria-labelledby="reisen-monat-${esc(key)}">` +
    `<header class="reisen-monat-kopf">` +
      `<h2 id="reisen-monat-${esc(key)}">${esc(titel)}</h2>` +
      `<p class="reisen-monat-summe zahl"><span class="notiz">Summe</span> ${esc(euro(reise.summe))}</p>` +
    `</header>` +
    `<div class="reisen-liste">${karten}</div>` +
    excel +
    `</section>`;
}

// Suche und Land: Gruppen, deren Anlass, Land oder ein Reisetag passt. Land als angezeigter Name, '' = alle.
export function reisenFiltern(gruppen, { suche = '', land = '' } = {}) {
  const s = String(suche ?? '').trim().toLowerCase();
  return (gruppen ?? []).filter((g) => {
    if (land && landAnzeige(g.land) !== land) return false;
    if (!s) return true;
    const texte = [g.anlass, g.land, ...(g.tage ?? []).flatMap((t) => [t.anlass, t.land])];
    return texte.some((t) => String(t ?? '').toLowerCase().includes(s));
  });
}

export async function zeigen(ziel, kontext) {
  const heuteText = kontext.heute;
  const jahr = jahrParameter(kontext.parameter, heuteText);
  const alleReisen = (kontext.daten.reisen ?? await alle('reisen')).filter((r) => !r.geloescht);

  // Reisen des Jahres nach Monat ihres Beginns; reisenGruppieren liefert aufsteigend nach von
  const gruppen = reisenGruppieren(alleReisen).filter((g) => g.von.startsWith(`${jahr}-`));
  // Länder des Jahres für die Auswahl
  const laender = [...new Set(gruppen.map((g) => landAnzeige(g.land)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const laptop = kontext.laptop === true;
  let suchText = '';
  let landWahl = '';

  const dieserJahr = jahr === Number(heuteText.slice(0, 4));
  ziel.innerHTML = `
    <header class="kopf glas">
      <div>
        <h1>Dienstreisen</h1>
        <p class="notiz zahl">${jahr}</p>
      </div>
      <nav class="aktionen" aria-label="Jahr wechseln">
        <a class="knopf knopf-rund" href="#reisen/${jahr - 1}" aria-label="Vorheriges Jahr">${PFEIL_LINKS}</a>
        ${dieserJahr ? '' : '<a class="knopf knopf-klein" href="#reisen">Dieses Jahr</a>'}
        <a class="knopf knopf-rund" href="#reisen/${jahr + 1}" aria-label="Nächstes Jahr">${PFEIL_RECHTS}</a>
        <button type="button" class="knopf knopf-haupt" data-reise-neu>Reise hinzufügen</button>
      </nav>
    </header>
    <div class="kontakte-sort-zeile">
      <div class="kontakt-suche">
        <input type="search" name="suche" placeholder="Suchen" aria-label="Reisen durchsuchen" autocomplete="off" enterkeyhint="search" data-suche>
      </div>
      <div class="kontakte-sort">
        <label class="kontakte-sort-name" for="reisen-land-feld">Land</label>
        <select id="reisen-land-feld" name="land">
          <option value="">Alle Länder</option>
        </select>
      </div>
    </div>
    <div data-liste></div>
  `;

  const liste = ziel.querySelector('[data-liste]');
  const suche = ziel.querySelector('[data-suche]');
  const landFeld = ziel.querySelector('#reisen-land-feld');
  for (const l of laender) landFeld.append(new Option(l, l));

  // Liste neu aufbauen: Monate ohne Treffer entfallen. Nur die Liste wird ersetzt, das Suchfeld behält Fokus und Wert.
  function listeZeichnen() {
    const treffer = reisenFiltern(gruppen, { suche: suchText, land: landWahl });
    const nachMonat = new Map();
    for (const g of treffer) {
      const key = g.von.slice(0, 7);
      if (!nachMonat.has(key)) nachMonat.set(key, []);
      nachMonat.get(key).push(g);
    }
    // Neueste Monate oben, innerhalb des Monats ebenfalls neueste zuerst
    const monatKeys = [...nachMonat.keys()].sort().reverse();

    const nr = { wert: 0 };
    const karteListe = [];
    const reiseJeMonat = new Map();
    let abschnitte = '';
    for (const key of monatKeys) {
      const reihe = nachMonat.get(key).slice().reverse();
      const [j, m] = key.split('-').map(Number);
      // Monatssumme und Excel-Tabelle immer über alle Reisen des Monats
      reiseJeMonat.set(key, reisekostenMonat(alleReisen, j, m));
      for (const g of reihe) karteListe.push(g);
      abschnitte += monatAbschnitt(key, reihe, reiseJeMonat.get(key), laptop, nr);
    }

    if (gruppen.length === 0) liste.innerHTML = `<p class="leer">Noch keine Dienstreisen in ${jahr}.</p>`;
    else if (treffer.length === 0) liste.innerHTML = '<p class="leer">Keine Reise gefunden.</p>';
    else liste.innerHTML = abschnitte;

    // Karten öffnen die Reise zum Bearbeiten
    liste.querySelectorAll('[data-nr]').forEach((karte) => {
      karte.addEventListener('click', () => {
        const g = karteListe[Number(karte.dataset.nr)];
        reiseOeffnen({ tage: g.tage }, kontext).catch((e) => console.error(e));
      });
    });

    if (laptop) {
      liste.querySelectorAll('.reisen-monat').forEach((box) => {
        const key = box.dataset.monat;
        reisekostenKnopfVerdrahten(box, reiseJeMonat.get(key), key);
      });
    }
  }

  suche.addEventListener('input', () => {
    suchText = suche.value;
    listeZeichnen();
  });
  landFeld.addEventListener('change', () => {
    landWahl = landFeld.value;
    listeZeichnen();
  });

  ziel.querySelector('[data-reise-neu]').addEventListener('click', () => {
    reiseOeffnen({}, kontext).catch((e) => console.error(e));
  });

  listeZeichnen();
}
