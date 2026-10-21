// Ansicht Monat: Kennzahlen, Stundenzettel als Tabelle mit Wochensummen, Knopf zum Drucken.
// Zeit kommt nur aus kontext.heute und kontext.jetzt.
import { addTage, dauer, dauerMitVorzeichen, kalenderwoche, monatsname, tageImMonat, uhrzeit, wochentag } from './zeit.js';
import { kontostand, tagesInfo } from './rechnen.js';
import { tagOeffnen } from './tag_sheet.js';
import { alle } from './speicher.js';
import { reisekostenMonat, verpflegung } from './reisen.js';
import { euro, kurzesDatum, landAnzeige, reiseOeffnen } from './reise_sheet.js';

const KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ABWESENHEIT = { urlaub: 'Urlaub', krank: 'Krank', ueberstunden: 'Überstundenabbau', sonstiges: 'Abwesend' };

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

// Parameter 'JJJJ-MM' oder aktueller Monat aus heute. Liefert [jahr, monat 1 bis 12].
function monatsParameter(s, heuteText) {
  const treffer = typeof s === 'string' ? /^(\d{4})-(\d{2})$/.exec(s) : null;
  if (treffer && Number(treffer[2]) >= 1 && Number(treffer[2]) <= 12) {
    return [Number(treffer[1]), Number(treffer[2])];
  }
  const [j, m] = heuteText.split('-').map(Number);
  return [j, m];
}

// Monat als Parameter, z. B. '2026-09'.
function monatText(jahr, monat) {
  return `${jahr}-${zweistellig(monat)}`;
}

// Etikett eines Tages: Feiertag und Abwesenheit, unescaped.
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

function karte(titel, inhalt) {
  return `<section class="karte nicht-drucken"><h2>${esc(titel)}</h2><p class="kennzahl zahl">${inhalt}</p></section>`;
}

// Abschnitt Reisekosten: Kennzahlen, Reisetage (Zeile öffnet den Tag), Knöpfe. Nur am Bildschirm.
function reiseAbschnitt(reise, laptop) {
  const kennzahlen = [
    ['Reisetage', String(reise.tage.length)],
    ['Verpflegung', euro(reise.verpflegung)],
    ['Übernachtung', euro(reise.uebernachtung)],
    ['Fahrt', euro(reise.fahrt)],
    ['Nebenkosten', euro(reise.neben)],
    ['Summe', euro(reise.summe)],
  ];
  const kennzahlenHtml = kennzahlen
    .map(([name, wert]) => `<div><dt>${esc(name)}</dt><dd class="zahl">${esc(wert)}</dd></div>`)
    .join('');

  const tageHtml = reise.tage.length === 0
    ? '<p class="notiz">Keine Reisetage in diesem Monat.</p>'
    : `<div class="liste reise-tage">${reise.tage.map((t) => {
      const v = verpflegung(t);
      const zeit = `${uhrzeit(t.beginn)} bis ${uhrzeit(t.ende)}`;
      const anlass = t.anlass ? `${t.anlass}, ${zeit}` : zeit;
      return `<button type="button" class="liste-zeile reise-tag" data-datum="${esc(t.datum)}">` +
        `<span class="liste-text"><span class="liste-titel">${esc(kurzesDatum(t.datum))}, ${esc(landAnzeige(t.land))}</span>` +
        `<span class="liste-unter">${esc(anlass)}</span></span>` +
        `<span class="liste-wert zahl">${v === null ? 'offen' : esc(euro(v))}</span>` +
        `</button>`;
    }).join('')}</div>`;

  const excelKnopf = laptop
    ? `<button type="button" class="knopf haupt" data-excel${reise.tage.length === 0 ? ' disabled' : ''}>Reisekostentabelle erstellen</button>`
    : '';

  return `<section class="karte nicht-drucken reise-abschnitt" aria-labelledby="reise-titel">` +
    `<h2 id="reise-titel">Reisekosten</h2>` +
    `<dl class="reise-kennzahlen">${kennzahlenHtml}</dl>` +
    tageHtml +
    `<div class="karte-aktion">` +
    `<button type="button" class="knopf" data-reise-neu>Reise eintragen</button>` +
    excelKnopf +
    `<button type="button" class="knopf klein" data-ordner hidden>Ordner öffnen</button>` +
    `</div>` +
    `<p class="notiz reise-status" role="status" aria-live="polite" data-status></p>` +
    `</section>`;
}

