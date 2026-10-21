// Verschlüsselung für den Abgleich. Rein über WebCrypto, keine Bibliotheken.
// Format: {"v":1,"salt":"<b64>","iv":"<b64>","daten":"<b64>"}
// PBKDF2 (SHA-256, 310000 Durchläufe) leitet aus dem Passwort einen AES-GCM-256-Schlüssel ab.

const ITERATIONEN = 310000;
const STUECK = 0x8000; // Bytes pro Teil beim Umwandeln, damit keine riesigen Argumentlisten entstehen
const kodierer = new TextEncoder();
const dekodierer = new TextDecoder();

// Bytes zu Base64. Große Arrays werden in Stücken umgewandelt.
export function b64AusBytes(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += STUECK) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + STUECK));
  }
  return btoa(text);
}

// Base64 zu Bytes. Zeilenumbrüche und Leerraum werden ignoriert (GitHub liefert sie).
export function bytesAusB64(b64) {
  const roh = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return bytes;
}

// Text (UTF-8) zu Base64.
export function b64Utf8AusText(text) {
  return b64AusBytes(kodierer.encode(text));
}

// Base64 (UTF-8) zurück zu Text.
export function textAusB64Utf8(b64) {
  return dekodierer.decode(bytesAusB64(b64));
}

// Schlüssel aus Passwort und Salz.
async function schluesselAus(passwort, salz) {
  const grund = await crypto.subtle.importKey(
    'raw', kodierer.encode(String(passwort)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salz, iterations: ITERATIONEN, hash: 'SHA-256' },
    grund, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Verschlüsselt ein Objekt. Gibt den Text im Format oben zurück.
export async function verschluesseln(obj, passwort) {
  const salz = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const schluessel = await schluesselAus(passwort, salz);
  const geheim = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, schluessel, kodierer.encode(JSON.stringify(obj)));
  return JSON.stringify({
    v: 1,
    salt: b64AusBytes(salz),
    iv: b64AusBytes(iv),
    daten: b64AusBytes(new Uint8Array(geheim)),
  });
}

// Entschlüsselt den Text aus verschluesseln. Falsches Passwort oder kaputte Daten: Fehler.
export async function entschluesseln(text, passwort) {
  try {
    const k = JSON.parse(text);
    if (k?.v !== 1) throw new Error('Unbekanntes Format');
    const salz = bytesAusB64(k.salt);
    const iv = bytesAusB64(k.iv);
    const daten = bytesAusB64(k.daten);
    const schluessel = await schluesselAus(passwort, salz);
    // AES-GCM prüft die Authentifizierung: Falsches Passwort wirft hier
    const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, schluessel, daten);
    return JSON.parse(dekodierer.decode(klar));
  } catch {
    throw new Error('Das Passwort passt nicht zu den Daten.');
  }
}
