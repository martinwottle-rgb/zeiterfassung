// Belege: Text eines Belegs (OCR oder PDF-Text) lesen: Datum, Betrag, Währung, Händler, Kategorie.
// Dazu Beträge lesen und formatieren, Belege nach Monat gruppieren und Dateinamen bilden.
// Reines Modul ohne Imports, ohne DOM, ohne Speicher.

export const KATEGORIEN = ['Tanken', 'Hotel', 'Bewirtung', 'Parken', 'Bahn/Flug', 'Sonstiges'];

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const ZEICHEN = { EUR: '€', GBP: '£', USD: '$' };

// Datum: dd.mm.yyyy, dd.mm.yy, dd/mm/yyyy, dd-mm-yyyy (gleiches Trennzeichen) und yyyy-mm-dd
const DATUM = /(?<!\d)(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})([./-])(\d{1,2})\5(\d{4}|\d{2}))(?!\d)/;
// Betrag: genau zwei Nachkommastellen, Tausender mit . oder ,
const BETRAG = /(?<![\d.,])(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2}(?!\d)(?![.,]\d)/;
// Zeilen mit diesen Wörtern zählen nie für den Betrag
const AUSSCHLUSS = /(?<!\p{L})(?:mwst|ust|steuer|netto|gegeben|rückgeld|rueckgeld|wechselgeld)|(?<!\p{L})bar(?!\p{L})|\/l(?!\p{L})/iu;
// Summenwörter: Zeilen mit solchen Wörtern haben Vorrang
const SUMMEN_WORTE = /(?<!\p{L})(?:summe|gesamt|total|betrag|zu zahlen|endbetrag|brutto|toplam|amount|tutar)/iu;
// Straße oder Hausnummer am Ende, damit die Zeile nicht als Händler gilt
const STRASSE = /stra(?:ß|ss)e(?!\p{L})|str\.|(?:weg|platz|allee|gasse|ring|damm|ufer)(?!\p{L})/iu;

// Währungen in der Reihenfolge der Prüfung
const WAEHRUNGEN = [
  [/€|(?<!\p{L})eur(?!\p{L})/iu, 'EUR'],
  [/₺|(?<!\p{L})(?:try|tl)(?!\p{L})/iu, 'TRY'],
  [/£|(?<!\p{L})gbp(?!\p{L})/iu, 'GBP'],
  [/\$|(?<!\p{L})usd(?!\p{L})/iu, 'USD'],
  [/(?<!\p{L})chf(?!\p{L})/iu, 'CHF'],
];

// Kategorien mit Stichwörtern (Wortanfang, Groß/klein egal); die erste passende Kategorie gewinnt
const KATEGORIE_WOERTER = [
  ['Tanken', ['aral', 'shell', 'esso', 'jet', 'total energies', 'avia', 'omv', 'agip', 'opet', 'tankstelle', 'diesel', 'benzin', 'super e10', 'kraftstoff', 'liter']],
  ['Hotel', ['hotel', 'übernachtung', 'uebernachtung', 'zimmer', 'logis', 'motel', 'booking.com']],
  ['Bewirtung', ['restaurant', 'gaststätte', 'gasthaus', 'café', 'cafe', 'coffee', 'bar &', 'pizzeria', 'bistro', 'speisen', 'getränke', 'köfte', 'kebap', 'lokanta']],
  ['Parken', ['parkhaus', 'parkplatz', 'parking', 'parken', 'apcoa', 'contipark']],
  ['Bahn/Flug', ['deutsche bahn', 'db fernverkehr', 'bahncard', 'flug', 'lufthansa', 'boarding', 'airlines', 'pegasus']],
];

