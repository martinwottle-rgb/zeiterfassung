// Abgleich mit einem privaten GitHub-Repo. Die Sicherung liegt dort verschlüsselt als Datei.
// Ablauf: holen, entschlüsseln, zusammenführen, nur bei Unterschied verschlüsselt hochladen.
// Token und Passwort bleiben auf dem Gerät (localStorage) und gehen nie in Logs oder den Export.

import { exportieren, importieren } from './speicher.js';
import { verschluesseln, entschluesseln, b64Utf8AusText, textAusB64Utf8 } from './krypto.js';

const EINRICHTUNG_SCHLUESSEL = 'zeit.abgleich';
const LISTEN = ['bloecke', 'abwesenheiten', 'reisen'];

// Einrichtung laden. Bei Fehler oder fehlender Einrichtung: null.
export function einrichtungLaden() {
  try {
    const roh = localStorage.getItem(EINRICHTUNG_SCHLUESSEL);
    if (!roh) return null;
    const e = JSON.parse(roh);
    return e && typeof e === 'object' ? e : null;
  } catch {
    return null;
  }
}

// Nur die vier Felder speichern, sonst nichts.
export function einrichtungSpeichern(e) {
  const { repo, token, passwort, pfad } = e;
  localStorage.setItem(EINRICHTUNG_SCHLUESSEL, JSON.stringify({ repo, token, passwort, pfad }));
}

export function einrichtungLoeschen() {
  localStorage.removeItem(EINRICHTUNG_SCHLUESSEL);
}

// Vergleichsform eines Exports: Listen nach id sortiert, Schlüssel rekursiv sortiert, als JSON.
// So sehen gleiche Inhalte auch gleich aus, egal in welcher Reihenfolge sie gespeichert wurden.
function sortiereSchluessel(wert) {
  if (Array.isArray(wert)) return wert.map(sortiereSchluessel);
  if (wert && typeof wert === 'object') {
    const aus = {};
    for (const k of Object.keys(wert).sort()) aus[k] = sortiereSchluessel(wert[k]);
    return aus;
  }
  return wert;
}

export function normalisiert(daten) {
  const kopie = { ...daten };
  for (const name of LISTEN) {
    if (Array.isArray(kopie[name])) {
      kopie[name] = [...kopie[name]].sort((a, b) => {
        const x = String(a?.id), y = String(b?.id);
        return x < y ? -1 : x > y ? 1 : 0;
      });
    }
  }
  return JSON.stringify(sortiereSchluessel(kopie));
}

// Adresse der Datei im Repo, z. B. https://api.github.com/repos/besitzer/name/contents/daten.json.enc
function adresse(e) {
  const repo = repoName(e.repo).split('/').map(encodeURIComponent).join('/');
  const pfad = String(e.pfad).split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${repo}/contents/${pfad}`;
}

// Nimmt auch die ganze Adresse oder Leerzeichen: „https://github.com/name/repo.git “ → „name/repo“.
export function repoName(text) {
  return String(text || '').trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
}

function kopf(token, mitInhalt) {
  const k = { 'Authorization': 'Bearer ' + String(token).trim(), 'Accept': 'application/vnd.github+json' };
  if (mitInhalt) k['Content-Type'] = 'application/json';
  return k;
}

// Fehlerhafte Antwort in die passenden Fehlertexte umwandeln.
function pruefeStatus(antwort) {
  if (antwort.ok) return;
  if (antwort.status === 401) {
    throw new Error('Der Token wird nicht angenommen.');
  }
  if (antwort.status === 403) {
    throw new Error('Der Token darf nicht schreiben: bei „Contents“ muss „Read and write“ stehen.');
  }
  if (antwort.status === 404) {
    throw new Error('Repository nicht gefunden oder der Token hat keinen Zugriff darauf.');
  }
  throw new Error(`GitHub meldet einen Fehler (${antwort.status}).`);
}

// Netzfehler wie HTTP-Fehler behandeln.
async function anfrage(fetchFn, url, opt) {
  try {
    return await fetchFn(url, opt);
  } catch {
    throw new Error('GitHub ist nicht erreichbar (keine Verbindung).');
  }
}

// Ferndatei holen. 404 heißt: noch nichts auf GitHub, dann null.
async function holen(e, fetchFn) {
  const antwort = await anfrage(fetchFn, adresse(e), {
    method: 'GET', headers: kopf(e.token, false), cache: 'no-store',
  });
  if (antwort.status === 404) return null;
  pruefeStatus(antwort);
  const json = await antwort.json();
  return { content: json.content, sha: json.sha };
}

// Ein Durchlauf. Bei Konflikt (409/422) wird der Aufrufer es noch einmal versuchen.
async function abgleichenEinmal(e, fetchFn, versuch) {
  const fern = await holen(e, fetchFn);
  let fernDaten = null;
  let geholt = false;
  if (fern) {
    fernDaten = await entschluesseln(textAusB64Utf8(fern.content), e.passwort);
    await importieren(fernDaten);
    geholt = true;
  }
  const lokal = await exportieren();
  // Gleicher Inhalt auf beiden Seiten: nichts hochladen
  if (fernDaten && normalisiert(lokal) === normalisiert(fernDaten)) {
    return { hochgeladen: false, geholt, wiederholen: false };
  }
  const koerper = {
    message: 'Abgleich',
    content: b64Utf8AusText(await verschluesseln(lokal, e.passwort)),
  };
  if (fern) koerper.sha = fern.sha; // ohne sha legt GitHub die Datei neu an
  const antwort = await anfrage(fetchFn, adresse(e), {
    method: 'PUT', headers: kopf(e.token, true), cache: 'no-store', body: JSON.stringify(koerper),
  });
  if ((antwort.status === 409 || antwort.status === 422) && versuch === 0) {
    return { wiederholen: true };
  }
  pruefeStatus(antwort);
  return { hochgeladen: true, geholt, wiederholen: false };
}

async function abgleichenWirklich(e, fetchFn) {
  if (!e?.repo || !e?.token || !e?.passwort || !e?.pfad) {
    throw new Error('Der Abgleich ist noch nicht eingerichtet.');
  }
  let ergebnis = await abgleichenEinmal(e, fetchFn, 0);
  if (ergebnis.wiederholen) ergebnis = await abgleichenEinmal(e, fetchFn, 1);
  return { hochgeladen: ergebnis.hochgeladen, geholt: ergebnis.geholt };
}

// Eine Promise-Kette: Läuft schon ein Abgleich, wartet der nächste auf dessen Ende.
let kette = Promise.resolve();

// Gleicht mit GitHub ab. Gibt {hochgeladen, geholt} zurück.
export function abgleichen(einrichtung, fetchFn = fetch) {
  const ergebnis = kette.then(() => abgleichenWirklich(einrichtung, fetchFn));
  kette = ergebnis.catch(() => {}); // Fehler nicht in die Kette weitergeben
  return ergebnis;
}
