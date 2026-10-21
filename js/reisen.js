// Reisen: Verpflegung, Reisetage und Monatssummen nach der Reisekostenvorlage 2026.
// Rein, ohne Speicher und ohne Oberfläche. Beträge in Euro, Zeiten in Minuten ab 0:00.

import { LAENDER } from './laender.js';

const ACHT_STUNDEN = 480;
const TAG = 1440; // 24:00

// Rundung auf Cent
function cent(x) {
  return Math.round(x * 100) / 100;
}

// Eintrag aus LAENDER oder null. Exakter Vergleich, Namen werden nicht verändert.
export function land(name) {
  return LAENDER.find((l) => l.name === name) ?? null;
}

// Verpflegungspauschale eines Reisetags. Unbekanntes Land → null.
// Unter 8 h 0. Sonst Satz: teil bei An- oder Rückreisetag, sonst voll.
// Gestellte Mahlzeiten kürzen anteilig: Frühstück 20 %, Mittag 40 %, Abend 40 %.
export function verpflegung(tag) {
  const l = land(tag.land);
  if (!l) return null;
  if (tag.ende - tag.beginn < ACHT_STUNDEN) return 0;
  const satz = tag.anreise ? l.teil : l.voll;
  // Prozentanteile als ganze Zahl, damit keine Rundungsfehler entstehen
  const anteil = (tag.fruehstueck ? 0 : 20) + (tag.mittag ? 0 : 40) + (tag.abend ? 0 : 40);
  return cent((satz * anteil) / 100);
}

// Datum als JJJJ-MM-TT um n Tage verschieben (ohne Zeitzonenprobleme).
function tagPlus(datum, n) {
  const [j, m, t] = datum.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + n));
  return d.toISOString().slice(0, 10);
}

// Reisetage ohne id aus einer mehrtägigen oder eintägigen Reise.
// Mehrere Tage: erster Tag beginn bis 24:00 (Anreise), mittlere 0 bis 24:00, letzter 0 bis ende (Rückreise).
// Frühstück im Hotel gilt an allen Tagen außer dem ersten.
export function reiseTageErzeugen({ von, bis, beginn, ende, land: lname, anlass = '', zusatz = '', hotelFruehstueck = false }) {
  if (bis < von) return [];
  const anzahl = Math.round((Date.parse(bis) - Date.parse(von)) / 86400000) + 1;
  const tage = [];
  for (let i = 0; i < anzahl; i++) {
    const erster = i === 0;
    const letzter = i === anzahl - 1;
    tage.push({
      datum: tagPlus(von, i),
      land: lname,
      beginn: erster ? beginn : 0,
      ende: letzter ? ende : TAG,
      anlass,
      zusatz,
      anreise: erster || letzter,
      fruehstueck: hotelFruehstueck && !erster,
      mittag: false,
      abend: false,
      uebernachtung: 0,
      fahrt: 0,
      neben: 0,
    });
  }
  return tage;
}

// Summen eines Monats aus allen aktiven Reisetagen (nicht gelöscht).
export function reisekostenMonat(reisen, jahr, monat) {
  const praefix = `${jahr}-${String(monat).padStart(2, '0')}-`;
  const tage = reisen
    .filter((r) => !r.geloescht && typeof r.datum === 'string' && r.datum.startsWith(praefix))
    .sort((a, b) => (a.datum === b.datum ? a.beginn - b.beginn : a.datum < b.datum ? -1 : 1));

  let verp = 0, uebern = 0, fahrt = 0, neben = 0;
  for (const t of tage) {
    verp += verpflegung(t) ?? 0;
    uebern += t.uebernachtung ?? 0;
    fahrt += t.fahrt ?? 0;
    neben += t.neben ?? 0;
  }
  const verpflegungSumme = cent(verp);
  const uebernachtung = cent(uebern);
  const fahrtSumme = cent(fahrt);
  const nebenSumme = cent(neben);
  return {
    tage,
    verpflegung: verpflegungSumme,
    uebernachtung,
    fahrt: fahrtSumme,
    neben: nebenSumme,
    summe: cent(verpflegungSumme + uebernachtung + fahrtSumme + nebenSumme),
  };
}