// Erster Werktag des Monats, im laufenden Monat heute
function reiseVon(jahr, monat, heuteText) {
  if (monatText(jahr, monat) === heuteText.slice(0, 7)) return heuteText;
  return tageImMonat(jahr, monat).find((d) => wochentag(d) < 5) ?? heuteText;
}

// Reisekostentabelle über den lokalen Server erstellen (nur am Laptop)
async function reisekostentabelleErstellen(reise, monat, knopf, status, ordnerKnopf) {
  const tage = reise.tage.map(({ id, geaendert, geloescht, ...rest }) => rest);
  knopf.disabled = true;
  knopf.textContent = 'Excel arbeitet …';
  status.textContent = '';
  status.classList.remove('fehler');
  ordnerKnopf.hidden = true;
  try {
    const antwort = await fetch('/api/reisekosten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monat, tage }),
      cache: 'no-store',
    });
    const daten = await antwort.json().catch(() => null);
    if (!antwort.ok || !daten?.datei) {
      status.textContent = daten?.fehler ?? 'Die Reisekostentabelle konnte nicht erstellt werden.';
      status.classList.add('fehler');
      return;
    }
    const name = String(daten.datei).split(/[\\/]/).pop();
    status.textContent = `Gespeichert: ${name}`;
    // Excel-Werte (Spalte J) gegen die eigene Rechnung prüfen
    const excel = Array.isArray(daten.verpflegung) ? daten.verpflegung.map(Number) : [];
    const eigen = reise.tage.map((t) => verpflegung(t) ?? 0);
    const abweichung = excel.length !== eigen.length || excel.some((w, i) => Math.abs(w - eigen[i]) > 0.01);
    if (abweichung) {
      const hinweis = document.createElement('span');
      hinweis.className = 'reise-hinweis';
      hinweis.textContent = 'Excel rechnet anders als die App: bitte prüfen.';
      status.append(document.createElement('br'), hinweis);
    }
    ordnerKnopf.hidden = false;
  } catch (e) {
    console.error(e);
    status.textContent = 'Die Reisekostentabelle konnte nicht erstellt werden. Läuft der Laptop-Server?';
    status.classList.add('fehler');
  } finally {
    knopf.disabled = false;
    knopf.textContent = 'Reisekostentabelle erstellen';
  }
}

// Zählt ein Tag schon zum Saldo bis heute? Vergangene Tage ja; heute erst nach „Gehen“.
function saldoZaehlt(t, heuteText) {
  if (t.datum < heuteText) return true;
  return t.datum === heuteText && t.zustand === 'gegangen';
}

function tagZeile(t, heuteText) {
  const wt = wochentag(t.datum);
  const [, m, tag] = t.datum.split('-').map(Number);
  const erster = t.bloecke[0];
  const letzter = t.bloecke[t.bloecke.length - 1];
  const klassen = ['tag-zeile', wt >= 5 || t.vorStart ? 'wochenende' : '', t.feiertag ? 'feiertag' : ''].filter(Boolean).join(' ');

  const beginn = erster ? uhrzeit(erster.beginn) : '';
  let ende = '';
  if (letzter) ende = letzter.ende === null ? 'läuft' : uhrzeit(letzter.ende);
  const pause = t.pause > 0 ? dauer(t.pause) : '';
  const ist = t.bloecke.length > 0 ? dauer(t.ist) : '';
  const soll = t.soll > 0 ? dauer(t.soll) : '';
  const saldo = saldoZaehlt(t, heuteText) && !t.vorStart && (t.ist > 0 || t.soll > 0) ? dauerMitVorzeichen(t.saldo) : '';

  const bemerkung = [...etikettTeile(t), erster && erster.notiz ? erster.notiz : '']
    .filter(Boolean)
    .map(esc)
    .join(', ');

  return `<tr${klassen ? ` class="${klassen}"` : ''} tabindex="0" data-datum="${t.datum}">` +
    `<td>${KURZ[wt]} ${zweistellig(tag)}.${zweistellig(m)}.</td>` +
    `<td class="zahl">${beginn}</td>` +
    `<td class="zahl">${ende}</td>` +
    `<td class="zahl">${pause}</td>` +
    `<td class="zahl">${ist}</td>` +
    `<td class="zahl">${soll}</td>` +
    `<td class="zahl">${saldo}</td>` +
    `<td class="bemerkung">${bemerkung}</td>` +
    `</tr>`;
}

