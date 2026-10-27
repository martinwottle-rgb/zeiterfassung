// Visitenkarte aus einem Foto: Karte finden und entzerren, QR-Code (vCard, MECARD oder URL) und Texterkennung zusammenführen.
// QR-Werte haben Vorrang, leere QR-Felder werden aus der Texterkennung gefüllt. Ein QR-Code, der nur eine Web-Adresse
// enthält, wird nicht als Web übernommen, sondern als qrLink zurückgegeben.
import { qrSuchen } from './qr.js';
import { textBloecke } from './ocr.js';
import { karteErkennen } from './kantenerkennung.js';
import { entzerren, homographie, punktAbbilden } from './zuschnitt.js';
// Namensraum statt benannter Importe: fehlende Funktionen brechen so nicht das ganze Modul
import * as kontakte from './kontakte.js';

const FELDER = ['titel', 'vorname', 'nachname', 'firma', 'position', 'telefon', 'mobil', 'email', 'web',
  'strasse', 'plz', 'ort', 'land'];
const SICHER_AB = 80;
const RAND = 0.06;
const URL_FORM = /^(?:https?:\/\/|www\.)\S+$|^[\p{L}\d-]+\.(?:de|com|net|org|eu|info|biz|at|ch|nl|be|io)(?:\/\S*)?$/iu;
const KARTE_MIN = 1600; // lange Seite der entzerrten Karte: mindestens 1600 px ...
const KARTE_MAX = 2400; // ... höchstens 2400 px (sonst wird die Entzerrung zu langsam)
// Karte vor der Texterkennung suchen und entzerren. Aus: Die Kartenerkennung (kantenerkennung.js) findet noch nicht
// zuverlässig die Karte; entzerrt wird dann falsch und die Erkennung wird schlechter (karten.html 42 statt 146 Felder).
const KARTE_ENTZERREN = false;
const DUNKEL = 110; // mittlere Helligkeit unter diesem Wert: dunkle Karte, Texterkennung auf Invertiertes

const leer = () => Object.fromEntries(FELDER.map((f) => [f, '']));
// Für Vergleiche: nur Buchstaben und Ziffern, Groß-/Kleinschreibung egal
const normal = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Zeichenfläche (Canvas) in Bildgröße
function flaeche(breite, hoehe) {
  const c = document.createElement('canvas');
  c.width = breite;
  c.height = hoehe;
  return c;
}

// QR-Fläche weiß übermalen: Ecken werden um 6 % der mittleren Kantenlänge nach außen geschoben
function qrUebermalen(ctx, ecken) {
  const cx = ecken.reduce((s, p) => s + p.x, 0) / 4;
  const cy = ecken.reduce((s, p) => s + p.y, 0) / 4;
  let kanten = 0;
  for (let i = 0; i < 4; i++) {
    const a = ecken[i];
    const b = ecken[(i + 1) % 4];
    kanten += Math.hypot(b.x - a.x, b.y - a.y) / 4;
  }
  const rand = kanten * RAND;
  const aussen = ecken.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const laenge = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / laenge) * rand, y: p.y + (dy / laenge) * rand };
  });
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  aussen.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Blöcke nach Lage sortieren: Blöcke mit überschneidenden x-Bereichen bilden eine Spalte.
// Spalten links nach rechts, innerhalb einer Spalte oben nach unten.
function spaltenSortieren(blocke) {
  const eltern = blocke.map((_, i) => i);
  const finde = (i) => {
    while (eltern[i] !== i) {
      eltern[i] = eltern[eltern[i]];
      i = eltern[i];
    }
    return i;
  };
  for (let i = 0; i < blocke.length; i++) {
    for (let j = i + 1; j < blocke.length; j++) {
      const a = blocke[i];
      const b = blocke[j];
      if (a.x < b.x + b.b && b.x < a.x + a.b) eltern[finde(i)] = finde(j);
    }
  }
  const spalten = new Map();
  blocke.forEach((b, i) => {
    const wurzel = finde(i);
    if (!spalten.has(wurzel)) spalten.set(wurzel, []);
    spalten.get(wurzel).push(b);
  });
  return [...spalten.values()]
    .map((s) => s.sort((a, b) => a.y - b.y || a.x - b.x))
    .sort((s, t) => Math.min(...s.map((b) => b.x)) - Math.min(...t.map((b) => b.x)))
    .flat();
}

