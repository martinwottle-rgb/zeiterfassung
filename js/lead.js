// Lead: Daten am Kontakt (Anlass, Branche, Interesse, Maschine, Priorität, nächste Schritte) als Text fassen.
// Dazu Anlass-Vorschlag aus den Reisen und der Text für die Outlook-Notiz.
// Reines Modul ohne DOM und ohne Speicher. Importiert nur die Namenslisten.
import { VORNAMEN } from './vornamen.js';
import { WEIBLICH } from './vornamen_geschlecht.js';

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

// Erster Teil des Vornamens, klein („Hans-F.“ wird „hans“)
function ersterVorname(vorname) {
  return txt(vorname).toLowerCase().split(/[\s\-.]+/).filter((s) => s !== '')[0] || '';
}

// Geschlecht: 'm', 'w' oder '' (unbekannt). Die Anrede im Kontakt gilt vor dem Vornamen.
export function geschlechtVon(k) {
  const anrede = txt(k?.anrede).toLowerCase();
  if (anrede === 'herr') return 'm';
  if (anrede === 'frau') return 'w';
  const name = ersterVorname(k?.vorname);
  if (WEIBLICH.has(name)) return 'w';
  if (VORNAMEN.has(name)) return 'm';
  return '';
}

// Nur „Prof.“ und „Dr.“ aus dem Titel, in dieser Reihenfolge (ohne Punkt)
function titelTeile(titel) {
  const teile = txt(titel).toLowerCase().split(/[\s.()\-]+/);
  const ergebnis = [];
  if (teile.includes('prof')) ergebnis.push('Prof');
  if (teile.includes('dr')) ergebnis.push('Dr');
  return ergebnis;
}

// Anrede für die Mail: 'Sehr geehrter Herr …,' (de) oder 'Dear Mr …,' (en)
export function mailAnrede(k, sprache) {
  const kk = k || {};
  const titel = titelTeile(kk.titel);
  const vorname = txt(kk.vorname);
  const nachname = txt(kk.nachname);
  const geschlecht = geschlechtVon(kk);
  const voll = [vorname, nachname].filter((s) => s !== '').join(' ');

  if (sprache === 'en') {
    if (!nachname) return 'Dear Sir or Madam,';
    if (titel.length) return `Dear ${[...titel, nachname].join(' ')},`;
    if (geschlecht === 'm') return `Dear Mr ${nachname},`;
    if (geschlecht === 'w') return `Dear Ms ${nachname},`;
    return `Dear ${voll},`;
  }

  if (!nachname) return 'Sehr geehrte Damen und Herren,';
  const mitTitel = [...titel.map((t) => t + '.'), nachname].join(' ');
  if (geschlecht === 'm') return `Sehr geehrter Herr ${mitTitel},`;
  if (geschlecht === 'w') return `Sehr geehrte Frau ${mitTitel},`;
  return `Guten Tag ${voll},`;
}

// Sprache der Mail: 'de' oder 'en'. Erst Notiz (ganze Wörter), dann Land, dann Mail-Endung.
const SPRACHE_WORT = new Map([['en', 'en'], ['englisch', 'en'], ['englsich', 'en'], ['english', 'en'],
  ['de', 'de'], ['deutsch', 'de'], ['german', 'de']]);
const LAND_DE = ['deutschland', 'österreich', 'schweiz', 'germany', 'austria', 'switzerland'];
const ENDUNG_DE = ['de', 'at', 'ch'];

