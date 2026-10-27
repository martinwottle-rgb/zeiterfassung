// Rechnen: Soll, Ist, Saldo, Urlaub, Stempelzustand, Hinweise.
// Reine Funktionen: keine Seiteneffekte, Eingaben bleiben unverändert, kein Date.now().
import { addTage, wochentag, tageImMonat, dauer } from './zeit.js';
import { feiertag } from './feiertage.js';

// Nur Einträge, die nicht gelöscht sind (Grabsteine ausfiltern).
export function aktiv(liste) {
  return liste.filter(e => !e.geloescht);
}

// Aktive Blöcke eines Tages, nach Beginn sortiert. Gibt eine neue Liste zurück.
export function bloeckeAm(bloecke, d) {
  return aktiv(bloecke).filter(b => b.datum === d).sort((a, b) => a.beginn - b.beginn);
}

// Offene Blöcke (ohne Ende) vor `heute`: vergessenes Ausstempeln. Nach Datum, dann Beginn sortiert.
export function offeneAltbloecke(bloecke, heute) {
  return aktiv(bloecke)
    .filter(b => b.ende === null && b.datum < heute)
    .sort((a, b) => (a.datum !== b.datum ? (a.datum < b.datum ? -1 : 1) : a.beginn - b.beginn));
}

// Laufende (offene) Blöcke eines Tages, nach Beginn.
export function laufendeBloecke(bloecke, d) {
  return bloeckeAm(bloecke, d).filter(b => b.ende === null);
}

// `jetzt` gilt nur für den Tag `heute`. Ohne `heute` gilt es für alle Tage (wie bisher).
function jetztFuer(d, jetzt, heute) {
  return heute === undefined || d === heute ? jetzt : undefined;
}

// Brutto-Minuten eines Tages (Summe der Blöcke, ohne Pausenabzug). Ein offener Block zählt bis `jetzt`, ohne `jetzt` mit 0.
export function bruttoMinuten(bloecke, d, jetzt) {
  let summe = 0;
  for (const b of bloeckeAm(bloecke, d)) {
    if (b.ende !== null) summe += b.ende - b.beginn;
    else if (typeof jetzt === 'number') summe += Math.max(0, jetzt - b.beginn);
  }
  return summe;
}

// Pausenregel eines Tages: 'auto', 'keine' oder eine Zahl (Minuten).
// Gilt die Angabe des ersten Blocks; fehlt sie oder ist null, gilt die Einstellung `pauseAuto`.
export function pausenRegel(bloecke, d, einst) {
  const angabe = bloeckeAm(bloecke, d)[0]?.pause;
  if (angabe === 'auto' || angabe === 'keine') return angabe;
  if (typeof angabe === 'number' && Number.isFinite(angabe)) return angabe;
  return einst?.pauseAuto ? 'auto' : 'keine';
}

// Pausenabzug in Minuten, ohne die Lücken zwischen den Blöcken: Zahl als solche, 'keine' zu 0,
// 'auto' zu der gesetzlichen Pflicht nach Brutto (über 6 h 30: 30 Min, über 9 h 45: 45 Min) minus Lücken, nicht unter 0.
export function pauseAbzug(bloecke, d, jetzt, einst) {
  const regel = pausenRegel(bloecke, d, einst);
  if (typeof regel === 'number') return regel;
  if (regel === 'keine') return 0;
  const brutto = bruttoMinuten(bloecke, d, jetzt);
  const pflicht = brutto > 585 ? 45 : brutto > 390 ? 30 : 0;
  return Math.max(0, pflicht - pausenMinuten(bloecke, d));
}

// Pausen eines Tages insgesamt: Lücken plus Abzug.
export function pauseGesamt(bloecke, d, jetzt, einst) {
  return pausenMinuten(bloecke, d) + pauseAbzug(bloecke, d, jetzt, einst);
}

// Arbeitsminuten eines Tages (netto): Brutto minus Pausenabzug, nicht unter 0.
export function istMinuten(bloecke, d, jetzt, einst) {
  return Math.max(0, bruttoMinuten(bloecke, d, jetzt) - pauseAbzug(bloecke, d, jetzt, einst));
}

