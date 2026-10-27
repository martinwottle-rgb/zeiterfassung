// Kontakte: Visitenkarte aus Text (OCR oder QR-Code) lesen, vCard 3.0 bauen, Anzeigenamen bilden.
// Die Heuristik arbeitet zeilen- und blockweise (Leerzeilen trennen Blöcke) und ist nachsichtig.
import { VORNAMEN } from './vornamen.js';

// Beschriftungen vor einem Wert, z. B. „Tel.“, „Mobil:“, „E-Mail:“, „M +44“.
// Einzelbuchstaben (T, M, F) nur mit Doppelpunkt oder Leerzeichen und folgender Ziffer.
const BESCHRIFTUNGEN = [
  { art: 'position', re: /^(?:funktion|position)\s*:\s*/i },
  { art: 'fax', re: /^(?:telefax|fax|f)(?:\s*:\s*|\s+(?=[+(\d]))/i },
  { art: 'firma', re: /^(?:firma|unternehmen|company)\s*:\s*/i },
  { art: 'mail', re: /^(?:e-?mail|mail)(?:\s*:\s*|\s+)/i },
  { art: 'web', re: /^(?:web|internet|homepage)(?:\s*:\s*|\s+(?=www\.|https?:))/i },
  { art: 'mobil', re: /^(?:mobile|mobil|mob\.?|handy|m)(?:\s*:\s*|\s+(?=[+(\d]))/i },
  { art: 'tel', re: /^(?:telefon|tel\.?|phone|fon|t)(?:\s*:\s*|\s+(?=[+(\d]))/i },
];

const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/u;
const WEB = /(?:https?:\/\/|www\.)[^\s,;]+/i;
// Nummern: Ziffern mit Leerzeichen, /, -, Klammern, optional + oder Klammer am Anfang
const NUMMER = /\+?\(?\d[\d\s\/()\-]*\d\)?/g;
// Beschriftung direkt vor einer Nummer (mitten in der Zeile); Fax-Beschriftung zählt mit
const LABEL_IN = /(?<!\p{L})(?:telefax|telefon|fax|tel\.?|phone|fon|mobil|mobile|handy|mob\.?)(?=\s*(?::|[+(\d]|$))/giu;
// Mobilvorwahlen: deutsch 015x/016x/017x (auch mit +49 oder 0049), britisch +44 7, österreichisch +43 6, schweizerisch +41 7
const MOBIL = /^(?:\+49|0049)?0?1[567]|^(?:\+447|00447|\+436|00436|\+417|00417)/;
const RECHTSFORM = /(?<!\p{L})(?:GmbH|AG|KG|Co\.|e\.K\.|Ltd\.?|SE|Inc\.?|S\.A\.|B\.V\.|OHG|UG)(?!\p{L})/iu;
// Branchenwörter, auch als Wortteil (Musterbäckerei)
const BRANCHE = /bäckerei|konditorei|confiserie|fabrik|factory|foods|werk/i;
const FUNKTION = /leiter|geschäftsführ|geschäftsleitung|inhaber|einkauf|vertrieb|produktion|production|manager|head|director|sales|purchasing|meister|spezialist|specialist|referent|berater|consultant|ingenieur|engineer|außendienst|key account|projektleiter|technischer|verkauf|export|area|assistent|senior|junior|prokurist|(?<!\p{L})ceo(?!\p{L})|(?<!\p{L})cto(?!\p{L})/iu;
const PORTFOLIO = /portfolio|abteilung|department/i;
const STRASSE_WORT = /(?:stra(?:ß|ss)e|str\.|weg|platz|allee|gasse|ring|damm|ufer|hof)(?!\p{L})/iu;
const STRASSE_ANFANG = /^(?:am|an der|im|in der|auf der|zum|zur)\s/i;
// PLZ mit Ort am Ende, optional mit Länderkürzel (D-73430) und optional „, Land“ dahinter
const PLZ_ORT = /(?:^|[\s,])(?:(D|A|CH|NL|BE|B|GB|UK|L)-)?(\d{4,5})\s+(\p{Lu}[\p{L}. -]*\p{L}|\p{Lu})(?:,\s*(\p{Lu}\p{L}+))?$/u;
const LAENDER = {
  D: 'Deutschland', A: 'Österreich', CH: 'Schweiz', NL: 'Niederlande', B: 'Belgien', BE: 'Belgien',
  GB: 'Vereinigtes Königreich', UK: 'Vereinigtes Königreich', L: 'Luxemburg',
};
// Rechtsformen und Kürzel, die nie als Müll am Zeilenende gelten
const GESCHUETZT = new Set(['gmbh', 'mbh', 'ag', 'kg', 'kgaa', 'co', 'se', 'ug', 'ohg', 'ltd', 'inc', 'sa', 'bv', 'ek',
  'msc', 'beng', 'ma', 'mba', 'ing', 'dr', 'prof']);
// Freie Mail-Anbieter: aus ihrer Domain lässt sich keine Firma ableiten
const FREIE_ANBIETER = new Set(['gmail', 'googlemail', 'gmx', 'web', 't-online', 'outlook', 'hotmail', 'live', 'msn',
  'yahoo', 'icloud', 'aol', 'freenet', 'online', 'proton', 'protonmail', 'mail', 'posteo', 'arcor']);
// Titel wie „Dr.“, „Prof. Dr.“, „Dipl.-Ing. (FH)“, „M.Sc.“
const TITEL_TEIL = String.raw`(?:Prof\.?|Dr\.?|Dipl\.-\p{L}+\.?(?:\s*\(\p{L}+\))?|Dipl\.|Ing\.|M\.Sc\.|B\.Eng\.|M\.A\.|MBA)`;
const TITEL_ANFANG = new RegExp(`^(${TITEL_TEIL})\\s+`, 'u');
const TITEL_ZEILE = new RegExp(`^${TITEL_TEIL}(?:\\s+${TITEL_TEIL})*$`, 'u');
const NAMENSWORT = /^\p{Lu}[\p{L}'’-]*$/u;
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

// Müll am Zeilenende: kurze Wörter (1 bis 3 Zeichen) ohne Umlaut, Großbuchstabenfolgen bis 4 Zeichen,
// Zeichen ohne Buchstaben. Nummern, Mails und Rechtsformen bleiben.
function muellWort(w) {
  if (/[\d@]/.test(w)) return false;
  const buchst = w.replace(/[^\p{L}]/gu, '');
  if (!buchst) return true;
  if (GESCHUETZT.has(buchst.toLowerCase())) return false;
  if (buchst.length <= 3) return !/[äöüß]/i.test(buchst);
  return buchst.length <= 4 && /^\p{Lu}+$/u.test(buchst);
}

function muellEntfernen(s) {
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
// nachnamevorname-Initial (TuennissenK), nachnamevorname
function mailPasst(vorname, nachname, lokal) {
  const l = schluessel(lokal);
  if (!l) return false;
  const v = schluessel(vorname);
  const n = schluessel(nachname);
  if (!v || !n) return false;
  return l === v + n || l === n || l === n + v.charAt(0) || l === n + v;
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
      if (mailPasst(vorname, nachname, lokal)) return { titel, vorname, nachname };
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
  if (!VORNAMEN.has(w[0].toLowerCase())) return null;
  return { titel, vorname: w.slice(0, -1).join(' '), nachname: w[w.length - 1] };
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

// Visitenkarte aus Text lesen. Gibt alle Felder zurück, leere als ''.
export function visitenkarteLesen(text) {
  const k = leerKontakt();

  // OCR-Fehler glätten: „(at)“ wird zu @, Leerzeichen um @ und nach „www.“ fallen weg
  const roh = String(text ?? '')
    .replace(/[ \t]*[(\[]at[)\]][ \t]*/gi, '@')
    .replace(/[ \t]*@[ \t]*/g, '@')
    .replace(/www\.[ \t]+/gi, 'www.')
    // OCR liest „http://“ oft mit nur einem Schrägstrich
    .replace(/(https?:)\/(?=www\.)/gi, '$1//');

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
      if (!k.web) k.web = (m ? m[0] : s).replace(/[.,;:]+$/, '');
      s = m ? s.replace(m[0], ' ').replace(/\s+/g, ' ').trim() : '';
      if (!s) continue;
    }

    // PLZ und Ort am Ende; was davor steht, wird weiter unten klassifiziert
    const po = s.match(PLZ_ORT);
    if (po) {
      if (!k.plz) k.plz = po[2];
      if (!k.ort) k.ort = po[3];
      if (!k.land) k.land = po[1] ? (LAENDER[po[1]] || '') : (po[4] || '');
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
      if (gov === 'mobil' || MOBIL.test(nr.replace(/[\s\/()\-.]/g, ''))) {
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
  // Straße: Zeile direkt über der PLZ-Zeile im selben Block, mit Straßenwort oder am Zeilenanfang „Am ...“
  let strasseIdx = -1;
  if (plzEintrag && reste[plzEintrag.idx] && reste[plzEintrag.idx].b === plzEintrag.b) {
    const c = reste[plzEintrag.idx].s;
    if (STRASSE_WORT.test(c) || STRASSE_ANFANG.test(c)) { strasseIdx = plzEintrag.idx; k.strasse = c; }
  }
  const frei = (i) => i !== strasseIdx && !TITEL_ZEILE.test(reste[i].s);
  let posIdx = reste.findIndex((r, i) => frei(i) && r.pos);
  if (posIdx < 0) posIdx = reste.findIndex((r, i) => frei(i) && !isFirma(r.s) && FUNKTION.test(r.s));
  const firmaIdx = reste.findIndex((r, i) => frei(i) && i !== posIdx && isFirma(r.s));
  if (firmaIdx >= 0) k.firma = reste[firmaIdx].s;
  if (!k.strasse) {
    const i = reste.findIndex((r, j) => frei(j) && j !== posIdx && j !== firmaIdx && /\d/.test(r.s)
      && (STRASSE_WORT.test(r.s) || STRASSE_ANFANG.test(r.s)));
    if (i >= 0) { k.strasse = reste[i].s; strasseIdx = i; }
  }

  // Position: „ / “ trennt Sprachen, dann nur der erste Teil. Sonst Folgezeilen im selben Block anhängen.
  const verbraucht = new Set([strasseIdx, posIdx, firmaIdx]);
  if (posIdx >= 0) {
    const p = reste[posIdx].s;
    if (/\s\/\s/.test(p)) {
      k.position = p.split(/\s+\/\s+/)[0].trim();
    } else {
      let text = p;
      for (let j = posIdx + 1; j < reste.length && reste[j].b === reste[posIdx].b; j++) {
        const z = reste[j].s;
        // Ein einzelnes Wort in Großbuchstaben (Logo-Rest wie „CARRE“) gehört nicht zur Position
        if (!frei(j) || j === firmaIdx || isFirma(z) || PORTFOLIO.test(z) || /\s\/\s/.test(z)
          || STRASSE_WORT.test(z) || STRASSE_ANFANG.test(z) || /^\p{Lu}{4,}$/u.test(z)) break;
        text += ' ' + z;
        verbraucht.add(j);
      }
      k.position = text;
    }
  }

  // Name: zuerst die Zeile, die zum Mail-Lokalteil passt, sonst die Vornamen-Heuristik
  const kandidaten = reste.filter((r, i) => frei(i) && !verbraucht.has(i)).map((r) => r.s);
  const lokal = mailWoerter ? mailWoerter.join('') : '';
  let name = null;
  if (lokal) for (const s of kandidaten) { name = nameAusMail(s, lokal); if (name) break; }
  if (!name) for (const s of kandidaten) { name = nameLesen(s); if (name) break; }
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
  if (k.strasse) k.strasse = umlautAusText(k.strasse, woerter);

  // Firma ohne Rechtsform: aus der Domain der Mail oder der Website
  if (!k.firma) k.firma = firmaAusDomain(host, roh);
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
