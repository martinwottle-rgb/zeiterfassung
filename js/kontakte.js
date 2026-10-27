// Kontakte: Visitenkarte aus Text (OCR) lesen, vCard 3.0 bauen, Anzeigenamen bilden.
// Rein, ohne Imports. Die Heuristik arbeitet zeilenweise und ist nachsichtig.

// Beschriftungen vor einem Wert, z. B. „Tel.“, „Mobil:“, „E-Mail:“, „M +44“.
// Einzelbuchstaben (T, M, F) nur mit Doppelpunkt oder Leerzeichen und folgender Ziffer.
const BESCHRIFTUNGEN = [
  { art: 'fax', re: /^(?:fax|f)(?:\s*:\s*|\s+(?=[+(\d]))/i },
  { art: 'firma', re: /^(?:firma|unternehmen|company)\s*:\s*/i },
  { art: 'mail', re: /^(?:e-?mail|mail)(?:\s*:\s*|\s+)/i },
  { art: 'web', re: /^(?:web|internet|homepage)(?:\s*:\s*|\s+(?=www\.|https?:))/i },
  { art: 'mobil', re: /^(?:mobile|mobil|mob\.?|handy|m)(?:\s*:\s*|\s+(?=[+(\d]))/i },
  { art: 'tel', re: /^(?:telefon|tel\.?|phone|fon|t)(?:\s*:\s*|\s+(?=[+(\d]))/i },
];

const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/u;
const WEB = /(?:https?:\/\/|www\.)[^\s,;]+/i;
// Mobilvorwahlen: deutsch 015x/016x/017x (auch mit +49 oder 0049), britisch +44 7
const MOBIL = /^(?:\+49|0049)?0?1[567]|^(?:\+447|00447)/;
const RECHTSFORM = /(?<!\p{L})(?:GmbH|AG|KG|Co\.|e\.K\.|Ltd\.?|SE|Inc\.?|S\.A\.|B\.V\.|OHG|UG)(?!\p{L})/iu;
// Branchenwörter, auch als Wortteil (Musterbäckerei)
const BRANCHE = /bäckerei|konditorei|confiserie|fabrik|factory|foods|werk/i;
const FUNKTION = /leiter|geschäftsführ|inhaber|einkauf|vertrieb|produktion|production|manager|head|director|sales|purchasing|meister|(?<!\p{L})ceo(?!\p{L})/iu;
const STRASSE_WORT = /(?:stra(?:ß|ss)e|str\.|weg|platz|allee|gasse|ring|damm|ufer|hof)(?!\p{L})/iu;
const STRASSE_ANFANG = /^(?:am|an der|im|in der|auf der|zum|zur)\s/i;
// PLZ mit Ort am Ende, optional mit Länderkürzel (D-73430)
const PLZ_ORT = /(?:^|[\s,])(?:(D|A|CH|NL|BE|B|GB|UK|L)-)?(\d{4,5})\s+(\p{Lu}[\p{L}. -]*\p{L}|\p{Lu})$/u;
const LAENDER = {
  D: 'Deutschland', A: 'Österreich', CH: 'Schweiz', NL: 'Niederlande', B: 'Belgien', BE: 'Belgien',
  GB: 'Vereinigtes Königreich', UK: 'Vereinigtes Königreich', L: 'Luxemburg',
};

const leerKontakt = () => ({
  titel: '', vorname: '', nachname: '', firma: '', position: '', telefon: '', mobil: '', email: '', web: '',
  strasse: '', plz: '', ort: '', land: '',
});

// Vergleichsschlüssel: nur Kleinbuchstaben, Umlaute ausgeschrieben
const schluessel = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  .replace(/ß/g, 'ss').replace(/[^a-z]/g, '');

// Titel vorne abtrennen: „Dr.“, „Prof. Dr.“, „Dipl.-Ing.“
function titelAbtrennen(s) {
  const titel = [];
  let rest = s;
  let m;
  while ((m = rest.match(/^(Prof\.?|Dr\.?|Dipl\.-\p{L}+\.?|Dipl\.|Ing\.)\s+/u))) {
    titel.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  return { titel: titel.join(' '), rest };
}

// Name aus einer Zeile mit 2 bis 3 großgeschriebenen Wörtern; Nachname = letztes Wort
function nameLesen(s) {
  const { titel, rest } = titelAbtrennen(s);
  const w = rest.split(' ');
  if (w.length < 2 || w.length > 3) return null;
  if (!w.every((x) => /^\p{Lu}[\p{L}'’-]*$/u.test(x))) return null;
  return { titel, vorname: w.slice(0, -1).join(' '), nachname: w[w.length - 1] };
}

// Zeile passt zum Mail-Lokalteil (vorname.nachname), auch wenn Groß-/Kleinschreibung abweicht
function nameAusMail(s, lokal) {
  const { titel, rest } = titelAbtrennen(s);
  const k = schluessel(rest);
  if (!k || k !== schluessel(lokal)) return null;
  const w = rest.split(' ');
  if (w.length < 2) return null;
  return { titel, vorname: w.slice(0, -1).join(' '), nachname: w[w.length - 1] };
}

// Visitenkarte aus Text lesen. Gibt alle Felder zurück, leere als ''.
export function visitenkarteLesen(text) {
  const k = leerKontakt();

  // OCR-Fehler glätten: „(at)“ wird zu @, Leerzeichen um @ und nach „www.“ fallen weg
  const roh = String(text ?? '')
    .replace(/\s*[(\[]at[)\]]\s*/gi, '@')
    .replace(/\s*@\s*/g, '@')
    .replace(/www\.\s+/gi, 'www.');

  // Zeilen, dann Teile an „·“, „|“ oder „•“ trennen; Leerzeichen zusammenziehen
  const teile = [];
  for (const zeile of roh.split(/\r?\n/)) {
    for (const t of zeile.split(/\s*[·|•]\s*/)) {
      const s = t.replace(/\s+/g, ' ').replace(/^[\s,;:]+|[\s,;:]+$/g, '');
      if (s) teile.push(s);
    }
  }

  // Pass 1: Mail, Web, Telefon, PLZ herausziehen; der Rest kommt in „reste“
  const reste = [];
  for (const teil of teile) {
    let s = teil;
    let art = '';
    for (const b of BESCHRIFTUNGEN) {
      const m = s.match(b.re);
      if (m) { art = b.art; s = s.slice(m[0].length).trim(); break; }
    }
    // Fax-Zeilen ignorieren
    if (art === 'fax') continue;
    // Zeile mit Beschriftung „Firma:“ ist immer die Firma
    if (art === 'firma') { if (!k.firma && s) k.firma = s; continue; }

    // E-Mail, auch ohne Beschriftung
    const mail = s.match(EMAIL);
    if (mail) {
      if (!k.email) k.email = mail[0];
      s = s.replace(mail[0], ' ').replace(/\s+/g, ' ').trim();
    }
    if (art === 'mail' || !s) continue;

    // Web: www. oder http, Mail ist schon abgetrennt
    if (art === 'web' || WEB.test(s)) {
      const m = s.match(WEB);
      if (!k.web) k.web = (m ? m[0] : s).replace(/[.,;:]+$/, '');
      s = m ? s.replace(m[0], ' ').replace(/\s+/g, ' ').trim() : '';
      if (!s) continue;
    }

    // Telefon oder Mobil: mit Beschriftung, oder unbeschriftete Nummer
    const ziffern = s.replace(/\D/g, '').length;
    if (art === 'mobil' || art === 'tel' || (!art && ziffern >= 6 && /^\+?[\d\s\/()\-.]+$/.test(s))) {
      const nr = s.match(/\+?\d[\d\s\/()\-.]*\d/);
      if (nr) {
        const nummer = nr[0].replace(/\s+/g, ' ').trim();
        const kompakt = nummer.replace(/[\s\/()\-.]/g, '');
        // erste Nummer je Art gewinnt
        if (art === 'mobil' || MOBIL.test(kompakt)) { if (!k.mobil) k.mobil = nummer; }
        else if (!k.telefon) k.telefon = nummer;
      }
      continue;
    }

    // PLZ und Ort am Ende; was davor steht, wird weiter klassifiziert
    const po = s.match(PLZ_ORT);
    if (po) {
      if (!k.plz) k.plz = po[2];
      if (!k.ort) k.ort = po[3];
      if (po[1] && !k.land) k.land = LAENDER[po[1]] || '';
      s = s.slice(0, po.index).replace(/[\s,]+$/, '').trim();
      if (!s) continue;
    }
    reste.push(s);
  }

  // Pass 2: Firma, Straße, Funktion; der Rest sind Namenskandidaten
  const kandidaten = [];
  for (const s of reste) {
    if (!k.firma && (RECHTSFORM.test(s) || BRANCHE.test(s))) k.firma = s;
    else if (!k.strasse && /\d/.test(s) && (STRASSE_WORT.test(s) || STRASSE_ANFANG.test(s))) k.strasse = s;
    else if (!k.position && FUNKTION.test(s)) k.position = s;
    else kandidaten.push(s);
  }

  // Name: zuerst die Zeile, die zum Mail-Lokalteil passt, sonst die Heuristik
  let name = null;
  if (k.email) {
    const lokal = k.email.split('@')[0];
    for (const s of kandidaten) { name = nameAusMail(s, lokal); if (name) break; }
  }
  if (!name) {
    for (const s of kandidaten) { name = nameLesen(s); if (name) break; }
  }
  if (name) {
    k.titel = name.titel;
    k.vorname = name.vorname;
    k.nachname = name.nachname;
  }
  return k;
}

// Anzeigename: Titel Vorname Nachname, sonst Firma, sonst „Ohne Namen“
export function kontaktName(k = {}) {
  const name = [k.titel, k.vorname, k.nachname].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  return name || (k.firma || '').trim() || 'Ohne Namen';
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
