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
// hotelNaechte: Daten, an deren Abend man im Hotel bleibt. Fehlt die Liste, gelten alle Abende außer dem letzten Tag.
// Ein Eintrag für den letzten Tag oder außerhalb des Zeitraums wirkt nicht.
// Nach einer Hotelnacht beginnt der Tag um 0:00, vor einer endet er um 24:00. Sonst gelten Abfahrt und Rückkehr.
// Anreise, wenn nicht Hotelnacht davor und danach. Frühstück im Hotel gilt an Tagen nach einer Hotelnacht.
export function reiseTageErzeugen({ von, bis, beginn, ende, land: lname, anlass = '', zusatz = '', hotelFruehstueck = false, hotelNaechte }) {
  if (bis < von) return [];
  const anzahl = Math.round((Date.parse(bis) - Date.parse(von)) / 86400000) + 1;
  // Indizes der Tage, deren Abend im Hotel liegt
  const naechte = new Set();
  for (let i = 0; i < anzahl - 1; i++) {
    if (!hotelNaechte || hotelNaechte.includes(tagPlus(von, i))) naechte.add(i);
  }
  const tage = [];
  for (let i = 0; i < anzahl; i++) {
    const davor = naechte.has(i - 1);
    const danach = naechte.has(i);
    tage.push({
      datum: tagPlus(von, i),
      land: lname,
      beginn: davor ? 0 : beginn,
      ende: danach ? TAG : ende,
      anlass,
      zusatz,
      anreise: !(davor && danach),
      fruehstueck: davor && hotelFruehstueck,
      mittag: false,
      abend: false,
      uebernachtung: 0,
      fahrt: 0,
      neben: 0,
    });
  }
  return tage;
}

// Hotelnächte aus Reisetagen: Abende d mit ende === 1440 am Tag d und beginn === 0 am Folgetag (beide vorhanden).
// Ergebnis: sortierte Datumstexte.
export function hotelNaechteAus(tage) {
  const nachDatum = new Map(tage.map((t) => [t.datum, t]));
  return tage
    .filter((t) => t.ende === TAG && nachDatum.get(tagPlus(t.datum, 1))?.beginn === 0)
    .map((t) => t.datum)
    .sort();
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

// Reihenfolge der Reisetage: Datum, dann Beginn
function tagSortierung(a, b) {
  if (a.datum === b.datum) return a.beginn - b.beginn;
  return a.datum < b.datum ? -1 : 1;
}

// Eine Reise aus ihren Tagen: Tage sortiert, Summen je Art und gesamt, auf Cent gerundet.
function reiseAusTagen(id, roh) {
  const tage = [...roh].sort(tagSortierung);
  let verp = 0, uebern = 0, fahrt = 0, neben = 0;
  for (const t of tage) {
    verp += verpflegung(t) ?? 0; // unbekanntes Land zählt 0
    uebern += t.uebernachtung ?? 0;
    fahrt += t.fahrt ?? 0;
    neben += t.neben ?? 0;
  }
  const verpSumme = cent(verp);
  const uebernSumme = cent(uebern);
  const fahrtSumme = cent(fahrt);
  const nebenSumme = cent(neben);
  const erster = tage[0];
  return {
    id,
    tage,
    von: erster.datum,
    bis: tage[tage.length - 1].datum,
    land: erster.land,
    anlass: erster.anlass,
    verpflegung: verpSumme,
    uebernachtung: uebernSumme,
    fahrt: fahrtSumme,
    neben: nebenSumme,
    summe: cent(verpSumme + uebernSumme + fahrtSumme + nebenSumme),
  };
}

// Aktive Reisetage zu Reisen zusammenfassen (Reiter Dienstreisen).
// Gleiche reiseId gehören zusammen. Tage ohne reiseId bilden mit dem folgenden Kalendertag eine Reise,
// wenn Anlass und Land gleich sind und der Tag bis 24:00 dauert (ende === 1440); über mehrere Tage
// entsteht so eine Kette. Ergebnis nach von (Beginn) sortiert.
export function reisenGruppieren(reisen) {
  const aktiv = reisen.filter((r) => !r.geloescht && typeof r.datum === 'string');
  const nachId = new Map();
  const ohneId = [];
  for (const t of aktiv) {
    if (t.reiseId) {
      if (!nachId.has(t.reiseId)) nachId.set(t.reiseId, []);
      nachId.get(t.reiseId).push(t);
    } else {
      ohneId.push(t);
    }
  }

  const gruppen = [];
  for (const [id, tage] of nachId) gruppen.push(reiseAusTagen(id, tage));

  const frei = new Set(ohneId);
  for (const start of [...ohneId].sort(tagSortierung)) {
    if (!frei.has(start)) continue;
    frei.delete(start);
    const tage = [start];
    let letzter = start;
    while (letzter.ende === TAG) {
      const folge = ohneId.find((x) => frei.has(x) && x.datum === tagPlus(letzter.datum, 1)
        && x.anlass === letzter.anlass && x.land === letzter.land);
      if (!folge) break;
      frei.delete(folge);
      tage.push(folge);
      letzter = folge;
    }
    gruppen.push(reiseAusTagen(start.id, tage));
  }

  return gruppen.sort((a, b) => {
    if (a.von !== b.von) return a.von < b.von ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });
}
