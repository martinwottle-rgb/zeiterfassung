// Ansicht Abwesenheiten: Urlaubskonto, Abwesenheiten des Jahres, Formular im Sheet, Feiertage BW.
// Datum nur aus kontext.heute. Notizen landen über textContent, sind also immer escaped.
import { aktiv, urlaubAnspruch, urlaubGenommen, urlaubRest } from './rechnen.js';
import { feiertag, feiertageBW } from './feiertage.js';
import { addTage, freitagDerWoche, langesDatum, monatsname, wochentag } from './zeit.js';
import { loeschen, speichern } from './speicher.js';
import { zeitSegment } from './zeit_segment.js';

const ARTEN = [
  ['urlaub', 'Urlaub'],
  ['krank', 'Krank'],
  ['ueberstunden', 'Überstunden'],
  ['sonstiges', 'Sonstiges'],
];
const ARTNAME = Object.fromEntries(ARTEN);
const MINUS = '−';

// Erzeugt ein Element. Attribute mit false, null oder undefined werden weggelassen, true wird zum leeren Attribut.
function el(tag, attribute = {}, kinder = []) {
  const e = document.createElement(tag);
  for (const [name, wert] of Object.entries(attribute)) {
    if (wert === false || wert === null || wert === undefined) continue;
    if (name === 'text') e.textContent = wert;
    else if (name === 'klasse') e.className = wert;
    else e.setAttribute(name, wert === true ? '' : String(wert));
  }
  e.append(...kinder.filter(Boolean));
  return e;
}

// 21.5 zu '21,5', 30 zu '30', -2 zu '−2'.
function zahlText(n) {
  const text = Number.isInteger(n) ? String(Math.abs(n)) : Math.abs(n).toFixed(1).replace('.', ',');
  return (n < 0 ? MINUS : '') + text;
}

// 1 zu '1 Arbeitstag', 8 zu '8 Arbeitstage', 0.5 zu '0,5 Arbeitstage'.
function tageText(n) {
  return `${zahlText(n)} ${n === 1 ? 'Arbeitstag' : 'Arbeitstage'}`;
}

function teile(s) {
  return s.split('-').map(Number);
}

// '2026-12-21' und '2026-12-31' zu '21. bis 31. Dezember'; '2026-10-23' zu '23. Oktober'.
// Über Jahresgrenzen steht das Jahr dabei.
function zeitraumText(von, bis) {
  const [j1, m1, t1] = teile(von);
  const [j2, m2, t2] = teile(bis);
  const mitJahr = j1 !== j2;
  const kurz = (t, m, j) => `${t}. ${monatsname(m)}${mitJahr ? ` ${j}` : ''}`;
  if (von === bis) return kurz(t1, m1, j1);
  if (m1 === m2 && j1 === j2) return `${t1}. bis ${t2}. ${monatsname(m2)}`;
  return `${kurz(t1, m1, j1)} bis ${kurz(t2, m2, j2)}`;
}

// Arbeitstage einer Abwesenheit: Tage mit Soll laut Wochenplan und ohne Feiertag. Halbtags zählt 0,5.
function arbeitstage(a, einst) {
  let summe = 0;
  for (let d = a.von; d <= a.bis; d = addTage(d, 1)) {
    if (einst.sollMinuten[wochentag(d)] > 0 && !feiertag(d)) summe += a.halbtag ? 0.5 : 1;
  }
  return summe;
}

// Jahr aus dem Hash (#abwesenheiten/2025) oder das laufende Jahr aus kontext.heute.
function jahrAus(parameter, heute) {
  return /^\d{4}$/.test(parameter ?? '') ? Number(parameter) : Number(heute.slice(0, 4));
}

function fehlerZeile(id) {
  return el('p', { klasse: 'notiz feld-fehler', id: `${id}-fehler`, hidden: true });
}