// Pausen sind die Lücken zwischen den Blöcken; nur Lücken ab 15 Minuten zählen.
export function pausenMinuten(bloecke, d) {
  const liste = bloeckeAm(bloecke, d);
  let summe = 0;
  for (let i = 1; i < liste.length; i++) {
    const vorher = liste[i - 1];
    if (vorher.ende === null) continue; // ohne Ende keine Lücke
    const luecke = liste[i].beginn - vorher.ende;
    if (luecke >= 15) summe += luecke;
  }
  return summe;
}

// Aktive Abwesenheit, die den Tag enthält. Bei Überschneidung gewinnt die zuletzt geänderte.
export function abwesenheitAm(abw, d) {
  const treffer = aktiv(abw).filter(a => a.von <= d && d <= a.bis);
  if (treffer.length === 0) return null;
  return treffer.reduce((j, a) => (a.geaendert > j.geaendert ? a : j));
}

// Soll des Tages: 0 an Feiertagen, bei Abwesenheit reduziert, Überstundenabbau behält das Soll.
export function sollMinuten(d, einst, abw) {
  if (feiertag(d)) return 0;
  const basis = einst.sollMinuten[wochentag(d)];
  const a = abwesenheitAm(abw, d);
  if (!a || a.art === 'ueberstunden') return basis;
  if (a.art === 'urlaub' || a.art === 'krank' || a.art === 'sonstiges') {
    return a.halbtag ? basis / 2 : 0;
  }
  return basis;
}

// Saldo eines Tages: Ist minus Soll.
export function tagesSaldo(bloecke, abw, einst, d, jetzt) {
  return istMinuten(bloecke, d, jetzt, einst) - sollMinuten(d, einst, abw);
}

// Stempelzustand: 'aus' ohne Blöcke, 'arbeit' bei offenem Block, 'gegangen' nach „Gehen“, sonst 'pause'.
export function stempelZustand(bloecke, d) {
  const liste = bloeckeAm(bloecke, d);
  if (liste.length === 0) return 'aus';
  if (liste.some(b => b.ende === null)) return 'arbeit';
  return liste[liste.length - 1].gehen ? 'gegangen' : 'pause';
}

// Überstundenkonto: Startsaldo plus alle vollen Tage ab Starttag bis gestern,
// heute nur, wenn der Tag mit „Gehen“ beendet ist.
export function kontostand(bloecke, abw, einst, heute) {
  let summe = einst.startSaldo;
  for (let d = einst.start; d < heute; d = addTage(d, 1)) {
    summe += tagesSaldo(bloecke, abw, einst, d);
  }
  if (stempelZustand(bloecke, heute) === 'gegangen') {
    summe += tagesSaldo(bloecke, abw, einst, heute);
  }
  return summe;
}

// Startjahr mit angegebenem Resturlaub am Beginn (urlaubStartRest != null).
function startRestAktiv(einst, jahr) {
  return einst.urlaubStartRest != null && Number(einst.start.slice(0, 4)) === jahr;
}

// Jahresanspruch: im Startjahr mit angegebenem Resturlaub genau dieser Wert, sonst Urlaubstage plus Übertrag.
export function urlaubAnspruch(einst, jahr) {
  if (startRestAktiv(einst, jahr)) return einst.urlaubStartRest;
  return einst.urlaubstage + ((einst.urlaubUebertrag || {})[jahr] || 0);
}

// Urlaubstage im Jahr, die ein Soll hätten (Wochentag mit Soll, kein Feiertag). Halbtags zählt 0,5.
// Im Startjahr mit angegebenem Resturlaub nur Urlaub ab dem Starttag.
export function urlaubGenommen(abw, einst, jahr) {
  const nurAbStart = startRestAktiv(einst, jahr);
  let summe = 0;
  for (let m = 1; m <= 12; m++) {
    for (const d of tageImMonat(jahr, m)) {
      if (einst.sollMinuten[wochentag(d)] <= 0 || feiertag(d)) continue;
      if (nurAbStart && d < einst.start) continue;
      // Gilt der Tag als Urlaub (gleiche Regel wie beim Soll)?
      const a = abwesenheitAm(abw, d);
      if (a && a.art === 'urlaub') summe += a.halbtag ? 0.5 : 1;
    }
  }
  return summe;
}