// Domain aus Webseite oder Mail: klein, ohne Schema, Pfad und Mail-Teil
function domainVon(wert) {
  return txt(wert).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^.*@/, '').split(/[\/?#:]/)[0];
}

// Länder-Endung einer Domain (zwei Buchstaben, nicht .de); sonst ''
function laenderEndung(domain) {
  const endung = domain.split('.').pop();
  return /^[a-z]{2}$/.test(endung) && endung !== 'de' ? endung : '';
}

export function spracheVon(k) {
  const kk = k || {};
  for (const wort of txt(kk.notiz).toLowerCase().split(/[^\p{L}]+/u)) {
    if (SPRACHE_WORT.has(wort)) return SPRACHE_WORT.get(wort);
  }
  // Ohne Land, aber mit deutscher PLZ: 'de', außer Webseite oder Mail haben eine ausländische Endung
  if (!txt(kk.land) && /^\d{5}$/.test(txt(kk.plz))) {
    const ausland = [kk.web, kk.email].map((w) => laenderEndung(domainVon(w))).find((e) => e);
    if (!ausland) return 'de';
    return ENDUNG_DE.includes(ausland) ? 'de' : 'en';
  }
  const land = txt(kk.land).toLowerCase();
  if (land) return LAND_DE.includes(land) ? 'de' : 'en';
  const mail = txt(kk.email);
  if (mail.includes('@')) {
    const endung = mail.split('@').pop().split('.').pop().toLowerCase();
    return ENDUNG_DE.includes(endung) ? 'de' : 'en';
  }
  return 'de';
}

// Notiz für Kontakt und KI: QR-Zeilen weg, Mails und Telefonnummern durch „[entfernt]“ ersetzt
export function notizBereinigen(text) {
  return txt(text)
    .split('\n')
    .filter((zeile) => !zeile.trimStart().startsWith('QR-Link:'))
    .join('\n')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[entfernt]')
    .replace(/\+?\d[\d\s\/()\-]*\d/g,(m) => (m.replace(/\D/g, '').length >= 7 ? '[entfernt]' : m))
    .trim();
}

// Webseite: Feld web, sonst Mail-Domain (freie Anbieter zählen nicht)
const FREIE_ANBIETER = ['gmail.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'outlook.com', 'hotmail.com',
  'yahoo.com', 'icloud.com'];

function webseite(k) {
  if (txt(k.web)) return txt(k.web);
  const mail = txt(k.email);
  if (!mail.includes('@')) return '';
  const domain = mail.split('@').pop().toLowerCase();
  return FREIE_ANBIETER.includes(domain) ? '' : domain;
}

// Eigene Firma: das Wort aus zwei Teilen, damit es nicht am Stück im Quelltext steht
const EIGEN = 'seyd' + 'elmann';

// Rechtsform-Wörter, die beim Zusammenfassen von Firmen wegfallen
const RECHTSFORM = ['gmbh', 'ag', 'kg', 'co', 'mbh', 'bv', 'ltd', 'sa'];

// Kontakt darf ins Paket: nicht gelöscht, nicht ausgeschlossen, nicht die eigene Firma
export function auswertbar(k) {
  const kk = k || {};
  if (kk.geloescht) return false;
  if (kk.auswertungAus === true) return false;
  if (txt(kk.firma).toLowerCase().includes(EIGEN)) return false;
  if (domainVon(kk.email).startsWith(EIGEN)) return false;
  return true;
}

// Schlüssel zum Zusammenfassen: klein, ohne Rechtsform, ohne Satzzeichen und Leerzeichen
function firmaSchluessel(firma) {
  return txt(firma).toLowerCase().replace(/d\.o\.o\./g, ' ')
    .split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '' && !RECHTSFORM.includes(w)).join('');
}

// Block einer Firmengruppe für das Paket: Firma, Ort, Land, Webseite, Gespräche, Sprache, Lead, Notizen
function gruppenBlock(nr, g) {
  const ks = g.kontakte;
  // erster Kontakt der Gruppe, der den Wert hat
  const wert = (f) => ks.map(f).map(txt).find((w) => w !== '') || '';
  const zeilen = [`### ${nr}`, `Firma: ${g.firma || 'nicht angegeben'}`];
  const ort = wert((k) => k.ort);
  const land = wert((k) => k.land);
  const web = wert((k) => webseite(k));
  if (ort) zeilen.push('Ort: ' + ort);
  if (land) zeilen.push('Land: ' + land);
  if (web) zeilen.push('Webseite: ' + web);
  if (ks.length > 1) zeilen.push('Gespräche: ' + ks.length);
  // Land und PLZ kommen von einem anderen Kontakt der Gruppe, wenn der erste leer ist
  zeilen.push('Sprache der Mail: ' + spracheVon({ ...ks[0], land: wert((k) => k.land), plz: wert((k) => k.plz) }));
  const lead = ks.map((k) => leadText(k.lead)).find((t) => t !== '');
  if (lead) zeilen.push(lead);
  const notizen = ks.map((k) => notizBereinigen(k.notiz)).filter((t) => t !== '');
  if (notizen.length) zeilen.push('Notizen:\n' + notizen.join('\n\n'));
  return zeilen.join('\n');
}

