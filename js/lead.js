// Lead: Daten am Kontakt (Anlass, Branche, Interesse, Maschine, Priorität, nächste Schritte) als Text fassen.
// Dazu Anlass-Vorschlag aus den Reisen und der Text für die Outlook-Notiz.
// Reines Modul ohne Imports, ohne DOM, ohne Speicher.

export const LEAD_PRIORITAET = [
  { wert: 'A', text: 'Hot Lead' },
  { wert: 'B', text: 'Potenzial' },
  { wert: 'C', text: 'Information' },
];

export const LEAD_INTERESSE = ['Neue Maschine', 'Linienerweiterung', 'Automatisierung', 'Ersatzteile', 'Service',
  'Modernisierung', 'Versuch im Kundenzentrum', 'Sonstiges'];

export const LEAD_SCHRITTE = ['Angebot', 'Technisches Gespräch', 'Werksbesuch', 'Versuch im Kundenzentrum', 'Unterlagen', 'Nachfassanruf'];

export const LEAD_MASCHINEN = ['Kutter', 'Wolf', 'Mischer', 'Feinstzerkleinerer', 'Linie'];

// Felder, die für „leer“ geprüft werden (Anlass und Datum zählen nicht mit)
const FELDER = ['branche', 'interesse', 'interesseSonst', 'maschine', 'leistung', 'menge', 'anwendung',
  'bestehend', 'fabrikat', 'budget', 'prioritaet', 'schritte', 'einwilligung'];

// Text getrimmt; alles, was kein Text ist, wird ''
const txt = (wert) => (typeof wert === 'string' ? wert.trim() : '');

// Liste aus Texten: getrimmt, leere Einträge fallen weg
const liste = (wert) => (Array.isArray(wert) ? wert.map(txt).filter((s) => s !== '') : []);

// Zeile mit Vorspann, nur wenn der Wert nicht leer ist
const mit = (vorspann, wert) => (txt(wert) ? vorspann + txt(wert) : '');

// 'YYYY-MM-DD' wird zu 'TT.MM.JJJJ'; anderes bleibt unverändert
function datumDeutsch(datum) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : datum;
}

// Priorität als 'A Hot Lead'; '' bei unbekanntem Wert
function prioritaetText(wert) {
  const p = LEAD_PRIORITAET.find((x) => x.wert === wert);
  return p ? `${p.wert} ${p.text}` : '';
}

// Ja/Nein-Feld: 'ja' wird 'Ja', 'nein' wird 'Nein', sonst ''
function jaNein(wert) {
  if (wert === 'ja') return 'Ja';
  if (wert === 'nein') return 'Nein';
  return '';
}

// Lead ist leer, wenn außer Anlass und Datum nichts ausgefüllt ist
export function leadLeer(lead) {
  if (!lead) return true;
  return FELDER.every((f) => (Array.isArray(lead[f]) ? liste(lead[f]).length === 0 : txt(lead[f]) === ''));
}

// Block für die Outlook-Notiz; '' bei leerem Lead
export function leadText(lead) {
  if (leadLeer(lead)) return '';
  const zeilen = [];

  let kopf = 'Lead';
  if (txt(lead.anlass)) kopf += ' ' + txt(lead.anlass);
  if (txt(lead.datum)) kopf += ' (' + datumDeutsch(txt(lead.datum)) + ')';
  zeilen.push(kopf);

  const prio = prioritaetText(txt(lead.prioritaet));
  if (prio) zeilen.push('Priorität: ' + prio);

  if (txt(lead.branche)) zeilen.push('Branche und Produkte: ' + txt(lead.branche));

  // Bei „Sonstiges“ steht der freie Text dahinter
  const interesse = liste(lead.interesse).map((i) => (i === 'Sonstiges' && txt(lead.interesseSonst) ? 'Sonstiges: ' + txt(lead.interesseSonst) : i));
  if (interesse.length) zeilen.push('Interesse: ' + interesse.join(', '));

  const maschine = [mit('Maschine: ', lead.maschine), mit('Leistung: ', lead.leistung), mit('Menge pro Tag: ', lead.menge)].filter(Boolean);
  if (maschine.length) zeilen.push(maschine.join(' · '));

  if (txt(lead.anwendung)) zeilen.push('Produkt und Anwendung: ' + txt(lead.anwendung));

  const bestand = jaNein(txt(lead.bestehend));
  if (bestand === 'Ja' && txt(lead.fabrikat)) zeilen.push('Bestehende Maschine: Ja, ' + txt(lead.fabrikat));
  else if (bestand) zeilen.push('Bestehende Maschine: ' + bestand);

  if (txt(lead.budget)) zeilen.push('Budget: ' + txt(lead.budget));

  const schritte = liste(lead.schritte);
  if (schritte.length) zeilen.push('Nächste Schritte: ' + schritte.join(', '));

  const einwilligung = jaNein(txt(lead.einwilligung));
  if (einwilligung) zeilen.push('Einwilligung zur Kontaktaufnahme: ' + einwilligung);

  return zeilen.join('\n');
}

// Kurze Zeile für Liste und Kopf: Priorität, Schritte, Maschine
export function leadKurz(lead) {
  const l = lead || {};
  return [prioritaetText(txt(l.prioritaet)), liste(l.schritte).join(', '), txt(l.maschine)]
    .filter((s) => s !== '')
    .join(' · ');
}

// Anlass-Vorschlag: erster nicht gelöschter Reiseeintrag mit diesem Datum (Anlass, sonst Ort)
export function anlassVorschlag(datum, reisen) {
  if (!datum) return '';
  const reise = (Array.isArray(reisen) ? reisen : []).find((r) => r && !r.geloescht && r.datum === datum);
  if (!reise) return '';
  return txt(reise.anlass) || txt(reise.ort) || '';
}

// Notiz für Outlook: eigener Text und Lead-Block, durch Leerzeile getrennt
export function outlookNotiz(notiz, lead) {
  return [txt(notiz), leadText(lead)].filter((s) => s !== '').join('\n\n');
}