function wochenSummeZeile(kw, summe) {
  return `<tr class="wochensumme">` +
    `<td>KW ${kw}</td><td></td><td></td><td></td>` +
    `<td class="zahl">${dauer(summe.ist)}</td>` +
    `<td class="zahl">${summe.sollMoeglich ? dauer(summe.soll) : ''}</td>` +
    `<td class="zahl">${summe.saldoMoeglich ? dauerMitVorzeichen(summe.saldo) : ''}</td>` +
    `<td></td>` +
    `</tr>`;
}

export async function zeigen(ziel, kontext) {
  const heuteText = kontext.heute;
  const jetzt = kontext.jetzt;
  const { bloecke, abwesenheiten: abw, einstellungen: einst } = kontext.daten;

  const [jahr, monatNr] = monatsParameter(kontext.parameter, heuteText);
  const datums = tageImMonat(jahr, monatNr);
  const erster = datums[0];
  const letzter = datums[datums.length - 1];
  const tage = datums.map((d) => tagesInfo(bloecke, abw, einst, d, d === heuteText ? jetzt : undefined));
  const reisen = kontext.daten.reisen ?? await alle('reisen');
  const reise = reisekostenMonat(reisen, jahr, monatNr);

  let summeIst = 0;
  let summeSoll = 0;
  let saldoBisHeute = 0;
  for (const t of tage) {
    summeIst += t.ist;
    summeSoll += t.soll;
    if (saldoZaehlt(t, heuteText)) saldoBisHeute += t.saldo;
  }

  // Tabelle mit Wochensummen nach jedem Sonntag und am Monatsende
  const zeilen = [];
  let woche = { ist: 0, soll: 0, saldo: 0, sollMoeglich: false, saldoMoeglich: false };
  tage.forEach((t, i) => {
    zeilen.push(tagZeile(t, heuteText));
    woche.ist += t.ist;
    woche.soll += t.soll;
    if (!t.vorStart) woche.sollMoeglich = true;
    if (saldoZaehlt(t, heuteText) && !t.vorStart) {
      woche.saldo += t.saldo;
      woche.saldoMoeglich = true;
    }
    const letzterTag = i === tage.length - 1;
    if (wochentag(t.datum) === 6 || letzterTag) {
      zeilen.push(wochenSummeZeile(kalenderwoche(t.datum), woche));
      woche = { ist: 0, soll: 0, saldo: 0, sollMoeglich: false, saldoMoeglich: false };
    }
  });

  // Kennzahl Überstundenkonto nur, wenn der Monat schon begonnen hat
  let kontoKarte = '';
  if (erster <= heuteText) {
    // Vergangener Monat: Stichtag ist der Folgetag, damit der letzte Tag voll zählt (kontostand rechnet bis gestern)
    const vorbei = letzter < heuteText;
    const konto = kontostand(bloecke, abw, einst, vorbei ? addTage(letzter, 1) : heuteText);
    kontoKarte = karte(vorbei ? 'Überstundenkonto am Monatsende' : 'Überstundenkonto heute', dauerMitVorzeichen(konto));
  }

  const monatsTitel = `${monatsname(monatNr)} ${jahr}`;
  const aktuell = monatText(jahr, monatNr) === heuteText.slice(0, 7);
  const vorher = monatNr === 1 ? [jahr - 1, 12] : [jahr, monatNr - 1];
  const nachher = monatNr === 12 ? [jahr + 1, 1] : [jahr, monatNr + 1];

  ziel.innerHTML = `
    <header class="kopf glas">
      <div>
        <h1>${esc(monatsTitel)}</h1>
      </div>
      <nav class="aktionen" aria-label="Monat wechseln">
        <a class="knopf knopf-rund" href="#monat/${monatText(...vorher)}" aria-label="Vorheriger Monat">${PFEIL_LINKS}</a>
        ${aktuell ? '' : '<a class="knopf knopf-klein" href="#monat">Heute</a>'}
        <a class="knopf knopf-rund" href="#monat/${monatText(...nachher)}" aria-label="Nächster Monat">${PFEIL_RECHTS}</a>
        <button type="button" class="knopf knopf-haupt nicht-drucken" data-pdf>Als PDF sichern</button>
      </nav>
    </header>

    <div class="raster">
      ${karte('Ist', dauer(summeIst))}
      ${karte('Soll', dauer(summeSoll))}
      ${karte('Saldo bis heute', dauerMitVorzeichen(saldoBisHeute))}
      ${kontoKarte}
    </div>

    <div class="tabelle-rahmen">
      <table class="monatstabelle">
        <caption class="notiz nicht-drucken tabelle-ueberschrift">Stundenzettel ${esc(monatsTitel)}</caption>
        <thead>
          <tr>
            <th scope="col">Datum</th>
            <th scope="col" class="zahl">Beginn</th>
            <th scope="col" class="zahl">Ende</th>
            <th scope="col" class="zahl">Pause</th>
            <th scope="col" class="zahl">Ist</th>
            <th scope="col" class="zahl">Soll</th>
            <th scope="col" class="zahl">Saldo</th>
            <th scope="col">Bemerkung</th>
          </tr>
        </thead>
        <tbody>${zeilen.join('')}</tbody>
        <tfoot>
          <tr class="monatssumme">
            <th scope="row">Monat</th><td></td><td></td><td></td>
            <td class="zahl">${dauer(summeIst)}</td>
            <td class="zahl">${dauer(summeSoll)}</td>
            <td class="zahl">${dauerMitVorzeichen(saldoBisHeute)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>

    ${reiseAbschnitt(reise, kontext.laptop === true)}
  `;

  ziel.dataset.monat = monatsTitel;
  if (kontext.daten.einstellungen && kontext.daten.einstellungen.name) {
    ziel.dataset.name = kontext.daten.einstellungen.name;
  } else {
    delete ziel.dataset.name;
  }

  const tbody = ziel.querySelector('tbody');
  const zeileAus = (e) => e.target.closest('tr[data-datum]');
  tbody.addEventListener('click', (e) => {
    const zeile = zeileAus(e);
    if (zeile) tagOeffnen(zeile.dataset.datum, kontext);
  });
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const zeile = zeileAus(e);
    if (zeile) {
      e.preventDefault();
      tagOeffnen(zeile.dataset.datum, kontext);
    }
  });

  ziel.querySelector('[data-pdf]').addEventListener('click', () => window.print());

  // Reisekosten: Tag öffnen, Reise eintragen, Tabelle erstellen
  const reiseBox = ziel.querySelector('.reise-abschnitt');
  reiseBox.querySelectorAll('[data-datum]').forEach((knopf) => {
    knopf.addEventListener('click', () => tagOeffnen(knopf.dataset.datum, kontext));
  });
  reiseBox.querySelector('[data-reise-neu]').addEventListener('click', () => {
    reiseOeffnen({ von: reiseVon(jahr, monatNr, heuteText) }, kontext).catch((e) => console.error(e));
  });
  const status = reiseBox.querySelector('[data-status]');
  const ordnerKnopf = reiseBox.querySelector('[data-ordner]');
  ordnerKnopf.addEventListener('click', async () => {
    try {
      const antwort = await fetch('/api/ordner-oeffnen', { method: 'POST', cache: 'no-store' });
      if (!antwort.ok) throw new Error(`Status ${antwort.status}`);
    } catch (e) {
      console.error(e);
      status.textContent = 'Der Ordner konnte nicht geöffnet werden.';
      status.classList.add('fehler');
    }
  });
  const excelKnopf = reiseBox.querySelector('[data-excel]');
  if (excelKnopf) {
    excelKnopf.addEventListener('click', () => {
      reisekostentabelleErstellen(reise, monatText(jahr, monatNr), excelKnopf, status, ordnerKnopf);
    });
  }
}
