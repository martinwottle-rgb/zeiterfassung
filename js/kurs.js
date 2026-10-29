// Tageskurs für Fremdwährungen: EZB-Referenzkurs (Fremdwährung pro 1 EUR) über api.frankfurter.dev (alte Adresse .app liefert kein CORS mehr).
// Gesendet werden nur Währung und Datum. Fehler, fehlende Kurse und Netzprobleme liefern null, nie einen Wurf.
// Erfolgreiche Abfragen werden im Modul je Währung und Datum gemerkt.

const BASIS = 'https://api.frankfurter.dev/v1';
const ZEIT_LIMIT_MS = 8000;
const DATUM_FORM = /^\d{4}-\d{2}-\d{2}$/;
const merker = new Map();

// Kurs holen: { kurs, datum } mit dem Datum des gelieferten Kurses, sonst null.
// datum leer: aktuellster Kurs.
export async function kursHolen(waehrung, datum) {
  const code = String(waehrung ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || code === 'EUR') return null;
  const tag = datum ? String(datum).trim() : '';
  if (tag && !DATUM_FORM.test(tag)) return null;

  const schluessel = `${code}|${tag}`;
  if (merker.has(schluessel)) return { ...merker.get(schluessel) };

  const steuer = typeof AbortController === 'function' ? new AbortController() : null;
  const frist = steuer ? setTimeout(() => steuer.abort(), ZEIT_LIMIT_MS) : null;
  try {
    const url = `${BASIS}/${tag || 'latest'}?base=EUR&symbols=${encodeURIComponent(code)}`;
    const antwort = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: steuer?.signal,
    });
    if (!antwort.ok) return null;
    const daten = await antwort.json();
    const kurs = Number(daten?.rates?.[code]);
    const kursDatum = typeof daten?.date === 'string' && DATUM_FORM.test(daten.date) ? daten.date : '';
    if (!Number.isFinite(kurs) || kurs <= 0 || !kursDatum) return null;
    const ergebnis = { kurs, datum: kursDatum };
    merker.set(schluessel, ergebnis);
    return { ...ergebnis };
  } catch (e) {
    console.warn('Kurs nicht abrufbar', e?.message);
    return null;
  } finally {
    if (frist) clearTimeout(frist);
  }
}
