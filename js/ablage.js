// Ablage: Fotos und Dokumente zwischen Handy und Laptop. Ein Eintrag fasst mehrere Dateien zusammen
// (z. B. alle Fotos eines Versuchs). Die Dateien liegen im Speicher 'bilder' und gehen wie Belegfotos
// verschlüsselt über GitHub. Am Laptop landen Einträge vom Handy zusätzlich im Eingangsordner des Laptops (laptop/server.py, /api/eingang-datei).
//
// Eintrag: { id, erstellt (ms), quelle: 'handy' | 'laptop', firma, art, notiz, reiseId,
//            dateien: [{ bildId, name, typ, groesse }], eingang: { ordner, zeit } | null, geloescht, geaendert }
import { alle, bildLaden, bildSpeichern, speichern } from './speicher.js';
import { bildHolen, einrichtungLaden } from './abgleich.js';

export const ARTEN = ['Versuch', 'Besuch', 'Typenschild / Maschine', 'Dokument / Angebot', 'Sonstiges'];
export const MAX_BYTES = 15 * 1024 * 1024; // je Datei; größere Dateien machen den Abgleich über GitHub zu langsam

const text = (s) => String(s ?? '').trim();
const zwei = (n) => String(n).padStart(2, '0');

// Datum und Uhrzeit eines Zeitpunkts: { datum: 'JJJJ-MM-TT', uhr: 'HHMM' }
function zeitTeile(ms) {
  const d = new Date(ms);
  return { datum: `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`, uhr: `${zwei(d.getHours())}${zwei(d.getMinutes())}` };
}

// Ordnername im Eingang, z. B. „2026-11-02 1430 Bösel (DE) Versuch“. Ohne Firma: „2026-11-02 1430 Versuch“.
export function ordnerName(eintrag) {
  const { datum, uhr } = zeitTeile(eintrag.erstellt ?? Date.now());
  const art = text(eintrag.art).replace(/\s*\/\s*/g, ' ') || 'Ablage';
  return [datum, uhr, text(eintrag.firma), art].filter(Boolean).join(' ').replace(/[<>:"/\\|?*]/g, '-');
}

// Info.md für den Eingangsordner: alles, was ich zum Einsortieren brauche
export function infoText(eintrag, reiseText = '') {
  const { datum } = zeitTeile(eintrag.erstellt ?? Date.now());
  const zeilen = [
    `# Ablage vom ${datum.split('-').reverse().join('.')}`,
    '',
    `- Firma: ${text(eintrag.firma) || 'nicht angegeben'}`,
    `- Art: ${text(eintrag.art) || 'nicht angegeben'}`,
  ];
  if (reiseText) zeilen.push(`- Dienstreise: ${reiseText}`);
  zeilen.push(`- Quelle: ${eintrag.quelle === 'laptop' ? 'Laptop' : 'iPhone'}`);
  zeilen.push(`- Dateien: ${(eintrag.dateien ?? []).map((d) => d.name).join(', ')}`);
  if (text(eintrag.notiz)) zeilen.push('', '## Notiz', '', text(eintrag.notiz));
  return zeilen.join('\n') + '\n';
}

// Dateiname mit Endung; Fotos ohne Namen (Kamera) bekommen „Foto 1.jpg“ usw.
function dateiName(datei, nr, typ) {
  const n = text(datei?.name);
  if (n && n !== 'image.jpg' && n !== 'image.jpeg') return n;
  const endung = typ === 'image/png' ? 'png' : typ === 'application/pdf' ? 'pdf' : 'jpg';
  return `Foto ${nr}.${endung}`;
}

// Neuen Eintrag anlegen. dateien: File/Blob-Liste. original: Fotos nicht verkleinern.
// Wirft bei leerer Liste oder einer zu großen Datei (Meldung für den Nutzer).
export async function ablageAnlegen({ dateien, firma = '', art = '', notiz = '', reiseId = null, original = false, quelle = 'handy' }) {
  const liste = [...(dateien ?? [])];
  if (!liste.length) throw new Error('Bitte mindestens eine Datei wählen.');
  const zuGross = liste.find((d) => !d.type?.startsWith('image/') && d.size > MAX_BYTES);
  if (zuGross) throw new Error(`„${zuGross.name}“ ist größer als ${MAX_BYTES / 1024 / 1024} MB.`);
  const eintragDateien = [];
  let nr = 0;
  for (const d of liste) {
    nr += 1;
    const bildId = await bildSpeichern(d, { original: original || !d.type?.startsWith('image/') });
    const gespeichert = await bildLaden(bildId);
    if (gespeichert && gespeichert.size > MAX_BYTES) throw new Error(`„${d.name || 'Foto'}“ ist auch verkleinert noch zu groß.`);
    const typ = gespeichert?.type || d.type || 'application/octet-stream';
    eintragDateien.push({ bildId, name: dateiName(d, nr, typ), typ, groesse: gespeichert?.size ?? d.size });
  }
  return speichern('ablage', {
    erstellt: Date.now(), quelle, firma: text(firma), art: text(art), notiz: text(notiz), reiseId, dateien: eintragDateien, eingang: null,
  });
}

// Datei eines Eintrags als Blob: lokal, sonst einmal von GitHub holen. null, wenn sie (noch) nicht da ist.
export async function dateiLaden(datei) {
  const lokal = await bildLaden(datei.bildId);
  if (lokal) return lokal;
  const e = einrichtungLaden();
  if (!(e && e.repo && e.token && e.passwort && e.pfad)) return null;
  return bildHolen(datei.bildId, e);
}

// Datei herunterladen (Browser-Download mit Originalnamen)
export async function dateiHerunterladen(datei) {
  const blob = await dateiLaden(datei);
  if (!blob) throw new Error('Die Datei ist noch nicht da. Bitte gleich noch einmal versuchen.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = datei.name || 'Datei';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Nur am Laptop: Einträge vom Handy, die noch nicht im Eingang liegen, dorthin speichern und markieren.
// Fehlt eine Datei noch (Abgleich läuft), bleibt der Eintrag für den nächsten Durchlauf offen.
let laeuft = false;
export async function eingangUebernehmen(reiseTextFuer = () => '') {
  if (laeuft) return 0;
  laeuft = true;
  let anzahl = 0;
  try {
    const offen = (await alle('ablage')).filter((a) => !a.geloescht && a.quelle !== 'laptop' && !a.eingang);
    for (const eintrag of offen) {
      const blobs = [];
      for (const d of eintrag.dateien ?? []) blobs.push(await dateiLaden(d).catch(() => null));
      if (blobs.some((b) => !b)) continue;
      const ordner = ordnerName(eintrag);
      let gespeichert = '';
      for (let i = 0; i < blobs.length; i += 1) {
        const d = eintrag.dateien[i];
        const antwort = await fetch(`/api/eingang-datei?ordner=${encodeURIComponent(ordner)}&name=${encodeURIComponent(d.name)}`, {
          method: 'POST', body: blobs[i],
        });
        const json = await antwort.json();
        if (!json?.ok) throw new Error(json?.fehler || 'Eingang nicht erreichbar');
        gespeichert = json.ordner;
      }
      await fetch('/api/eingang-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordner, text: infoText(eintrag, reiseTextFuer(eintrag)) }),
      });
      await speichern('ablage', { ...eintrag, eingang: { ordner: gespeichert, zeit: Date.now() } });
      anzahl += 1;
    }
  } catch (e) {
    console.warn('Ablage nicht in den Eingang übernommen', e?.message);
  } finally {
    laeuft = false;
  }
  return anzahl;
}
