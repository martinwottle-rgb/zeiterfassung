// Vorschläge aus PC-Zeiten und Outlook-Terminen. Nur am Laptop (kontext.laptop), am iPhone leere Listen.
// Vorschläge werden nie ohne Klick eingetragen. Zeit kommt aus kontext.heute, nie aus der Uhr.
import { alle, speichern } from './speicher.js';
import { addTage, wochentag } from './zeit.js';
import { feiertag } from './feiertage.js';
import { abwesenheitAm, bloeckeAm } from './rechnen.js';

const TTL = 10 * 60 * 1000;      // Antworten des Laptop-Servers 10 Minuten zwischenspeichern
const PAUSE_TRENNT = 30;         // Lücken ab 30 min trennen Blöcke, kürzere werden überbrückt
const VERWORFEN = 'zeit.verworfen';

const zwischenspeicher = new Map();

// Antwort des Laptop-Servers als JSON. Fehler werden geworfen; der Aufrufer macht daraus eine leere Liste.
async function laden(pfad) {
  const treffer = zwischenspeicher.get(pfad);
  if (treffer && Date.now() - treffer.zeit < TTL) return treffer.daten;
  const antwort = await fetch(pfad, { cache: 'no-store' });
  if (!antwort.ok) throw new Error('Laptop-Server antwortet mit ' + antwort.status);
  const daten = await antwort.json();
  zwischenspeicher.set(pfad, { zeit: Date.now(), daten });
  return daten;
}

// An-Phasen eines Tages aus Beginn, Ende und Lücken (Minuten).
function bloeckeAusPc({ beginn, ende, luecken }) {
  const trenner = (Array.isArray(luecken) ? luecken : [])
    .filter((l) => Array.isArray(l) && l.length === 2 && Number.isFinite(l[0]) && Number.isFinite(l[1]))
    .filter((l) => l[1] - l[0] >= PAUSE_TRENNT)
    .sort((a, b) => a[0] - b[0]);
  const bloecke = [];
  let start = beginn;
  for (const [von, bis] of trenner) {
    if (von <= start) {          // Lücke beginnt schon vor dem laufenden Block
      start = Math.max(start, bis);
      continue;
    }
    if (von >= ende) break;
    bloecke.push({ beginn: start, ende: von });
    start = Math.min(bis, ende);
  }
  if (ende > start) bloecke.push({ beginn: start, ende });
  return bloecke;
}

// Darf der Tag einen PC-Vorschlag bekommen? Werktag, nach Beginn der Erfassung, ohne Blöcke, ohne Feiertag, ohne ganztägige Abwesenheit.
function tagPasst(datum, kontext) {
  const { bloecke, abwesenheiten: abw, einstellungen: einst } = kontext.daten;
  if (wochentag(datum) > 4) return false;
  if (einst.start && datum < einst.start) return false;
  if (bloeckeAm(bloecke, datum).length > 0) return false;
  if (feiertag(datum)) return false;
  const a = abwesenheitAm(abw, datum);
  if (a && !a.halbtag) return false;
  return true;
}

// Verworfene Vorschläge (Schlüssel wie „pc:2026-10-19“) merkt sich das Gerät.
function verworfeneListe() {
  try {
    const liste = JSON.parse(localStorage.getItem(VERWORFEN) ?? '[]');
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];
  }
}

export function verwerfen(schluessel) {
  try {
    const liste = verworfeneListe();
    if (!liste.includes(schluessel)) liste.push(schluessel);
    localStorage.setItem(VERWORFEN, JSON.stringify(liste));
  } catch {
    // Ohne Speicher erscheint der Vorschlag nach dem nächsten Laden wieder
  }
}

export function istVerworfen(schluessel) {
  return verworfeneListe().includes(schluessel);
}

// PC-Vorschläge für Werktage der letzten 14 Tage (ohne heute). Blöcke aus den An-Phasen des PCs.
export async function pcVorschlaege(kontext) {
  if (!kontext?.laptop) return [];
  try {
    const von = addTage(kontext.heute, -14);
    const bis = addTage(kontext.heute, -1);
    const pc = await laden(`/api/pczeiten?von=${von}&bis=${bis}`);
    const liste = [];
    for (const datum of Object.keys(pc ?? {}).sort()) {
      if (datum < von || datum > bis) continue;
      const tag = pc[datum];
      if (!tag || !Number.isFinite(tag.beginn) || !Number.isFinite(tag.ende)) continue;
      if (!tagPasst(datum, kontext)) continue;
      const bloecke = bloeckeAusPc(tag);
      if (bloecke.length === 0) continue;
      const schluessel = `pc:${datum}`;
      if (istVerworfen(schluessel)) continue;
      liste.push({ datum, bloecke, quelle: 'pc', schluessel });
    }
    return liste;
  } catch {
    return [];
  }
}

// Outlook-Termine der letzten und nächsten 14 Tage mit Ort außerhalb des Arbeitsorts, für Tage ohne Reisetag.
export async function reiseVorschlaege(kontext) {
  if (!kontext?.laptop) return [];
  try {
    // Ohne Arbeitsort ist nicht erkennbar, was eine Reise ist
    const arbeitsort = String(kontext.daten.einstellungen?.arbeitsort ?? '').trim().toLowerCase();
    if (arbeitsort === '') return [];
    const von = addTage(kontext.heute, -14);
    const bis = addTage(kontext.heute, 14);
    const termine = await laden(`/api/termine?von=${von}&bis=${bis}`);
    const reisen = (await alle('reisen')).filter((r) => !r.geloescht);
    const belegt = new Set(reisen.map((r) => r.datum));
    const liste = [];
    for (const t of Array.isArray(termine) ? termine : []) {
      if (!t || typeof t.datum !== 'string' || t.datum < von || t.datum > bis) continue;
      const ort = String(t.ort ?? '').trim();
      if (ort === '' || ort.toLowerCase().includes(arbeitsort)) continue;
      if (belegt.has(t.datum)) continue;
      const ganztag = t.ganztag === true;
      if (!ganztag && !(Number.isFinite(t.beginn) && Number.isFinite(t.ende))) continue;
      const betreff = String(t.betreff ?? '').trim();
      const schluessel = `reise:${t.datum}:${betreff}`;
      if (istVerworfen(schluessel)) continue;
      liste.push({
        datum: t.datum,
        beginn: ganztag ? 0 : t.beginn,
        ende: ganztag ? 1440 : t.ende,
        betreff,
        ort,
        ganztag,
        quelle: 'reise',
        schluessel,
      });
    }
    return liste;
  } catch {
    return [];
  }
}

// Übernimmt einen PC-Vorschlag: je An-Phase ein Block. Der letzte Block ist „Gehen“, der erste trägt eine Notiz.
export async function pcUebernehmen(vorschlag) {
  const { datum } = vorschlag;
  const gueltig = (vorschlag.bloecke ?? []).filter((b) => b.ende > b.beginn);
  if (gueltig.length === 0) throw new Error('Der Vorschlag hat keine Zeiten.');
  if (bloeckeAm(await alle('bloecke'), datum).length > 0) {
    throw new Error('An diesem Tag gibt es schon Blöcke.');
  }
  for (let i = 0; i < gueltig.length; i++) {
    const b = gueltig[i];
    await speichern('bloecke', {
      datum,
      beginn: b.beginn,
      ende: b.ende,
      gehen: i === gueltig.length - 1,
      notiz: i === 0 ? 'aus PC-Zeiten übernommen' : '',
    });
  }
  return gueltig.length;
}