// Resturlaub: Jahresanspruch minus genommener Urlaub.
export function urlaubRest(abw, einst, jahr) {
  return urlaubAnspruch(einst, jahr) - urlaubGenommen(abw, einst, jahr);
}

// ArbZG-Hinweise für einen Tag: Pause, Höchstarbeitszeit, Ruhezeit (in dieser Reihenfolge).
export function hinweise(bloecke, d, jetzt, einst) {
  const liste = [];
  const ist = istMinuten(bloecke, d, jetzt, einst);

  // Pausenpflicht ab 6 h (30 min) bzw. 9 h (45 min)
  if (ist > 360) {
    const neunStunden = ist > 540;
    const pflicht = neunStunden ? 45 : 30;
    liste.push({
      art: 'pause',
      erfuellt: pauseGesamt(bloecke, d, jetzt, einst) >= pflicht,
      text: neunStunden
        ? 'Ab 9 h Arbeit sind 45 Minuten Pause vorgeschrieben.'
        : 'Ab 6 h Arbeit sind 30 Minuten Pause vorgeschrieben.',
    });
  }

  // Höchstarbeitszeit: mehr als 10 h
  if (ist > 600) {
    liste.push({ art: 'hoechstarbeitszeit', erfuellt: false, text: 'Mehr als 10 h Arbeit an diesem Tag.' });
  }

  // Ruhezeit: zwischen dem spätesten Ende gestern und dem frühesten Beginn heute
  const heuteBloecke = bloeckeAm(bloecke, d);
  const vortag = addTage(d, -1);
  const vortagBloecke = aktiv(bloecke).filter(b => b.datum === vortag && b.ende !== null);
  if (heuteBloecke.length > 0 && vortagBloecke.length > 0) {
    const spaetesEnde = Math.max(...vortagBloecke.map(b => b.ende));
    const ruhe = (1440 - spaetesEnde) + heuteBloecke[0].beginn;
    if (ruhe < 660) {
      liste.push({
        art: 'ruhezeit',
        erfuellt: false,
        text: `Nur ${dauer(ruhe)} Ruhezeit seit dem Vortag, vorgeschrieben sind 11 h.`,
      });
    }
  }

  return liste;
}

// Alle Angaben eines Tages für die Ansicht.
// Tage vor `einst.start` (Beginn der Erfassung) haben kein Soll und keinen Saldo, nur das Ist.
export function tagesInfo(bloecke, abw, einst, d, jetzt) {
  const vorStart = d < einst.start;
  return {
    datum: d,
    bloecke: bloeckeAm(bloecke, d),
    brutto: bruttoMinuten(bloecke, d, jetzt),
    ist: istMinuten(bloecke, d, jetzt, einst),
    soll: vorStart ? 0 : sollMinuten(d, einst, abw),
    saldo: vorStart ? 0 : tagesSaldo(bloecke, abw, einst, d, jetzt),
    vorStart,
    pause: pauseGesamt(bloecke, d, jetzt, einst),
    abwesenheit: abwesenheitAm(abw, d),
    feiertag: feiertag(d),
    zustand: stempelZustand(bloecke, d),
  };
}

// Sieben Tage ab Montag. `jetzt` gilt nur für `heute`; ein offener Block an einem vergangenen Tag zählt 0.
export function woche(bloecke, abw, einst, montag, jetzt, heute) {
  const tage = [];
  for (let i = 0; i < 7; i++) {
    const d = addTage(montag, i);
    tage.push(tagesInfo(bloecke, abw, einst, d, jetztFuer(d, jetzt, heute)));
  }
  return tage;
}

// Monatssummen. `monatNr` ist 1 bis 12. Zu `jetzt` und `heute` wie bei `woche`.
export function monat(bloecke, abw, einst, jahr, monatNr, jetzt, heute) {
  const tage = tageImMonat(jahr, monatNr).map(d => tagesInfo(bloecke, abw, einst, d, jetztFuer(d, jetzt, heute)));
  let summeIst = 0;
  let summeSoll = 0;
  let saldo = 0;
  for (const t of tage) {
    summeIst += t.ist;
    summeSoll += t.soll;
    saldo += t.saldo;
  }
  return { tage, summeIst, summeSoll, saldo };
}