// Paket für die KI: Auftrag, Stilvorlagen, Maschinenliste, Firmengruppen mit Nummern L01, L02 …
// Ohne Vorname, Nachname, Mail, Telefon, Mobil und Straße. Nur auswertbare Kontakte.
export function paketBauen({ anlass, kontakte, vorlagen }) {
  const v = vorlagen || {};
  const sortiert = (Array.isArray(kontakte) ? kontakte : []).filter((k) => k && auswertbar(k))
    .slice().sort((a, b) => txt(a.firma).localeCompare(txt(b.firma), 'de'));
  // Gleicher Schlüssel = eine Gruppe; ohne Firma bleibt jeder Kontakt allein
  const gruppen = [];
  const nachSchluessel = new Map();
  for (const k of sortiert) {
    const s = firmaSchluessel(k.firma);
    if (s && nachSchluessel.has(s)) { nachSchluessel.get(s).kontakte.push(k); continue; }
    const g = { firma: txt(k.firma), kontakte: [k] };
    gruppen.push(g);
    if (s) nachSchluessel.set(s, g);
  }
  // Nach Firma sortiert, Gruppen ohne Firma ans Ende
  gruppen.sort((a, b) => (!a.firma) - (!b.firma) || (a.firma && b.firma ? a.firma.localeCompare(b.firma, 'de') : 0));
  const nummern = {};
  const gruppenIds = {};
  const firmen = {};
  const teile = [`# ${txt(anlass) || 'Ohne Anlass'}`, txt(v.auftrag)];
  (Array.isArray(v.stil) ? v.stil : []).forEach((s, i) => teile.push(`## Stilvorlage ${i + 1}\n${txt(s)}`));
  teile.push(`## Maschinenliste (ohne Preise)\n${txt(v.maschinenliste)}`);
  teile.push('## Kontakte');
  gruppen.forEach((g, i) => {
    const nr = 'L' + String(i + 1).padStart(2, '0');
    nummern[nr] = g.kontakte[0].id;
    gruppenIds[nr] = g.kontakte.map((k) => k.id);
    firmen[nr] = g.firma;
    teile.push(gruppenBlock(nr, g));
  });
  return { text: teile.filter((t) => t !== '').join('\n\n'), nummern, gruppen: gruppenIds, firmen };
}

// Antwort der KI lesen: erst der ```json-Block, sonst der Text von „[“ bis „]“
// firmen (optional, { L01: 'Firma' }): Hat ein Eintrag ein Feld „firma“, gilt die Nummer der gleichnamigen Firma.
// So passt ein Ergebnis auch zu einem Paket mit anderer Nummerierung.
export function ergebnisLesen(text, nummern, gruppen, firmen) {
  const eintraege = [];
  const fehler = [];
  const t = typeof text === 'string' ? text : '';
  const block = /```json\s*([\s\S]*?)```/.exec(t);
  let roh = null;
  if (block) roh = block[1];
  else {
    const a = t.indexOf('[');
    const b = t.lastIndexOf(']');
    if (a !== -1 && b > a) roh = t.slice(a, b + 1);
  }
  let daten = null;
  try { daten = roh === null ? null : JSON.parse(roh); } catch { daten = null; }
  if (!Array.isArray(daten)) return { eintraege, fehler: ['Kein JSON-Block in der Antwort gefunden'] };

  for (const o of daten) {
    if (!o || typeof o !== 'object') continue;
    let nr = String(o.nr ?? '').trim();
    const firmaS = firmaSchluessel(txt(o.firma));
    if (firmaS && firmen) {
      const treffer = Object.keys(firmen).find((n) => firmaSchluessel(firmen[n] || 'nicht angegeben') === firmaS);
      if (treffer) nr = treffer;
      else {
        fehler.push(`${txt(o.firma)}: Firma ist nicht in diesem Paket`);
        continue;
      }
    }
    if (!Object.prototype.hasOwnProperty.call(nummern || {}, nr)) {
      fehler.push(`${nr}: Nummer gehört zu keinem Kontakt dieses Pakets`);
      continue;
    }
    const prioritaet = txt(o.prioritaet).toUpperCase();
    const roh2 = o.passung === undefined || o.passung === null || o.passung === '' ? NaN : Number(o.passung);
    const passung = Number.isFinite(roh2) ? Math.min(5, Math.max(1, Math.round(roh2))) : 3;
    eintraege.push({
      nr,
      kontaktId: nummern[nr],
      kontaktIds: gruppen?.[nr] ?? [nummern[nr]],
      prioritaet: ['A', 'B', 'C'].includes(prioritaet) ? prioritaet : 'C',
      passung,
      schritt: txt(o.schritt),
      schrittText: txt(o.schrittText),
      recherche: txt(o.recherche),
      maschinen: txt(o.maschinen),
      plan: txt(o.plan),
      betreff: txt(o.betreff),
      mail: txt(o.mail),
    });
  }
  return { eintraege, fehler };
}

// Punkte für die Rangliste: Priorität, Schritt und Passung (× 5)
const PRIO_PUNKTE = new Map([['A', 300], ['B', 200], ['C', 100]]);
const SCHRITT_PUNKTE = new Map([['Angebot', 50], ['Werksbesuch', 40], ['Versuch im Kundenzentrum', 35],
  ['Technisches Gespräch', 30], ['Nachfassanruf', 20], ['Unterlagen', 10]]);

export function punktzahl(eintrag, lead) {
  const e = eintrag || {};
  const prio = txt(lead?.prioritaet) || txt(e.prioritaet);
  return (PRIO_PUNKTE.get(prio) ?? 100) + (SCHRITT_PUNKTE.get(txt(e.schritt)) ?? 0) + (Number(e.passung) || 0) * 5;
}

// Mail mit Anrede: { betreff, text }
export function mailVollText(eintrag, k, sprache) {
  const e = eintrag || {};
  return { betreff: txt(e.betreff), text: mailAnrede(k, sprache) + '\n\n' + txt(e.mail) };
}