// Sicherheit des kleinsten Blocks, in dem der Feldwert vorkommt; null, wenn kein Block passt
function sicherheitVon(wert, blocke) {
  const k = normal(wert);
  if (!k) return null;
  const treffer = blocke.filter((b) => normal(b.text).includes(k));
  if (!treffer.length) return null;
  return Math.min(...treffer.map((b) => b.sicherheit));
}

// QR-Inhalt deuten: vCard oder MECARD liefert Felder. Eine reine Web-Adresse ist kein Feld, sondern ein Link.
function qrDeuten(text) {
  const t = String(text ?? '').trim();
  if (/^BEGIN:VCARD/i.test(t)) return kontakte.vcardLesen?.(t) ?? null;
  if (/^MECARD:/i.test(t)) return kontakte.mecardLesen?.(t) ?? null;
  return null;
}

// Nur eine Web-Adresse im QR-Code (keine vCard, keine MECARD, keine E-Mail): als Link zurückgeben
function qrLinkDeuten(text) {
  const t = String(text ?? '').trim();
  if (/^(BEGIN:VCARD|MECARD:)/i.test(t) || t.includes('@')) return null;
  return URL_FORM.test(t) ? t : null;
}

// Mittlere Helligkeit (Stichprobe jedes 4. Pixels)
function mittlereHelligkeit(ctx, breite, hoehe) {
  const d = ctx.getImageData(0, 0, breite, hoehe).data;
  let summe = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 16) {
    summe += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    n++;
  }
  return n ? summe / n : 255;
}

// Farben umkehren (Alphawert bleibt)
function invertieren(ctx, breite, hoehe) {
  const bild = ctx.getImageData(0, 0, breite, hoehe);
  const d = bild.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  ctx.putImageData(bild, 0, 0);
}

// Karte im Foto suchen und auf Kartengröße entzerren. Liefert {canvas, zurRaum}, wobei zurRaum einen Punkt des
// Originalfotos auf die Fläche des Canvas abbildet. Gibt es keine Karte, ist es das ganze Foto ohne Entzerrung.
async function karteEntzerren(bitmap) {
  const W = bitmap.width;
  const H = bitmap.height;
  let ecken = null;
  if (KARTE_ENTZERREN) {
    try {
      ecken = await karteErkennen(bitmap);
    } catch {
      ecken = null; // OpenCV nicht verfügbar: ohne Zuschnitt weiter
    }
  }
  const quelle = flaeche(W, H);
  const qctx = quelle.getContext('2d', { willReadFrequently: true });
  qctx.drawImage(bitmap, 0, 0, W, H);
  if (KARTE_ENTZERREN && ecken) {
    try {
      const d = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
      const breite0 = Math.max(d(ecken[0], ecken[1]), d(ecken[3], ecken[2]));
      const hoehe0 = Math.max(d(ecken[0], ecken[3]), d(ecken[1], ecken[2]));
      const lang = Math.max(breite0, hoehe0, 1);
      const f = Math.min(Math.max(lang, KARTE_MIN), KARTE_MAX) / lang;
      const breite = Math.max(1, Math.round(breite0 * f));
      const hoehe = Math.max(1, Math.round(hoehe0 * f));
      const bild = entzerren(qctx.getImageData(0, 0, W, H), ecken, breite, hoehe);
      const canvas = flaeche(breite, hoehe);
      canvas.getContext('2d', { willReadFrequently: true }).putImageData(bild, 0, 0);
      // Abbildung Foto → Karte (Umkehrung der Entzerrung), für Koordinaten aus dem Originalfoto
      const h = homographie(ecken, [{ x: 0, y: 0 }, { x: breite, y: 0 }, { x: breite, y: hoehe }, { x: 0, y: hoehe }]);
      return { canvas, zurRaum: (p) => punktAbbilden(h, p) };
    } catch {
      // degenerierte Ecken: Foto ohne Zuschnitt verwenden
    }
  }
  return { canvas: quelle, zurRaum: (p) => p };
}