// Fehler unter dem Feld: aria-invalid und aria-describedby zeigen auf die Meldung. Leerer Text räumt auf.
function fehlerSetzen(eingabe, fehler, text) {
  if (text) {
    eingabe.setAttribute('aria-invalid', 'true');
    eingabe.setAttribute('aria-describedby', fehler.id);
    fehler.textContent = text;
    fehler.hidden = false;
  } else {
    eingabe.setAttribute('aria-invalid', 'false');
    eingabe.removeAttribute('aria-describedby');
    fehler.textContent = '';
    fehler.hidden = true;
  }
}

// Feld mit Beschriftung über der Eingabe.
function feld(id, titel, eingabe, fehler = null) {
  return el('div', { klasse: 'feld' }, [el('label', { for: id, text: titel }), eingabe, fehler]);
}

// Formular im Sheet. `bestehend` ist der Eintrag beim Bearbeiten, sonst null.
function formularOeffnen(kontext, bestehend) {
  const vorgabe = bestehend ?? { von: kontext.heute, bis: freitagDerWoche(kontext.heute), art: 'urlaub', halbtag: false, notiz: '' };
  let sendet = false;

  const artFeld = el('div', { klasse: 'feld', role: 'radiogroup', 'aria-labelledby': 'ab-art-name' }, [
    el('span', { klasse: 'feld-name', id: 'ab-art-name', text: 'Art' }),
    el('div', { klasse: 'segment' }, ARTEN.map(([wert, name]) => el('label', { klasse: 'segment-teil' }, [
      el('input', { type: 'radio', name: 'art', value: wert, checked: vorgabe.art === wert }),
      el('span', { text: name }),
    ]))),
  ]);

  const vonEingabe = el('input', { type: 'date', id: 'ab-von', name: 'von', value: vorgabe.von });
  const vonFehler = fehlerZeile('ab-von');
  const bisEingabe = el('input', { type: 'date', id: 'ab-bis', name: 'bis', value: vorgabe.bis });
  const bisFehler = fehlerZeile('ab-bis');

  // Halbtags gibt es nur bei einem Tag: von und bis gleich.
  const halbEingabe = el('input', {
    type: 'checkbox',
    role: 'switch',
    id: 'ab-halbtags',
    name: 'halbtags',
    'aria-describedby': 'ab-halbtags-hinweis',
    checked: vorgabe.halbtag && vorgabe.von === vorgabe.bis,
    disabled: vorgabe.von !== vorgabe.bis,
  });
  const halbFeld = el('div', { klasse: 'feld feld-start' }, [
    el('label', { for: 'ab-halbtags', text: 'Halbtags' }),
    halbEingabe,
    el('p', { klasse: 'notiz', id: 'ab-halbtags-hinweis', text: 'Nur bei einem einzelnen Tag möglich.' }),
  ]);
  const halbtagsPruefen = () => {
    const gleich = vonEingabe.value === bisEingabe.value;
    halbEingabe.disabled = !gleich;
    if (!gleich) halbEingabe.checked = false;
  };
  // Von setzt Bis auf den Freitag derselben Woche (Sa und So bleiben beim eigenen Tag). Danach Halbtags neu bewerten.
  const vonGeaendert = () => {
    if (vonEingabe.value) bisEingabe.value = freitagDerWoche(vonEingabe.value);
    halbtagsPruefen();
  };
  vonEingabe.addEventListener('change', vonGeaendert);
  vonEingabe.addEventListener('input', vonGeaendert);
  bisEingabe.addEventListener('change', halbtagsPruefen);

  const notizEingabe = el('textarea', { id: 'ab-notiz', name: 'notiz', rows: 2 }, [vorgabe.notiz ?? '']);
  const meldung = el('p', { klasse: 'notiz fehler', role: 'alert', hidden: true });

  const abbrechen = el('button', { type: 'button', klasse: 'knopf', text: 'Abbrechen' });
  abbrechen.addEventListener('click', () => kontext.sheet.schliessen());
  const sichernKnopf = el('button', { type: 'submit', klasse: 'knopf haupt', text: 'Sichern' });
  const loeschKnopf = bestehend ? el('button', { type: 'button', klasse: 'knopf gefahr', text: 'Löschen' }) : null;

  // Rückfrage im Sheet statt confirm().
  const endgueltig = el('button', { type: 'button', klasse: 'knopf gefahr', text: 'Löschen' });
  const nein = el('button', { type: 'button', klasse: 'knopf', text: 'Abbrechen' });
  const fragenFehler = el('p', { klasse: 'notiz fehler', role: 'alert', hidden: true });

  const formBlock = el('div', { klasse: 'formular-stapel' }, [
    artFeld,
    feld('ab-von', 'Von', vonEingabe, vonFehler),
    feld('ab-bis', 'Bis', bisEingabe, bisFehler),
    halbFeld,
    feld('ab-notiz', 'Notiz', notizEingabe),
    meldung,
    el('div', { klasse: 'aktionen' }, [abbrechen, sichernKnopf]),
    loeschKnopf ? el('div', { klasse: 'aktionen' }, [loeschKnopf]) : null,
  ]);

  const frage = el('div', { klasse: 'stapel-klein', hidden: true }, [
    el('p', { klasse: 'urlaub-text', text: 'Wirklich löschen?' }),
    el('div', { klasse: 'aktionen' }, [endgueltig, nein]),
    fragenFehler,
  ]);

  if (loeschKnopf) {
    loeschKnopf.addEventListener('click', () => {
      formBlock.hidden = true;
      frage.hidden = false;
      nein.focus();
    });
    nein.addEventListener('click', () => {
      frage.hidden = true;
      formBlock.hidden = false;
      loeschKnopf.focus();
    });
    endgueltig.addEventListener('click', async () => {
      if (sendet) return;
      sendet = true;
      try {
        await loeschen('abwesenheiten', bestehend.id);
        kontext.sheet.schliessen();
      } catch {
        sendet = false;
        fragenFehler.textContent = 'Löschen fehlgeschlagen. Bitte noch einmal versuchen.';
        fragenFehler.hidden = false;
      }
    });
  }

  const form = el('form', { novalidate: true }, [formBlock, frage]);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (sendet) return;
    const von = vonEingabe.value;
    const bis = bisEingabe.value;
    const vonText = von ? '' : 'Bitte ein Datum eintragen.';
    const bisText = !bis ? 'Bitte ein Datum eintragen.' : (von && bis < von ? 'Das Enddatum darf nicht vor dem Anfang liegen.' : '');
    fehlerSetzen(vonEingabe, vonFehler, vonText);
    fehlerSetzen(bisEingabe, bisFehler, bisText);
    if (vonText || bisText) {
      (vonText ? vonEingabe : bisEingabe).focus();
      return;
    }
    const art = form.querySelector('input[name="art"]:checked')?.value ?? 'urlaub';
    const obj = {
      ...(bestehend ?? {}),
      von,
      bis,
      art,
      halbtag: halbEingabe.checked && von === bis,
      notiz: notizEingabe.value.trim(),
    };
    sendet = true;
    try {
      await speichern('abwesenheiten', obj);
      kontext.sheet.schliessen();
    } catch {
      sendet = false;
      meldung.textContent = 'Speichern fehlgeschlagen. Bitte noch einmal versuchen.';
      meldung.hidden = false;
    }
  });

  kontext.sheet.oeffnen(bestehend ? 'Abwesenheit bearbeiten' : 'Abwesenheit eintragen', form);
}

