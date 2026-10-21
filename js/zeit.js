// Datum und Uhrzeit. Rein, ohne Seiteneffekte.
// Datumstexte immer in Ortszeit (JJJJ-MM-TT), nie toISOString.

const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
                'August', 'September', 'Oktober', 'November', 'Dezember'];

const zweistellig = (n) => String(n).padStart(2, '0');

// Zerlegt Datumstext oder Date in [Jahr, Monat (1 bis 12), Tag].
function teile(d) {
  if (d instanceof Date) return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  const [j, m, t] = d.split('-').map(Number);
  return [j, m, t];
}

// Datumstext aus Date (Ortszeit).
export function datumText(date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${zweistellig(date.getMonth() + 1)}-${zweistellig(date.getDate())}`;
}

// Date um 0:00 Ortszeit aus Datumstext.
export function ausDatumText(s) {
  const [j, m, t] = teile(s);
  return new Date(j, m - 1, t);
}

// Heutiges Datum als Text.
export function heute() {
  return datumText(new Date());
}

// Aktuelle Uhrzeit in Minuten seit Mitternacht.
export function jetztMinuten() {
  const jetzt = new Date();
  return jetzt.getHours() * 60 + jetzt.getMinutes();
}

// '7:48' oder '07:48' zu 468. '24:00' zu 1440. Ungültig zu null.
export function minutenAusUhrzeit(text) {
  if (typeof text !== 'string') return null;
  const treffer = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!treffer) return null;
  const h = Number(treffer[1]);
  const m = Number(treffer[2]);
  if (m > 59) return null;
  if (h === 24 && m === 0) return 1440;
  if (h > 23) return null;
  return h * 60 + m;
}

// 468 zu '7:48'. 1440 zu '24:00'.
export function uhrzeit(min) {
  if (min === 1440) return '24:00';
  return `${Math.floor(min / 60)}:${zweistellig(min % 60)}`;
}

// 342 zu '5:42 h'.
export function dauer(min) {
  return `${Math.floor(min / 60)}:${zweistellig(min % 60)} h`;
}

// 870 zu '+14:30 h', -30 zu '−0:30 h' (U+2212), 0 zu '0:00 h'.
export function dauerMitVorzeichen(min) {
  if (min === 0) return dauer(0);
  const zeichen = min > 0 ? '+' : '−';
  return zeichen + dauer(Math.abs(min));
}

// Wochentag: 0 = Montag bis 6 = Sonntag.
export function wochentag(d) {
  const [j, m, t] = teile(d);
  return (new Date(j, m - 1, t).getDay() + 6) % 7;
}

// Addiert Tage. Neues Date aus Jahr, Monat, Tag + n, damit die Zeitumstellung keinen Tag verschluckt.
export function addTage(d, n) {
  const [j, m, t] = teile(d);
  return datumText(new Date(j, m - 1, t + n));
}

// Montag derselben Woche.
export function wochenbeginn(d) {
  return addTage(d, -wochentag(d));
}

// ISO-Kalenderwoche. Rechnet mit UTC-Tagen, damit Zeitumstellung nicht stört.
export function kalenderwoche(d) {
  const [j, m, t] = teile(d);
  const tag = Date.UTC(j, m - 1, t);
  const wochentagNr = (new Date(tag).getUTCDay() + 6) % 7;
  // Donnerstag derselben Woche bestimmt das ISO-Jahr.
  const donnerstag = tag + (3 - wochentagNr) * 86400000;
  const isoJahr = new Date(donnerstag).getUTCFullYear();
  const jahresanfang = Date.UTC(isoJahr, 0, 1);
  return Math.floor((donnerstag - jahresanfang) / 86400000 / 7) + 1;
}

// Liste aller Datumstexte eines Monats (monat 1 bis 12).
export function tageImMonat(jahr, monat) {
  const anzahl = new Date(jahr, monat, 0).getDate();
  const liste = [];
  for (let t = 1; t <= anzahl; t++) {
    liste.push(datumText(new Date(jahr, monat - 1, t)));
  }
  return liste;
}

// '2026-10-20' zu 'Dienstag, 20. Oktober'.
export function langesDatum(d) {
  const [, m, t] = teile(d);
  return `${WOCHENTAGE[wochentag(d)]}, ${t}. ${MONATE[m - 1]}`;
}

// 3 zu 'März'.
export function monatsname(monat) {
  return MONATE[monat - 1];
}

// Freitag derselben Woche. Liegt der Tag am Wochenende (Sa, So), dann der Tag selbst.
export function freitagDerWoche(d) {
  const w = wochentag(d);
  return addTage(d, w >= 5 ? 0 : 4 - w);
}

// Pausentext zu Minuten. '30' zu 30, '0,5' oder '0.75' zu Stunden (30 bzw. 45), '1:15' zu 75.
// Einheit 'min', 'h' oder 'Std' erlaubt ('1,5 h' zu 90). Leer oder nur Leerzeichen zu null, nicht erkannt zu NaN.
export function pauseAusText(s) {
  const t = String(s ?? '').trim();
  if (t === '') return null;
  const uhr = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (uhr) {
    const m = Number(uhr[2]);
    return m > 59 ? NaN : Number(uhr[1]) * 60 + m;
  }
  const zahl = /^(\d+(?:[.,]\d+)?)\s*(min|std|h)?$/i.exec(t);
  if (!zahl) return NaN;
  const wert = Number(zahl[1].replace(',', '.'));
  const einheit = (zahl[2] || '').toLowerCase();
  const stunden = einheit === 'h' || einheit === 'std' || (einheit === '' && /[.,]/.test(zahl[1]));
  return Math.round(stunden ? wert * 60 : wert);
}