// Foto (Blob) einer Visitenkarte lesen. Liefert {felder, quelle, unsicher, text, qrLink}.
export async function kontaktAusBild(blob, fortschritt) {
  const eigenes = blob instanceof Blob;
  const bitmap = eigenes ? await createImageBitmap(blob) : blob;
  try {
    // 1. Karte finden und entzerren; darauf arbeiten alle folgenden Schritte
    const { canvas, zurRaum } = await karteEntzerren(bitmap);
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // 2. QR-Code suchen (auf der Karte, sonst im ganzen Foto) und seinen Inhalt deuten
    let qr = await qrSuchen(canvas);
    let qrEcken = qr?.ecken ?? null;
    if (!qr) {
      const roh = await qrSuchen(bitmap);
      if (roh) {
        qr = roh;
        qrEcken = roh.ecken.map(zurRaum);
      }
    }
    const qrFelder = qr ? qrDeuten(qr.text) : null;
    const qrLink = qr ? qrLinkDeuten(qr.text) : null;

    // 3. QR-Fläche übermalen, damit die Texterkennung den Code nicht liest (vor dem Invertieren)
    if (qr) qrUebermalen(ctx, qrEcken);

    // 4. Dunkle Karte: für die Texterkennung invertieren
    if (mittlereHelligkeit(ctx, W, H) < DUNKEL) invertieren(ctx, W, H);

    // 5. Texterkennung blockweise, in Lesereihenfolge
    const blocke = spaltenSortieren(await textBloecke(canvas, fortschritt));
    const text = blocke.map((b) => b.text).join('\n\n');
    const ocrFelder = kontakte.visitenkarteLesen(text);

    // 6. Zusammenführen: QR-Werte zuerst, leere Felder aus der Texterkennung
    const felder = leer();
    const unsicher = [];
    let qrGenutzt = false;
    let ocrGenutzt = false;
    for (const f of FELDER) {
      const q = (qrFelder?.[f] ?? '').trim();
      if (q) {
        felder[f] = q;
        qrGenutzt = true;
        continue;
      }
      const v = (ocrFelder?.[f] ?? '').trim();
      felder[f] = v;
      if (!v) continue;
      ocrGenutzt = true;
      const s = sicherheitVon(v, blocke);
      if (s !== null && s < SICHER_AB) unsicher.push(f);
    }

    const quelle = qrGenutzt && ocrGenutzt ? 'qr+ocr' : qrGenutzt ? 'qr' : 'ocr';
    return { felder, quelle, unsicher, text, qrLink };
  } finally {
    if (eigenes) bitmap.close();
  }
}

// Mehrere Seiten einer Karte (Vorder- und Rückseite, Notiz) lesen und zusammenführen:
// erste Seite hat Vorrang, leere Felder werden aus weiteren Seiten gefüllt, Texte mit Leerzeile verbunden.
export async function kontaktAusSeiten(blobs, fortschritt) {
  const felder = leer();
  const unsicher = new Set();
  const texte = [];
  let qrLink = null;
  let qrGenutzt = false;
  let ocrGenutzt = false;
  for (const blob of blobs) {
    const r = await kontaktAusBild(blob, fortschritt);
    for (const f of FELDER) {
      if (felder[f] || !r.felder[f]) continue;
      felder[f] = r.felder[f];
      if (r.unsicher.includes(f)) unsicher.add(f);
    }
    if (!qrLink && r.qrLink) qrLink = r.qrLink;
    if (r.text) texte.push(r.text);
    if (r.quelle.includes('qr')) qrGenutzt = true;
    if (r.quelle.includes('ocr')) ocrGenutzt = true;
  }
  const quelle = qrGenutzt && ocrGenutzt ? 'qr+ocr' : qrGenutzt ? 'qr' : 'ocr';
  return {
    felder,
    quelle,
    unsicher: FELDER.filter((f) => unsicher.has(f)),
    text: texte.join('\n\n'),
    qrLink,
  };
}
