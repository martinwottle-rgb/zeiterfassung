// Visitenkarte aus einem Foto: QR-Code (vCard, MECARD oder URL) und Texterkennung zusammenführen.
// QR-Werte haben Vorrang, leere QR-Felder werden aus der Texterkennung gefüllt.
import { qrSuchen } from './qr.js';
import { textBloecke } from './ocr.js';
// Namensraum statt benannter Importe: fehlende Funktionen brechen so nicht das ganze Modul
import * as kontakte from './kontakte.js';

const FELDER = ['titel', 'vorname', 'nachname', 'firma', 'position', 'telefon', 'mobil', 'email', 'web',
  'strasse', 'plz', 'ort', 'land'];
const SICHER_AB = 80;
const RAND = 0.06;
const URL_FORM = /^(?:https?:\/\/|www\.)\S+$|^[\p{L}\d-]+\.(?:de|com|net|org|eu|info|biz|at|ch|nl|be|io)(?:\/\S*)?$/iu;

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

// QR-Inhalt deuten: vCard, MECARD oder nur eine Web-Adresse
function qrDeuten(text) {
  const t = String(text ?? '').trim();
  if (/^BEGIN:VCARD/i.test(t)) return kontakte.vcardLesen?.(t) ?? null;
  if (/^MECARD:/i.test(t)) return kontakte.mecardLesen?.(t) ?? null;
  if (URL_FORM.test(t) && !t.includes('@')) return { ...leer(), web: t };
  return null;
}

// Foto (Blob) einer Visitenkarte lesen. Liefert {felder, quelle, unsicher, text}.
export async function kontaktAusBild(blob, fortschritt) {
  const eigenes = blob instanceof Blob;
  const bitmap = eigenes ? await createImageBitmap(blob) : blob;
  try {
    const W = bitmap.width;
    const H = bitmap.height;
    const canvas = flaeche(W, H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, W, H);

    // 1. QR-Code suchen und seinen Inhalt deuten
    const qr = await qrSuchen(bitmap);
    const qrFelder = qr ? qrDeuten(qr.text) : null;

    // 2. QR-Fläche übermalen, damit die Texterkennung den Code nicht liest
    if (qr) qrUebermalen(ctx, qr.ecken);

    // 3. Texterkennung blockweise, in Lesereihenfolge
    const blocke = spaltenSortieren(await textBloecke(canvas, fortschritt));
    const text = blocke.map((b) => b.text).join('\n\n');
    const ocrFelder = kontakte.visitenkarteLesen(text);

    // 4. Zusammenführen: QR-Werte zuerst, leere Felder aus der Texterkennung
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
    return { felder, quelle, unsicher, text };
  } finally {
    if (eigenes) bitmap.close();
  }
}
