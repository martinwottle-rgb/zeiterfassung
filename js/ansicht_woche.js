// Ansicht Woche: sieben Tage ab Montag, Balken von 6 bis 20 Uhr, Summen unten.
// Zeit kommt nur aus kontext.heute und kontext.jetzt.
import { addTage, ausDatumText, datumText, dauer, dauerMitVorzeichen, kalenderwoche, langesDatum, monatsname, wochenbeginn, wochentag } from './zeit.js';
import { tagesInfo } from './rechnen.js';
import { tagOeffnen } from './tag_sheet.js';
import { pcVorschlaege, pcUebernehmen } from './vorschlaege.js';
import { zeitSegment } from './zeit_segment.js';

let ladeNr = 0; // nur das neueste Laden darf Vorschläge eintragen

const KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ABWESENHEIT = { urlaub: 'Urlaub', krank: 'Krank', ueberstunden: 'Überstundenabbau', sonstiges: 'Abwesend' };
const VON = 360;  // 6 Uhr in Minuten
const BIS = 1200; // 20 Uhr in Minuten

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

function zweistellig(n) {
  return String(n).padStart(2, '0');
}

// Gültiger Datumstext 'JJJJ-MM-TT' oder null.
function gueltigesDatum(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return datumText(ausDatumText(s)) === s ? s : null;
}

// Zeitraum der Woche: „19. bis 25. Oktober 2026“, über Monatsgrenze „28. September bis 4. Oktober 2026“.
function wochenText(montag) {
  const sonntag = addTage(montag, 6);
  const [j1, m1, t1] = montag.split('-').map(Number);
  const [j2, m2, t2] = sonntag.split('-').map(Number);
  if (j1 !== j2) return `${t1}. ${monatsname(m1)} ${j1} bis ${t2}. ${monatsname(m2)} ${j2}`;
  if (m1 !== m2) return `${t1}. ${monatsname(m1)} bis ${t2}. ${monatsname(m2)} ${j2}`;
  return `${t1}. bis ${t2}. ${monatsname(m2)} ${j2}`;
}

// Zählt ein Tag schon zum Saldo bis heute? Vergangene Tage ja; heute erst nach „Gehen“.
function saldoZaehlt(t, heuteText) {
  if (t.datum < heuteText) return true;
  return t.datum === heuteText && t.zustand === 'gegangen';
}

// Etikett eines Tages: Feiertag, Abwesenheit, jeweils unescaped (Aufrufer escaped).
function etikettTeile(t) {
  const teile = [];
  if (t.vorStart) teile.push('vor Beginn der Erfassung');
  if (t.feiertag) teile.push(t.feiertag);
  if (t.abwesenheit) {
    let text = ABWESENHEIT[t.abwesenheit.art] || 'Abwesend';
    if (t.abwesenheit.halbtag) text += ', halber Tag';
    teile.push(text);
  }
  return teile;
}

// Balken eines Tages: Blöcke innerhalb 6 bis 20 Uhr, offener Block nur heute bis `jetzt`.
function balken(t, heuteText, jetzt) {
  return t.bloecke.map((b) => {
    let ende = b.ende;
    const laeuft = ende === null;
    if (laeuft) {
      if (t.datum !== heuteText || typeof jetzt !== 'number') return '';
      ende = jetzt;
    }
    const von = Math.max(VON, b.beginn);
    const bis = Math.min(BIS, ende);
    if (bis <= von) return '';
    const links = ((von - VON) / (BIS - VON)) * 100;
    const breite = ((bis - von) / (BIS - VON)) * 100;
    return `<span class="block ${laeuft ? 'laeuft' : 'arbeit'}" style="left: ${links.toFixed(2)}%; width: ${breite.toFixed(2)}%;"></span>`;
  }).join('');
}

// Vorschlag im Balken: gestrichelt, Lage wie bei den Blöcken. Nur Zahlen, daher ohne Escaping.
function vorschlagBalken(bloecke) {
  return bloecke.map((b) => {
    const von = Math.max(VON, b.beginn);
    const bis = Math.min(BIS, b.ende);
    if (bis <= von) return '';
    const links = ((von - VON) / (BIS - VON)) * 100;
    const breite = ((bis - von) / (BIS - VON)) * 100;
    return `<span class="block vorschlag" style="left: ${links.toFixed(2)}%; width: ${breite.toFixed(2)}%;"></span>`;
  }).join('');
}

// Zeile: Öffnen-Fläche und Platz für die Kapsel „Vorschlag übernehmen“ (Kapsel ist kein Teil des Knopfes, daher kein Knopf in Knopf).
function zeileHtml(t, heuteText, jetzt) {
  const wt = wochentag(t.datum);
  const [, m, tag] = t.datum.split('-').map(Number);
  const teile = etikettTeile(t);
  const etikett = teile.length ? `<span class="liste-unter">${teile.map(esc).join(', ')}</span>` : '';
  const saldo = saldoZaehlt(t, heuteText) && !t.vorStart
    ?`<span class="zahl zahl-block">${dauerMitVorzeichen(t.saldo)}</span>`
    : '';
  return `<div class="liste-zeile zeile-woche" data-zeile="${t.datum}">` +
    `<button type="button" class="zeile-oeffnen" data-datum="${t.datum}">` +
      `<span class="liste-text liste-text-fest">` +
        `<span class="liste-titel">${KURZ[wt]} ${zweistellig(tag)}.${zweistellig(m)}.</span>${etikett}` +
      `</span>` +
      `<span class="zeitleiste wochen-balken" aria-hidden="true">${balken(t, heuteText, jetzt)}</span>` +
      `<span class="liste-wert"><span class="zahl zahl-block">${dauer(t.ist)}</span>${saldo}</span>` +
    `</button>` +
  `</div>`;
}

