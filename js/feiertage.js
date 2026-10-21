// Feiertage Baden-Württemberg. Rein, ohne Seiteneffekte.
import { addTage, datumText } from './zeit.js';

// Ostersonntag nach der anonymen gregorianischen Formel (Meeus/Jones/Butcher).
export function ostersonntag(jahr) {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (((19 * a + b - d - g + 15) % 30) + 30) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (((32 + 2 * e + 2 * i - h - k) % 7) + 7) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return datumText(new Date(jahr, monat - 1, tag));
}

// Alle gesetzlichen Feiertage in BW eines Jahres: Map Datumstext zu Name.
export function feiertageBW(jahr) {
  const ostern = ostersonntag(jahr);
  const feiertage = new Map([
    [`${jahr}-01-01`, 'Neujahr'],
    [`${jahr}-01-06`, 'Heilige Drei Könige'],
    [addTage(ostern, -2), 'Karfreitag'],
    [addTage(ostern, 1), 'Ostermontag'],
    [`${jahr}-05-01`, 'Tag der Arbeit'],
    [addTage(ostern, 39), 'Christi Himmelfahrt'],
    [addTage(ostern, 50), 'Pfingstmontag'],
    [addTage(ostern, 60), 'Fronleichnam'],
    [`${jahr}-10-03`, 'Tag der Deutschen Einheit'],
    [`${jahr}-11-01`, 'Allerheiligen'],
    [`${jahr}-12-25`, '1. Weihnachtstag'],
    [`${jahr}-12-26`, '2. Weihnachtstag'],
  ]);
  return feiertage;
}

// Name des Feiertags an einem Datum oder null.
export function feiertag(d) {
  const jahr = Number(d.slice(0, 4));
  return feiertageBW(jahr).get(d) ?? null;
}