const pad2 = (n) => String(n).padStart(2, '0');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Heutiges Datum als 'YYYY-MM-DD' (Ortszeit)
function heuteIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Treffer von DATUM in 'YYYY-MM-DD' umwandeln; '' wenn es kein echtes Kalenderdatum ist
function isoAus(m) {
  let y, mo, d;
  if (m[1]) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
  } else {
    d = Number(m[4]); mo = Number(m[6]);
    y = m[7].length === 2 ? 2000 + Number(m[7]) : Number(m[7]);
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

// Erstes gültiges Datum in Lesereihenfolge; nicht nach heute, nicht älter als 3 Jahre
function datumAus(zeilen, heute) {
  const vorDreiJahren = `${Number(heute.slice(0, 4)) - 3}${heute.slice(4)}`;
  for (const zeile of zeilen) {
    for (const m of zeile.matchAll(new RegExp(DATUM.source, 'g'))) {
      const iso = isoAus(m);
      if (iso && iso <= heute && iso >= vorDreiJahren) return iso;
    }
  }
  return '';
}

// Gewählter Betrag: größter Betrag aus Summenzeilen, sonst größter aus allen übrigen Zeilen
function betragAus(zeilen) {
  const kandidaten = [];
  zeilen.forEach((zeile, nr) => {
    if (AUSSCHLUSS.test(zeile)) return;
    const summe = SUMMEN_WORTE.test(zeile);
    for (const m of zeile.matchAll(new RegExp(BETRAG.source, 'g'))) {
      kandidaten.push({ wert: betragLesen(m[0]), zeile: nr, summe });
    }
  });
  const summen = kandidaten.filter((k) => k.summe);
  const liste = summen.length ? summen : kandidaten;
  let gewaehlt = null;
  for (const k of liste) {
    if (!gewaehlt || k.wert > gewaehlt.wert) gewaehlt = k;
  }
  return gewaehlt;
}

// Erste Währung im Text, sonst null
function waehrungIn(text) {
  for (const [re, code] of WAEHRUNGEN) {
    if (re.test(text)) return code;
  }
  return null;
}

// Erste Zeile mit mindestens 3 Buchstaben, ohne Datum, Betrag, Straße oder PLZ
function haendlerAus(zeilen) {
  for (const zeile of zeilen) {
    const t = zeile.trim();
    if ((t.match(/\p{L}/gu) || []).length < 3) continue;
    if (DATUM.test(t) || BETRAG.test(t)) continue;
    if (STRASSE.test(t) || /(?<!\d)\d{5}(?!\d)/.test(t) || /\s\d{1,4}\s?[a-z]?$/i.test(t)) continue;
    return t;
  }
  return '';
}

// Erste Kategorie, deren Stichwort im Text am Wortanfang vorkommt. Kurze Stichwörter (bis 4 Buchstaben, z. B. „jet“)
// nur als ganzes Wort, sonst löst „Jetzt“ Tanken aus.
function kategorieAus(text) {
  const klein = text.toLowerCase();
  for (const [kategorie, woerter] of KATEGORIE_WOERTER) {
    const ende = (wort) => (wort.length <= 4 ? '(?!\\p{L})' : '');
    if (woerter.some((wort) => new RegExp(`(?<!\\p{L})${esc(wort)}${ende(wort)}`, 'u').test(klein))) return kategorie;
  }
  return '';
}

// Beleg aus Text lesen. heute: 'YYYY-MM-DD' (Vorgabe: heutiges Datum)
export function belegLesen(text, { heute = heuteIso() } = {}) {
  const zeilen = String(text ?? '').split(/\r?\n/);
  const gesamt = zeilen.join('\n');
  const betrag = betragAus(zeilen);
  const waehrung = (betrag && waehrungIn(zeilen[betrag.zeile])) || waehrungIn(gesamt) || 'EUR';
  return {
    datum: datumAus(zeilen, heute),
    betrag: betrag ? betrag.wert : null,
    waehrung,
    haendler: haendlerAus(zeilen),
    kategorie: kategorieAus(gesamt),
  };
}

// Betrag als Zahl lesen: '12,5', '1.234,56', '1,234.56', '7'; sonst null
export function betragLesen(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = String(s ?? '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(t)) return null;
  // Das letzte Trennzeichen ist das Dezimalzeichen, wenn 1 bis 2 Ziffern folgen; alle anderen sind Tausender
  const m = t.match(/^(.*)[.,](\d{1,2})$/);
  const ganz = (m ? m[1] : t).replace(/\D/g, '') || '0';
  const nach = m ? m[2] : '';
  const zahl = Number(nach ? `${ganz}.${nach}` : ganz);
  return Number.isFinite(zahl) ? zahl : null;
}

// Betrag ohne Währungszeichen im deutschen Format, z. B. '1.234,50'
function betragZahl(b) {
  const r = Math.round(Math.abs(b) * 100) / 100;
  const [ganz, cent] = r.toFixed(2).split('.');
  const mitPunkten = ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${b < 0 ? '-' : ''}${mitPunkten},${cent}`;
}

// Betrag mit Währung, z. B. '1.234,50 €', '1.250,00 TRY'; sonst ''
export function betragText(betrag, waehrung) {
  const b = typeof betrag === 'number' ? betrag : betragLesen(betrag);
  if (b == null || !Number.isFinite(b)) return '';
  const code = waehrung || 'EUR';
  return `${betragZahl(b)} ${ZEICHEN[code] ?? code}`;
}

// Belege nach Monat gruppieren; gelöschte fallen weg. Ohne Datum zuerst, dann Monate absteigend.
export function nachMonat(belege = []) {
  const gruppen = new Map();
  for (const beleg of belege) {
    if (!beleg || beleg.geloescht) continue;
    const datum = beleg.datum || '';
    const monat = /^\d{4}-\d{2}/.test(datum) ? datum.slice(0, 7) : '';
    if (!gruppen.has(monat)) {
      gruppen.set(monat, {
        monat,
        titel: monat ? `${MONATE[Number(monat.slice(5, 7)) - 1]} ${monat.slice(0, 4)}` : 'Ohne Datum',
        belege: [],
        summen: {},
      });
    }
    gruppen.get(monat).belege.push(beleg);
  }
  const liste = [...gruppen.values()];
  for (const g of liste) {
    // Neueste zuerst
    g.belege.sort((a, b) => {
      const da = a.datum || '', db = b.datum || '';
      return da < db ? 1 : da > db ? -1 : 0;
    });
    for (const beleg of g.belege) {
      if (!Number.isFinite(beleg.betrag)) continue;
      const w = beleg.waehrung || 'EUR';
      g.summen[w] = (g.summen[w] || 0) + beleg.betrag;
    }
    for (const w of Object.keys(g.summen)) {
      g.summen[w] = Math.round(g.summen[w] * 100) / 100;
    }
  }
  liste.sort((a, b) => {
    if (a.monat === b.monat) return 0;
    if (a.monat === '') return -1;
    if (b.monat === '') return 1;
    return a.monat < b.monat ? 1 : -1;
  });
  return liste;
}

// Erster nicht gelöschter Reiseeintrag an genau diesem Datum, sonst null
export function reiseAm(datum, reisen = []) {
  if (!datum) return null;
  return (reisen || []).find((r) => r && !r.geloescht && r.datum === datum) ?? null;
}

// Dateiname für einen Beleg, z. B. '2026-10-14 Tanken 76,12 EUR.pdf'
export function belegDateiname(beleg) {
  const b = beleg || {};
  const teile = [];
  if (b.datum) teile.push(b.datum);
  const name = b.beschreibung || b.haendler || b.kategorie;
  if (name) teile.push(name);
  if (Number.isFinite(b.betrag)) teile.push(`${betragZahl(b.betrag)} ${b.waehrung || 'EUR'}`);
  const dateiname = teile.join(' ').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  return `${dateiname || 'Beleg'}.pdf`;
}