// PC-Vorschläge nachladen: gestrichelter Balken und eine Kapsel je Tag. Ältere Ladevorgänge werden verworfen.
async function vorschlaegeEintragen(ziel, kontext) {
  const merk = ++ladeNr;
  let liste = [];
  try {
    liste = await pcVorschlaege(kontext);
  } catch {
    return;
  }
  if (merk !== ladeNr) return;
  for (const v of liste) {
    const zeile = ziel.querySelector(`[data-zeile="${v.datum}"]`);
    const balkenEl = zeile?.querySelector('.wochen-balken');
    if (!zeile || !balkenEl) continue;
    balkenEl.insertAdjacentHTML('beforeend', vorschlagBalken(v.bloecke));
    zeile.classList.add('hat-vorschlag');
    const kapsel = document.createElement('button');
    kapsel.type = 'button';
    kapsel.className = 'vorschlag-kapsel';
    kapsel.textContent = 'Vorschlag übernehmen';
    kapsel.setAttribute('aria-label', `Vorschlag für ${langesDatum(v.datum)} übernehmen`);
    kapsel.addEventListener('click', async () => {
      kapsel.disabled = true;
      try {
        await pcUebernehmen(v); // daten-geaendert zeichnet die Woche danach neu
      } catch {
        kapsel.disabled = false;
        kapsel.textContent = 'Nicht übernommen';
      }
    });
    zeile.append(kapsel);
  }
}

export async function zeigen(ziel, kontext) {
  const heuteText = kontext.heute;
  const jetzt = kontext.jetzt;
  const { bloecke, abwesenheiten: abw, einstellungen: einst } = kontext.daten;

  const montag = wochenbeginn(gueltigesDatum(kontext.parameter) || heuteText);
  const tage = [];
  for (let i = 0; i < 7; i++) {
    const d = addTage(montag, i);
    tage.push(tagesInfo(bloecke, abw, einst, d, d === heuteText ? jetzt : undefined));
  }

  let istSumme = 0;
  let sollSumme = 0;
  let saldoSumme = 0;
  for (const t of tage) {
    istSumme += t.ist;
    sollSumme += t.soll;
    if (saldoZaehlt(t, heuteText)) saldoSumme += t.saldo; // vor Start ist saldo 0
  }

  const aktuell = montag === wochenbeginn(heuteText);
  const kw = kalenderwoche(montag);
  const vorige = addTage(montag, -7);
  const naechste = addTage(montag, 7);

  const zeilen = tage.map((t) => zeileHtml(t, heuteText, jetzt)).join('');

  ziel.innerHTML = `
    <header class="kopf glas">
      <div>
        <h1>Woche ${kw}</h1>
        <p class="notiz">${esc(wochenText(montag))}</p>
      </div>
      <nav class="aktionen" aria-label="Woche wechseln">
        <a class="knopf knopf-rund" href="#woche/${vorige}" aria-label="Vorige Woche">${PFEIL_LINKS}</a>
        ${aktuell ? '' : '<a class="knopf knopf-klein" href="#woche">Heute</a>'}
        <a class="knopf knopf-rund" href="#woche/${naechste}" aria-label="Nächste Woche">${PFEIL_RECHTS}</a>
      </nav>
    </header>

    <section class="liste" aria-label="Tage der Woche">${zeilen}</section>

    <section class="karte" aria-labelledby="woche-summe">
      <h2 id="woche-summe">Summe der Woche</h2>
      <div class="saldo"><span>Ist</span><strong class="zahl">${dauer(istSumme)}</strong></div>
      <div class="saldo"><span>Soll, ganze Woche</span><strong class="zahl">${dauer(sollSumme)}</strong></div>
      <div class="saldo"><span>Saldo bis heute</span><strong class="zahl">${dauerMitVorzeichen(saldoSumme)}</strong></div>
    </section>
  `;

  ziel.prepend(zeitSegment('woche'));
  const liste = ziel.querySelector('.liste');
  liste.addEventListener('click', (e) => {
    const zeile = e.target.closest('button[data-datum]');
    if (zeile) tagOeffnen(zeile.dataset.datum, kontext);
  });

  if (kontext.daten.einstellungen && kontext.daten.einstellungen.name) {
    ziel.dataset.name = kontext.daten.einstellungen.name;
  } else {
    delete ziel.dataset.name;
  }

  // Vorschläge vom Laptop nachladen (am iPhone passiert nichts)
  if (kontext.laptop) vorschlaegeEintragen(ziel, kontext);
}
