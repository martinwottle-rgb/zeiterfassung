// Kontakte: Visitenkarte aus Text (OCR oder QR-Code) lesen, vCard 3.0 bauen, Anzeigenamen bilden.
// Die Heuristik arbeitet zeilen- und blockweise (Leerzeilen trennen Blöcke) und ist nachsichtig.
import { VORNAMEN } from './vornamen.js';

// Beschriftungen vor einem Wert, z. B. „Tel.“, „Mobil:“, „E-Mail:“, „M +44“, „Mob.+20 …“, „E:“.
// Einzelbuchstaben (T, M, F, E) nur mit Doppelpunkt oder direkt vor einer Ziffer bzw. einem +.
const BESCHRIFTUNGEN = [
  { art: 'position', re: /^(?:funktion|position)\s*:\s*/i },
  { art: 'fax', re: /^(?:telefax|fax|f)(?:\s*:\s*|\s+(?=[+(\d]))/i },
  { art: 'firma', re: /^(?:firma|unternehmen|company)\s*:\s*/i },
  { art: 'mail', re: /^(?:e-?mail|mail)(?:\s*:\s*|\s+)|^e\s*:\s*/i },
  { art: 'web', re: /^(?:web|internet|homepage)(?:\s*:\s*|\s+(?=www\.|https?:))/i },
  { art: 'mobil', re: /^(?:mobile|mobil|mob\.?|handy|m)(?:\s*:\s*|\s*(?=[+(\d]))/i },
  { art: 'tel', re: /^(?:telefon|tel\.?|phone|fon|t)(?:\s*:\s*|\s*(?=[+(\d]))/i },
];

const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/u;
const WEB = /(?:https?:\/\/|www\.)[^\s,;]+/i;
// Nummern: Ziffern mit Leerzeichen, /, -, Klammern, optional + oder Klammer am Anfang
const NUMMER = /\+?\(?\d[\d\s\/()\-]*\d\)?/g;
// Beschriftung direkt vor einer Nummer (mitten in der Zeile); Fax-Beschriftung zählt mit
const LABEL_IN = /(?<!\p{L})(?:telefax|telefon|fax|tel\.?|phone|fon|mobil|mobile|handy|mob\.?)(?=\s*(?::|[+(\d]|$))/giu;
// Mobilvorwahlen: deutsch 015x/016x/017x (auch mit +49 oder 0049), britisch +44 7, österreichisch +43 6, schweizerisch +41 7, ägyptisch +20 1
const MOBIL = /^(?:\+49|0049)?0?1[567]|^(?:\+447|00447|\+436|00436|\+417|00417|\+201)/;
// Britische Nummern in Fünfergruppen (Vorwahl mit 0): 07… ist mobil, 01… und 02… sind Telefon.
// Vorrang vor MOBIL, weil 0175 auch eine deutsche Mobilvorwahl ist.
const UK_MOBIL = /^07\d{3} ?\d{3} ?\d{3}$/;
const UK_FEST = /^0[12]\d{3} ?\d{3} ?\d{3}$/;
// Britische Postleitzahl, z. B. „SL0 9HX“
// OCR liest die Ziffer 0 oft als O („SLO 9HX“), deshalb wird O in der Vorwahl-Stelle wieder zur 0
const UK_PLZ = /^[A-Z]{1,2}[\dO][A-Z\dO]?\s?\d[A-Z]{2}$/;
const ukPlz = (s) => s.replace(/^([A-Z]{1,2})O/, '$10');
const RECHTSFORM = /(?<!\p{L})(?:GmbH|AG|KG|Co\.|e\.K\.|Ltd\.?|SE|Inc\.?|S\.A\.|B\.V\.|OHG|UG)(?!\p{L})/iu;
// Branchenwörter, auch als Wortteil (Musterbäckerei)
const BRANCHE = /bäckerei|konditorei|confiserie|fabrik|factory|foods|werk/i;
const FUNKTION = /leiter|geschäftsführ|geschäftsleitung|inhaber|einkauf|vertrieb|produktion|production|manager|management|head|director|sales|purchasing|meister|spezialist|specialist|referent|berater|consultant|ingenieur|engineer|außendienst|key account|projektleiter|technischer|verkauf|export|area|assistent|senior|junior|prokurist|(?<!\p{L})chef(?!\p{L})|(?<!\p{L})ceo(?!\p{L})|(?<!\p{L})cto(?!\p{L})/iu;
const PORTFOLIO = /portfolio|abteilung|department/i;
const STRASSE_WORT = /(?:stra(?:ß|ss)e|str\.|weg|platz|allee|gasse|ring|damm|ufer|hof)(?!\p{L})/iu;
const STRASSE_ANFANG = /^(?:am|an der|im|in der|auf der|zum|zur)\s/i;
// Hausnummer am Ende, auch mit Buchstabe („Gewerbepark Markfeld 7a“)
const HAUSNUMMER = /\s\d{1,4}\s?[a-zA-Z]?$/;
// PLZ mit Ort am Ende, optional mit Länderkürzel (D-73430 oder D -73430), dahinter „, Land“, „ / Land“ oder „ I Land“
const PLZ_ORT = /(?:^|[\s,])(?:(D|A|CH|NL|BE|B|GB|UK|L)\s?-\s?)?(\d{4,5})\s+(\p{Lu}[\p{L}. -]*?)(?:(?:\s*(?:,|\/|\|)\s*|\s+I\s+)(\p{Lu}\p{L}+))?$/u;
const LAENDER = {
  D: 'Deutschland', A: 'Österreich', CH: 'Schweiz', NL: 'Niederlande', B: 'Belgien', BE: 'Belgien',
  GB: 'Vereinigtes Königreich', UK: 'Vereinigtes Königreich', L: 'Luxemburg',
};
const LAND_EN = {
  germany: 'Deutschland', austria: 'Österreich', switzerland: 'Schweiz', netherlands: 'Niederlande', belgium: 'Belgien',
  luxembourg: 'Luxemburg', england: 'Vereinigtes Königreich', 'united kingdom': 'Vereinigtes Königreich',
};
// Rechtsformen und Kürzel, die nie als Müll am Zeilenende gelten
const GESCHUETZT = new Set(['gmbh', 'mbh', 'ag', 'kg', 'kgaa', 'co', 'se', 'ug', 'ohg', 'ltd', 'inc', 'sa', 'bv', 'ek',
  'msc', 'beng', 'ma', 'mba', 'ing', 'dr', 'prof']);
// Freie Mail-Anbieter: aus ihrer Domain lässt sich keine Firma ableiten
const FREIE_ANBIETER = new Set(['gmail', 'googlemail', 'gmx', 'web', 't-online', 'outlook', 'hotmail', 'live', 'msn',
  'yahoo', 'icloud', 'aol', 'freenet', 'online', 'proton', 'protonmail', 'mail', 'posteo', 'arcor']);
// Titel wie „Dr.“, „Prof. Dr.“, „Dipl.-Ing. (FH)“, „Dipl.-Wirt.-Ing. (FH)“, „M.Sc.“
// (Die schließende Klammer fehlt bei OCR manchmal: „Dipl.-Ing. (FH“)
const TITEL_TEIL = String.raw`(?:Prof\.?|Dr\.?|Dipl\.(?:-\p{L}+\.?)+(?:\s*\(\p{L}+\)?)?|Dipl\.|Ing\.|M\.Sc\.|B\.Eng\.|M\.A\.|MBA)`;
const TITEL_ANFANG = new RegExp(`^(${TITEL_TEIL})\\s+`, 'u');
const TITEL_ZEILE = new RegExp(`^${TITEL_TEIL}(?:\\s+${TITEL_TEIL})*$`, 'u');
// Namenswort; ein Punkt am Ende für abgekürzte Vornamen („Hans-F.“)
const NAMENSWORT = /^\p{Lu}[\p{L}'’-]*\.?$/u;
const WORT = /^\p{L}[\p{L}'’-]*$/u;

const leerKontakt = () => ({
  titel: '', vorname: '', nachname: '', firma: '', position: '', telefon: '', mobil: '', email: '', web: '',
  strasse: '', plz: '', ort: '', land: '',
});

// Vergleichsschlüssel: nur Kleinbuchstaben, Umlaute ausgeschrieben
const schluessel = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  .replace(/ß/g, 'ss').replace(/[^a-z]/g, '');

const aufraeumen = (t) => t.replace(/\s+/g, ' ').replace(/^[\s,;]+|[\s,;]+$/g, '');

// Vergleich für Umlaute: ä→a, ö→o, ü→u, ß→ss, Groß/Klein egal
const ohneUmlaut = (s) => String(s).toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
const hatUmlaut = (s) => /[äöüß]/i.test(s);

// Wort ohne Umlaut, das im Gesamttext mit Umlaut steht, bekommt dessen Schreibweise („Dusseldorf“ → „Düsseldorf“)
function umlautAusText(wert, woerter) {
  return wert.replace(/\p{L}+/gu, (w) => {
    if (hatUmlaut(w)) return w;
    const treffer = woerter.find((x) => hatUmlaut(x) && ohneUmlaut(x) === ohneUmlaut(w));
    return treffer || w;
  });
}

// Die Domain zeigt die ue/oe/ae-Schreibweise („duesseldorf.de“): dann bekommt das Wort aus dem Ort die Umlaute
function umlautAusDomain(wert, host) {
  const h = String(host || '').toLowerCase();
  if (!h) return wert;
  return wert.replace(/\p{L}+/gu, (w) => {
    if (hatUmlaut(w) || !/^[a-z]+$/i.test(w)) return w;
    const klein = w.toLowerCase();
    const muster = new RegExp(`(?<![a-z])${[...klein].map((c) => (/[aou]/.test(c) ? `(?:${c}|${c}e)` : c)).join('')}(?![a-z])`);
    const m = h.match(muster);
    if (!m || m[0] === klein) return w;
    let neu = m[0].replace(/ue/g, 'ü').replace(/oe/g, 'ö').replace(/ae/g, 'ä');
    if (w[0] !== w[0].toLowerCase()) neu = neu.charAt(0).toUpperCase() + neu.slice(1);
    return neu;
  });
}

const isFirma = (s) => RECHTSFORM.test(s) || BRANCHE.test(s);

const labelArt = (w) => {
  const x = w.toLowerCase();
  if (x.includes('fax')) return 'fax';
  if (/mob|handy/.test(x)) return 'mobil';
  return 'tel';
};

// Symbol am Zeilenanfang (OCR-Ersatz für Icons): „&“ und „@“, „0“ vor einer Nummer, „M“ vor einem Namen.
// „M +44“ bleibt, das ist die Mobil-Beschriftung.
const symbolEntfernen = (s) => s.replace(/^(?:[&@]\s*|0\s+(?=.*\d)|M\s+(?=\p{L}))/u, '').trim();

// Vorname bekannt? Auch „HANS“ (Großbuchstaben) und „Hans-F.“ (Grundname „hans“)
const vornameBekannt = (w) => {
  const klein = String(w).toLowerCase();
  return VORNAMEN.has(klein) || VORNAMEN.has(klein.split(/[-.]/)[0]);
};

// Zwei oder drei Namenswörter, das erste ein bekannter Vorname („ADNAN KURT“, „Hans-F. Selle“)
function namenZeile(s) {
  const w = titelAbtrennen(s).rest.split(' ').filter(Boolean);
  return w.length >= 2 && w.length <= 3 && w.every((x) => NAMENSWORT.test(x)) && vornameBekannt(w[0]);
}

// Namen in Großbuchstaben in normale Schreibweise: „MARWA“ → „Marwa“, „HANS-F.“ → „Hans-F.“, „TÜNNISSEN“ → „Tünnissen“
const namenWort = (w) => {
  const buchst = w.replace(/[^\p{L}]/gu, '');
  if (buchst.length < 2 || !/^\p{Lu}+$/u.test(buchst)) return w;
  return w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, t, c) => t + c.toUpperCase());
};
const namenSchreibweise = (s) => String(s).split(' ').map(namenWort).join(' ');

// Logo-Zeile: nur Großbuchstaben, Leerzeichen, & und Punkte („TECTORA“, „PACKING & MACHINERY“)
const grossLogo = (s) => /^[\p{Lu}&\s.-]+$/u.test(s) && s.replace(/[^\p{Lu}]/gu, '').length >= 4;
const logoSchreibweise = (s) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, t, c) => t + c.toUpperCase());

// Müll am Zeilenende: kurze Wörter (1 bis 3 Zeichen) ohne Umlaut, Großbuchstabenfolgen bis 4 Zeichen,
// Zeichen ohne Buchstaben. Nummern, Mails, Rechtsformen und Klammern wie „(CEO)“ bleiben.
function muellWort(w) {
  if (/[\d@()]/.test(w)) return false;
  const buchst = w.replace(/[^\p{L}]/gu, '');
  if (!buchst) return true;
  if (GESCHUETZT.has(buchst.toLowerCase())) return false;
  if (buchst.length <= 3) return !/[äöüß]/i.test(buchst);
  return buchst.length <= 4 && /^\p{Lu}+$/u.test(buchst);
}

function muellEntfernen(s) {
  if (namenZeile(s)) return s;
  const w = s.split(' ');
  let n = w.length;
  while (n > 0 && muellWort(w[n - 1])) n--;
  return n === w.length ? s : w.slice(0, n).join(' ').replace(/[\s,;]+$/, '');
}

// Text vor einer Mail: Symbolreste (~, |) und ein angehängtes Logo-Wort in Großbuchstaben („CARRE“) fallen weg
function davorBereinigen(s) {
  const w = String(s).split(/\s+/).filter((x) => /[\p{L}\d]/u.test(x));
  const letzt = w[w.length - 1] || '';
  if (/^\p{Lu}{2,5}$/u.test(letzt) && !GESCHUETZT.has(letzt.toLowerCase())) w.pop();
  return w.join(' ');
}

// Titel vorne abtrennen: „Dr.“, „Prof. Dr.“, „Dipl.-Ing.“
function titelAbtrennen(s) {
  const titel = [];
  let rest = s;
  let m;
  while ((m = rest.match(TITEL_ANFANG))) {
    titel.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  return { titel: titel.join(' '), rest };
}

// Passt der Name (Vorname, Nachname) zum Mail-Lokalteil? vorname.nachname, vnachname, nachname,
// nachnamevorname-Initial (TuennissenK), vorname-Initial nachname (fschmitz), nachnamevorname
function mailPasst(vorname, nachname, lokal) {
  const l = schluessel(lokal);
  if (!l) return false;
  const v = schluessel(vorname);
  const n = schluessel(nachname);
  if (!v || !n) return false;
  return l === v + n || l === n || l === n + v.charAt(0) || l === v.charAt(0) + n || l === n + v;
}

// Name aus einer Zeile, deren Wörter (2 bis 3) zum Mail-Lokalteil passen; Wörter davor oder danach werden abgeschnitten
function nameAusMail(s, lokal) {
  const { titel, rest } = titelAbtrennen(s);
  const w = rest.split(' ').filter(Boolean);
  for (let len = Math.min(3, w.length); len >= 2; len--) {
    for (let st = 0; st + len <= w.length; st++) {
      const f = w.slice(st, st + len);
      if (!f.every((x) => NAMENSWORT.test(x))) continue;
      const vorname = f.slice(0, -1).join(' ');
      const nachname = f[f.length - 1];
      if (mailPasst(vorname, nachname, lokal)) {
        return { titel, vorname: namenSchreibweise(vorname), nachname: namenWort(nachname) };
      }
    }
  }
  return null;
}

// Name ohne Mail: 2 bis 3 großgeschriebene Wörter, das erste steht in der Vornamenliste
function nameLesen(s) {
  const { titel, rest } = titelAbtrennen(s);
  const w = rest.split(' ');
  if (w.length < 2 || w.length > 3) return null;
  if (!w.every((x) => NAMENSWORT.test(x))) return null;
  if (!vornameBekannt(w[0])) return null;
  return { titel, vorname: namenSchreibweise(w.slice(0, -1).join(' ')), nachname: namenWort(w[w.length - 1]) };
}

// Firma aus der Domain (musterfirma.com → Musterfirma). Umlaute holt der Text, wenn dort das Wort mit ü/ä/ö steht.
function firmaAusDomain(host, text) {
  const label = String(host || '').toLowerCase().replace(/^www\./, '').split(/[\/?#:]/)[0].split('.')[0];
  if (!label || FREIE_ANBIETER.has(label)) return '';
  const worte = text.match(/\p{L}+/gu) || [];
  return label.split('-').filter(Boolean).map((w) => {
    const treffer = worte.find((x) => schluessel(x) === schluessel(w)) || w;
    return treffer.charAt(0).toUpperCase() + treffer.slice(1);
  }).join(' ');
}

// Britische Adresse in einer Zeile mit „|“: Straße, Ort, (Grafschaft,) Postcode
function ukAdresse(stuecke, k) {
  const n = stuecke.length;
  k.plz = k.plz || ukPlz(stuecke[n - 1]);
  if (n >= 3) {
    k.strasse = k.strasse || stuecke[0];
    k.ort = k.ort || stuecke[1];
  } else {
    k.ort = k.ort || stuecke[0];
  }
  k.land = k.land || 'Vereinigtes Königreich';
}

// Mobil oder Telefon: die Beschriftung zählt zuerst, dann britische Fünfergruppen, dann die Mobilvorwahlen
function nummerIstMobil(nr, art) {
  if (art === 'mobil') return true;
  const z = nr.replace(/\s+/g, ' ').trim();
  if (UK_MOBIL.test(z)) return true;
  if (UK_FEST.test(z)) return false;
  return MOBIL.test(z.replace(/[\s\/()\-.]/g, ''));
}

// Visitenkarte aus Text lesen. Gibt alle Felder zurück, leere als ''.
export function visitenkarteLesen(text) {
  const k = leerKontakt();

  // OCR-Fehler glätten: „(at)“ wird zu @, Leerzeichen um @ und nach „www.“ fallen weg
  const roh = String(text ?? '')
    .replace(/[ \t]*[(\[]at[)\]][ \t]*/gi, '@')
    .replace(/[ \t]*@[ \t]*/g, '@')
    .replace(/www\.[ \t]+/gi, 'www.')
    // OCR liest „http://“ oft mit nur einem Schrägstrich
    .replace(/(https?:)\/(?=www\.)/gi, '$1//')
    // OCR liest „KG“ oft als „KC“ („GmbH & Co KC“), und Markenzeichen wie „™“ stören in „ST™M“
    .replace(/\bCo(\.?)\s+K[CG]\b/g, 'Co$1 KG')
    // Nummer, die OCR über zwei Zeilen geteilt hat („Mobil: +49“ / „/345 703 57“): wieder zu einer Zeile verbinden
    .replace(/([\d)])[ \t]*\r?\n[ \t]*([\/-][ \t]*\d)/g, '$1 $2')
    .replace(/[™®©]/g, '');

  // Teile: Zeilen, an „·“, „|“ oder „•“ getrennt; jeder Teil merkt sich seinen Block
  const teile = [];
  let block = 0;
  let inhalt = false;
  for (const zeile of roh.split(/\r?\n/)) {
    if (!zeile.trim()) {
      if (inhalt) block++;
      inhalt = false;
      continue;
    }
    inhalt = true;
    // Britische Adresse in einer Zeile mit „|“ (ohne Mail und Web in derselben Zeile)
    const stuecke = zeile.split(/\s*\|\s*/).map(aufraeumen).filter(Boolean);
    if (stuecke.length >= 2 && UK_PLZ.test(stuecke[stuecke.length - 1])
      && !stuecke.some((x) => EMAIL.test(x) || WEB.test(x))) {
      ukAdresse(stuecke, k);
      continue;
    }
    for (const t of zeile.split(/\s*[·|•]\s*/)) {
      const s = aufraeumen(t);
      if (s) teile.push({ s, b: block });
    }
  }

  // Pass 1: Mail, Web, PLZ und Nummern herausziehen; der Rest kommt in „reste“ (mit Blocknummer)
  const reste = [];
  let posBlock = -1;          // „Funktion:“ allein in einer Zeile: die nächste Zeile des Blocks ist die Position
  let plzEintrag = null;      // Index in „reste“ der Zeile direkt über der PLZ-Zeile, und ihr Block
  let mailWoerter = null;     // Wörter vor dem @ (Lokalteil), ggf. mit Vor- und Nachname
  let mailDomain = '';
  for (const { s: rohTeil, b } of teile) {
    const folgtFunktion = posBlock === b;
    posBlock = -1;
    let s = symbolEntfernen(rohTeil);
    // Britische Postleitzahl allein in einer Zeile
    if (UK_PLZ.test(s)) {
      k.plz = k.plz || ukPlz(s);
      k.land = k.land || 'Vereinigtes Königreich';
      continue;
    }
    if (!TITEL_ZEILE.test(s) && !PLZ_ORT.test(s)) s = muellEntfernen(s);
    let art = '';
    for (const bz of BESCHRIFTUNGEN) {
      const m = s.match(bz.re);
      if (m) { art = bz.art; s = s.slice(m[0].length).trim(); break; }
    }
    if (art === 'position' && !s) { posBlock = b; continue; }
    const istPosition = folgtFunktion || art === 'position';
    // Fax-Zeilen ignorieren
    if (art === 'fax') continue;
    // Zeile mit Beschriftung „Firma:“ ist immer die Firma
    if (art === 'firma') { if (!k.firma && s) k.firma = s; continue; }

    // E-Mail; davor stehende Wörter (Vorname Nachname) gehören zum Lokalteil und werden für die Reparatur gemerkt
    const mail = s.match(EMAIL);
    if (mail) {
      const vorher = davorBereinigen(s.slice(0, mail.index));
      const vorWoerter = [];
      if (vorher) {
        for (const w of vorher.split(' ').reverse()) {
          if (vorWoerter.length >= 2 || !WORT.test(w)) break;
          vorWoerter.unshift(w);
        }
      }
      const at = mail[0].indexOf('@');
      if (!k.email) {
        k.email = mail[0];
        mailWoerter = [...vorWoerter, mail[0].slice(0, at)];
        mailDomain = mail[0].slice(at);
      }
      const davor = vorWoerter.length ? vorher.slice(0, vorher.length - vorWoerter.join(' ').length).trim() : vorher;
      s = [davor, s.slice(mail.index + mail[0].length)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }
    if (art === 'mail' || !s) continue;

    // Web: www. oder http, Mail ist schon abgetrennt
    if (art === 'web' || WEB.test(s)) {
      const m = s.match(WEB);
      if (!k.web) k.web = (m ? m[0] : s).replace(/[.,;:]+$/, '').replace(/^www\./i, 'www.');
      s = m ? s.replace(m[0], ' ').replace(/\s+/g, ' ').trim() : '';
      if (!s) continue;
    }

    // PLZ und Ort am Ende; was davor steht, wird weiter unten klassifiziert
    const po = s.match(PLZ_ORT);
    if (po) {
      if (!k.plz) k.plz = po[2];
      if (!k.ort) k.ort = po[3];
      if (!k.land) k.land = po[1] ? (LAENDER[po[1]] || '') : (LAND_EN[(po[4] || '').toLowerCase()] || po[4] || '');
      s = s.slice(0, po.index).replace(/[\s,]+$/, '').trim();
    }

    // Nummern überall in der Zeile; die Beschriftung davor entscheidet (Fax überspringen, Mobil)
    const labels = [...s.matchAll(LABEL_IN)].map((m) => ({ i: m.index, art: labelArt(m[0]) }));
    for (const m of s.matchAll(NUMMER)) {
      if (m[0].replace(/\D/g, '').length < 7) continue;
      let gov = art;
      for (const l of labels) if (l.i < m.index) gov = l.art;
      if (gov === 'fax') continue;
      const nr = m[0].replace(/\s+/g, ' ').trim();
      if (nummerIstMobil(nr, gov)) {
        if (!k.mobil) k.mobil = nr;
      } else if (!k.telefon) {
        k.telefon = nr;
      }
    }
    const rest = s
      .replace(NUMMER, (m) => (m.replace(/\D/g, '').length >= 7 ? ' ' : m))
      .replace(LABEL_IN, ' ')
      .replace(/\s+/g, ' ').trim();
    if (/\p{L}{2,}/u.test(rest)) reste.push({ s: rest, b, pos: istPosition });
    if (po && !plzEintrag) plzEintrag = { idx: reste.length - 1, b };
  }

  // Pass 2: Straße, Firma, Position; der Rest sind Namenskandidaten
  const titelZeile = (reste.find((r) => TITEL_ZEILE.test(r.s)) || {}).s || '';
  // Straße: Zeile direkt über der PLZ-Zeile im selben Block, mit Straßenwort, „Am ...“ oder Hausnummer am Ende
  let strasseIdx = -1;
  if (plzEintrag && reste[plzEintrag.idx] && reste[plzEintrag.idx].b === plzEintrag.b) {
    const c = reste[plzEintrag.idx].s;
    if (STRASSE_WORT.test(c) || STRASSE_ANFANG.test(c) || HAUSNUMMER.test(c)) { strasseIdx = plzEintrag.idx; k.strasse = c; }
  }
  const frei = (i) => i !== strasseIdx && !TITEL_ZEILE.test(reste[i].s);
  let posIdx = reste.findIndex((r, i) => frei(i) && r.pos);
  if (posIdx < 0) posIdx = reste.findIndex((r, i) => frei(i) && !isFirma(r.s) && FUNKTION.test(r.s));
  const firmaIdx = reste.findIndex((r, i) => frei(i) && i !== posIdx && isFirma(r.s));
  let firmaVorIdx = -1;
  if (firmaIdx >= 0) {
    k.firma = reste[firmaIdx].s;
    // Zweizeilige Firma: ein einzelnes Wort ohne Funktion direkt darüber im selben Block gehört dazu
    // („Großekathöfer“ / „Convenience Food GmbH“)
    const v = firmaIdx - 1;
    if (v >= 0 && reste[v].b === reste[firmaIdx].b && frei(v) && v !== posIdx && /^\p{Lu}\p{Ll}\p{L}*$/u.test(reste[v].s)
      && !FUNKTION.test(reste[v].s)) {
      k.firma = `${reste[v].s} ${reste[firmaIdx].s}`;
      firmaVorIdx = v;
    }
  }
  if (!k.strasse) {
    const i = reste.findIndex((r, j) => frei(j) && j !== posIdx && j !== firmaIdx && j !== firmaVorIdx && /\d/.test(r.s)
      && (STRASSE_WORT.test(r.s) || STRASSE_ANFANG.test(r.s)));
    if (i >= 0) { k.strasse = reste[i].s; strasseIdx = i; }
  }

  // Position: „ / “ trennt Sprachen, dann nur der erste Teil. Sonst Folgezeilen im selben Block anhängen,
  // aber nur mehrwörtige Zeilen ohne Ziffer, Mail, Name oder Logo (eine Notiz wie „Zentrallochmierung“ bleibt draußen).
  const verbraucht = new Set([strasseIdx, posIdx, firmaIdx, firmaVorIdx]);
  if (posIdx >= 0) {
    const p = reste[posIdx].s;
    if (/\s\/\s/.test(p)) {
      k.position = p.split(/\s+\/\s+/)[0].trim();
    } else {
      let text = p;
      for (let j = posIdx + 1; j < reste.length && reste[j].b === reste[posIdx].b; j++) {
        const z = reste[j].s;
        // Folgezeile: mehrere Wörter oder ein Funktionswort („Außendienst“); keine Mail, Web- oder Zahlenzeile
        if (!frei(j) || j === firmaIdx || isFirma(z) || PORTFOLIO.test(z) || /\s\/\s/.test(z)
          || STRASSE_WORT.test(z) || STRASSE_ANFANG.test(z) || grossLogo(z) || namenZeile(z)
          || !(/\s/.test(z) || FUNKTION.test(z)) || /[\d@.]/.test(z) || /-/.test(z) || /\p{Ll}{12,}/u.test(z)) break;
        text += ' ' + z;
        verbraucht.add(j);
      }
      k.position = text;
    }
  }

  // Name: zuerst die Zeile, die zum Mail-Lokalteil passt, sonst die Vornamen-Heuristik
  const lokal = mailWoerter ? mailWoerter.join('') : '';
  let name = null;
  let nameIdx = -1;
  const offen = () => reste.map((_, i) => i).filter((i) => frei(i) && !verbraucht.has(i));
  if (lokal) for (const i of offen()) { name = nameAusMail(reste[i].s, lokal); if (name) { nameIdx = i; break; } }
  if (!name) for (const i of offen()) { name = nameLesen(reste[i].s); if (name) { nameIdx = i; break; } }
  if (nameIdx >= 0) verbraucht.add(nameIdx);
  if (name) {
    k.vorname = name.vorname;
    k.nachname = name.nachname;
  }
  k.titel = (name && name.titel) || titelZeile;

  // E-Mail-Reparatur: „Anna Beispiel@x.de“ passt zum Namen → „Anna.Beispiel@x.de“
  if (name && mailWoerter && mailWoerter.length >= 2 && schluessel(lokal) === schluessel(name.vorname + name.nachname)) {
    k.email = mailWoerter.join('.') + mailDomain;
  }

  // Domain der Mail oder der Website (für Firma und Umlaute im Ort)
  const host = k.email.includes('@') ? k.email.slice(k.email.indexOf('@') + 1) : k.web.replace(/^https?:\/\//i, '');

  // Umlaute: OCR liest oft „Dusseldorf“. Steht dasselbe Wort mit Umlaut im Text oder zeigt die Domain die
  // ue/oe/ae-Schreibweise, gilt die Umlaut-Schreibweise. Gilt für Ort und Straße.
  const woerter = roh.match(/\p{L}+/gu) || [];
  if (k.ort) k.ort = umlautAusDomain(umlautAusText(k.ort, woerter), host);
  // OCR liest „ß“ oft als „BB“ („GradestraBBe“)
  if (k.strasse) k.strasse = umlautAusText(k.strasse.replace(/stra(?:BB|B)e/g, 'straße'), woerter);

  // Firma ohne Rechtsform: Logo in Großbuchstaben mit einem Wort aus der Domain („TECTORA“, „PACKING & MACHINERY“).
  // Ohne Domain zählt ein Logo-Wort mit mindestens 5 Buchstaben („BIOKORNTAKT“). Eine Namenszeile zählt nie als Logo.
  if (!k.firma) {
    const label = host.replace(/^www\./i, '').split(/[\/?#:]/)[0].split('.')[0];
    const domainWoerter = label.split('-').map(schluessel).filter((x) => x.length >= 3);
    const passt = (x) => grossLogo(x) && (x.split(/\s+/).some((w) => domainWoerter.includes(schluessel(w)))
      || (!host && x.replace(/[^\p{Lu}]/gu, '').length >= 5));
    const frei2 = offen();
    const start = frei2.find((i) => passt(reste[i].s));
    if (start !== undefined) {
      let a = start;
      let e = start;
      while (a - 1 >= 0 && frei2.includes(a - 1) && reste[a - 1].b === reste[start].b && grossLogo(reste[a - 1].s)) a--;
      while (e + 1 < reste.length && frei2.includes(e + 1) && reste[e + 1].b === reste[start].b && grossLogo(reste[e + 1].s)) e++;
      const logo = [];
      for (let i = a; i <= e; i++) { logo.push(reste[i].s); verbraucht.add(i); }
      k.firma = logoSchreibweise(logo.join(' '));
    }
  }
  // Firma ohne Rechtsform und ohne Logo: aus der Domain der Mail oder der Website
  if (!k.firma) k.firma = firmaAusDomain(host, roh);
  // Titel mit offener Klammer von der OCR („Dipl.-Ing. (FH“) bekommt die schließende dazu
  if (k.titel) k.titel = k.titel.replace(/\((\p{L}+)$/u, '($1)');
  // Umlaute auch in der Firma („Dusseldorf“ bei messe-duesseldorf.de)
  if (k.firma) k.firma = umlautAusDomain(umlautAusText(k.firma, woerter), host);
  return k;
}

// Anzeigename: Titel Vorname Nachname, sonst Firma, sonst „Ohne Namen“
export function kontaktName(k = {}) {
  const name = [k.titel, k.vorname, k.nachname].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  return name || (k.firma || '').trim() || 'Ohne Namen';
}

// Werte aus einer vCard oder MECARD: \n, \, \; und \\ auflösen
const entesc = (s) => String(s ?? '').replace(/\\(.)/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
// Strukturierte Werte (N, ADR) an unmaskierten Semikola trennen, dann auflösen
const felder = (v) => String(v ?? '').split(/(?<!\\);/).map(entesc);

// vCard lesen (BEGIN:VCARD ... END:VCARD). Zeilen werden entfaltet, Parameter spielen nur bei TEL eine Rolle.
export function vcardLesen(text) {
  const k = leerKontakt();
  const zeilen = [];
  for (const z of String(text ?? '').split(/\r?\n/)) {
    if (/^[ \t]/.test(z) && zeilen.length) zeilen[zeilen.length - 1] += z.slice(1);
    else zeilen.push(z);
  }
  let fn = '';
  for (const z of zeilen) {
    const i = z.indexOf(':');
    if (i < 0) continue;
    const kopf = z.slice(0, i).split(';');
    const eigen = kopf[0].replace(/^item\d+\./i, '').toUpperCase();
    const param = kopf.slice(1).join(';').toUpperCase();
    const wert = z.slice(i + 1);
    const p = felder(wert);
    switch (eigen) {
      case 'N':
        k.nachname = (p[0] || '').trim();
        k.vorname = (p[1] || '').trim();
        k.titel = (p[3] || '').trim();
        break;
      case 'FN': fn = entesc(wert).trim(); break;
      case 'ORG': if (!k.firma) k.firma = (p[0] || '').trim(); break;
      case 'TITLE': if (!k.position) k.position = (p[0] || '').split(/\s+\/\s+/)[0].trim(); break;
      case 'TEL': {
        const nr = entesc(wert).replace(/^tel:/i, '').trim();
        if (!nr || /FAX/.test(param)) break;
        if (/CELL|MOBILE/.test(param)) { if (!k.mobil) k.mobil = nr; } else if (!k.telefon) k.telefon = nr;
        break;
      }
      case 'EMAIL': if (!k.email) k.email = entesc(wert).trim(); break;
      case 'URL': if (!k.web) k.web = entesc(wert).trim(); break;
      case 'ADR':
        if (!k.strasse) k.strasse = (p[2] || '').trim();
        if (!k.ort) k.ort = (p[3] || '').trim();
        if (!k.plz) k.plz = (p[5] || '').trim();
        if (!k.land) k.land = (p[6] || '').trim();
        break;
      default: break;
    }
  }
  if (!k.nachname && !k.vorname && fn) {
    const w = fn.split(/\s+/);
    k.nachname = w.pop() || '';
    k.vorname = w.join(' ');
  }
  return k;
}

// MECARD lesen: MECARD:N:Nachname,Vorname;TEL:;EMAIL:;ORG:;ADR:;URL:;
export function mecardLesen(text) {
  const k = leerKontakt();
  const inhalt = String(text ?? '').trim().replace(/^MECARD:/i, '');
  for (const feld of inhalt.split(/(?<!\\);/)) {
    const i = feld.indexOf(':');
    if (i < 0) continue;
    const eigen = feld.slice(0, i).toUpperCase();
    const roh = feld.slice(i + 1);
    const wert = entesc(roh).trim();
    if (!wert) continue;
    switch (eigen) {
      case 'N': {
        const teile = roh.split(/(?<!\\),/).map(entesc).map((x) => x.trim());
        k.nachname = teile[0] || '';
        k.vorname = teile[1] || '';
        break;
      }
      case 'TEL': {
        if (MOBIL.test(wert.replace(/[\s\/()\-.]/g, ''))) { if (!k.mobil) k.mobil = wert; } else if (!k.telefon) k.telefon = wert;
        break;
      }
      case 'EMAIL': if (!k.email) k.email = wert; break;
      case 'ORG': if (!k.firma) k.firma = wert; break;
      case 'URL': if (!k.web) k.web = wert; break;
      case 'ADR': {
        const po = wert.match(PLZ_ORT);
        if (po) {
          k.strasse = wert.slice(0, po.index).replace(/[\s,]+$/, '').trim();
          k.plz = po[2];
          k.ort = po[3];
          k.land = po[4] || '';
        } else {
          k.strasse = wert;
        }
        break;
      }
      default: break;
    }
  }
  return k;
}

// vCard 3.0, Zeilenende CRLF, leere Felder fehlen. Werte werden escaped.
export function vcard(k = {}) {
  const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;')
    .replace(/\r?\n/g, '\\n');
  const z = ['BEGIN:VCARD', 'VERSION:3.0'];
  z.push(`N:${esc(k.nachname)};${esc(k.vorname)};;${esc(k.titel)};`);
  z.push(`FN:${esc(kontaktName(k))}`);
  if (k.firma) z.push(`ORG:${esc(k.firma)}`);
  if (k.position) z.push(`TITLE:${esc(k.position)}`);
  if (k.telefon) z.push(`TEL;TYPE=WORK,VOICE:${esc(k.telefon)}`);
  if (k.mobil) z.push(`TEL;TYPE=CELL:${esc(k.mobil)}`);
  if (k.email) z.push(`EMAIL;TYPE=INTERNET,WORK:${esc(k.email)}`);
  if (k.web) z.push(`URL:${esc(k.web)}`);
  if (k.strasse || k.plz || k.ort || k.land) {
    z.push(`ADR;TYPE=WORK:;;${esc(k.strasse)};${esc(k.ort)};;${esc(k.plz)};${esc(k.land)}`);
  }
  if (k.notiz) z.push(`NOTE:${esc(k.notiz)}`);
  z.push('END:VCARD');
  return z.join('\r\n') + '\r\n';
}