export async function zeigen(ziel, kontext) {
  const jahr = jahrAus(kontext.parameter, kontext.heute);
  const abw = kontext.daten.abwesenheiten;
  const einst = kontext.daten.einstellungen;

  // Urlaubskonto
  const anspruch = urlaubAnspruch(einst, jahr);
  const rest = urlaubRest(abw, einst, jahr);
  const genommen = urlaubGenommen(abw, einst, jahr);
  const anteil = anspruch > 0 ? Math.min(100, Math.max(0, (rest / anspruch) * 100)) : 0;
  const urlaubKarte = el('section', { klasse: 'karte', 'aria-label': 'Urlaub' }, [
    el('p', { klasse: 'urlaub-text', text: `Urlaub: ${zahlText(rest)} von ${zahlText(anspruch)} Tagen übrig` }),
    el('div', { klasse: 'fortschritt', 'aria-hidden': 'true' }, [el('i', { style: `width: ${anteil.toFixed(1)}%;` })]),
    el('p', { klasse: 'notiz', text: `Genommen: ${tageText(genommen)}` }),
  ]);

  // Liste der Abwesenheiten, die das Jahr berühren
  const jahrAnfang = `${jahr}-01-01`;
  const jahrEnde = `${jahr}-12-31`;
  const eintraege = aktiv(abw)
    .filter(a => a.von <= jahrEnde && a.bis >= jahrAnfang)
    .sort((a, b) => a.von.localeCompare(b.von) || a.bis.localeCompare(b.bis));

  const zeilen = eintraege.map(a => el('button', { type: 'button', klasse: 'liste-zeile' }, [
    el('span', { klasse: 'liste-text' }, [
      el('span', { klasse: 'liste-titel', text: zeitraumText(a.von, a.bis) }),
      el('span', {
        klasse: 'liste-unter',
        text: [ARTNAME[a.art] ?? a.art, a.halbtag ? 'halbtags' : '', a.notiz ?? ''].filter(Boolean).join(' · '),
      }),
    ]),
    el('span', { klasse: 'liste-wert zahl', text: tageText(arbeitstage(a, einst)) }),
  ]));
  zeilen.forEach((zeile, i) => zeile.addEventListener('click', () => formularOeffnen(kontext, eintraege[i])));

  const liste = el('div', { klasse: 'liste', role: 'group', 'aria-label': `Abwesenheiten ${jahr}` }, zeilen);
  const inhalt = eintraege.length > 0
    ? liste
    : el('p', { klasse: 'leer', text: `Noch keine Abwesenheiten in ${jahr}.` });

  // Kopf mit Blättern
  const kopf = el('header', { klasse: 'kopf glas' }, [
    el('h1', { text: `Abwesenheiten ${jahr}` }),
    el('nav', { klasse: 'aktionen', 'aria-label': 'Jahr wählen' }, [
      el('a', { klasse: 'knopf klein', href: `#abwesenheiten/${jahr - 1}`, 'aria-label': `Jahr ${jahr - 1}`, text: `‹ ${jahr - 1}` }),
      el('a', { klasse: 'knopf klein', href: `#abwesenheiten/${jahr + 1}`, 'aria-label': `Jahr ${jahr + 1}`, text: `${jahr + 1} ›` }),
    ]),
  ]);

  const eintragen = el('button', { type: 'button', klasse: 'knopf haupt', text: 'Abwesenheit eintragen' });
  eintragen.addEventListener('click', () => formularOeffnen(kontext, null));

  // Feiertage BW, ruhige Liste
  const feiertage = [...feiertageBW(jahr)].sort(([a], [b]) => a.localeCompare(b));
  const feiertageSektion = el('section', {
    klasse: 'gruppe',
    'aria-labelledby': 'ab-feiertage',
  }, [
    el('h2', { klasse: 'eyebrow', id: 'ab-feiertage', text: `Feiertage Baden-Württemberg ${jahr}` }),
    el('div', { klasse: 'liste' }, feiertage.map(([datum, name]) => el('div', { klasse: 'liste-zeile' }, [
      el('span', { klasse: 'liste-titel', text: langesDatum(datum) }),
      el('span', { klasse: 'liste-wert', text: name }),
    ]))),
  ]);

  // Fokus merken, falls er im Bereich liegt, und nach dem Zeichnen zurücksetzen
  const merkeFokus = ziel.contains(document.activeElement) ? document.activeElement.id : '';

  ziel.replaceChildren(zeitSegment('abwesenheiten'), kopf, urlaubKarte, el('div', { klasse: 'karte-aktion' }, [eintragen]), inhalt, feiertageSektion);

  if (merkeFokus && merkeFokus !== 'ansicht') {
    document.getElementById(merkeFokus)?.focus({ preventScroll: true });
  }
}
