// Reisekostentabelle (Excel) über den lokalen Laptop-Server erstellen. Gemeinsam genutzt von
// ansicht_monat.js und ansicht_reisen.js. Nur am Laptop, denn dort läuft /api/reisekosten.
//
// Excel braucht einige Sekunden. In dieser Zeit kann die Ansicht neu gezeichnet werden (Fenster verliert
// den Fokus, Abgleich, Minutentakt). Deshalb liegt der Stand je Monat hier im Modul und nicht im DOM:
// jede neu gezeichnete Ansicht holt ihn sich beim Verdrahten wieder ab.
import { verpflegung } from './reisen.js';

const stand = new Map();          // monat → { laeuft, text, fehler, ordner }
const anzeigen = new Map();       // monat → Set der aktuell verdrahteten Bereiche

function zeichnen(monat) {
  const s = stand.get(monat) ?? { laeuft: false, text: '', fehler: false, ordner: false };
  for (const box of [...(anzeigen.get(monat) ?? [])]) {
    if (!box.isConnected) { anzeigen.get(monat).delete(box); continue; }
    const knopf = box.querySelector('[data-excel]');
    const status = box.querySelector('[data-status]');
    const ordnerKnopf = box.querySelector('[data-ordner]');
    if (knopf) {
      knopf.disabled = s.laeuft;
      knopf.textContent = s.laeuft ? 'Excel arbeitet …' : 'Reisekostentabelle erstellen';
    }
    if (status) {
      status.textContent = '';
      status.classList.toggle('fehler', s.fehler);
      const zeilen = s.text ? s.text.split('\n') : [];
      zeilen.forEach((zeile, i) => {
        if (i > 0) {
          status.append(document.createElement('br'));
          const hinweis = document.createElement('span');
          hinweis.className = 'reise-hinweis';
          hinweis.textContent = zeile;
          status.append(hinweis);
        } else status.append(zeile);
      });
    }
    if (ordnerKnopf) ordnerKnopf.hidden = !s.ordner;
  }
}

function setzen(monat, neu) {
  stand.set(monat, { laeuft: false, text: '', fehler: false, ordner: false, ...neu });
  zeichnen(monat);
}

// Erstellt die Tabelle für einen Monat (monat: 'JJJJ-MM') aus den Reisetagen einer reisekostenMonat-Auswertung.
export async function reisekostentabelleErstellen(reise, monat) {
  if (stand.get(monat)?.laeuft) return;
  const tage = reise.tage.map(({ id, geaendert, geloescht, reiseId, ...rest }) => rest);
  setzen(monat, { laeuft: true });
  try {
    const antwort = await fetch('/api/reisekosten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monat, tage }),
      cache: 'no-store',
    });
    const daten = await antwort.json().catch(() => null);
    if (!antwort.ok || !daten?.datei) {
      setzen(monat, { text: daten?.fehler ?? 'Die Reisekostentabelle konnte nicht erstellt werden.', fehler: true });
      return;
    }
    const name = String(daten.datei).split(/[\\/]/).pop();
    // Excel-Werte (Spalte J) gegen die eigene Rechnung prüfen
    const excel = Array.isArray(daten.verpflegung) ? daten.verpflegung.map(Number) : [];
    const eigen = reise.tage.map((t) => verpflegung(t) ?? 0);
    const abweichung = excel.length !== eigen.length || excel.some((w, i) => Math.abs(w - eigen[i]) > 0.01);
    const text = `Gespeichert: ${name}` + (abweichung ? '\nExcel rechnet anders als die App: bitte prüfen.' : '');
    setzen(monat, { text, ordner: true });
  } catch (e) {
    console.error(e);
    setzen(monat, { text: 'Die Reisekostentabelle konnte nicht erstellt werden. Läuft der Laptop-Server?', fehler: true });
  }
}

// Knopf „Ordner öffnen“: der lokale Server öffnet den Ordner mit der Tabelle.
export function ordnerOeffnenVerdrahten(ordnerKnopf, status) {
  ordnerKnopf.addEventListener('click', async () => {
    try {
      const antwort = await fetch('/api/ordner-oeffnen', { method: 'POST', cache: 'no-store' });
      if (!antwort.ok) throw new Error(`Status ${antwort.status}`);
    } catch (e) {
      console.error(e);
      status.textContent = 'Der Ordner konnte nicht geöffnet werden.';
      status.classList.add('fehler');
    }
  });
}

// Excel-Knopf und Ordner-Knopf eines Bereichs (Elemente mit data-excel, data-ordner, data-status) verdrahten
// und den gemerkten Stand des Monats anzeigen. Ohne data-excel (kein Laptop) passiert nichts.
export function reisekostenKnopfVerdrahten(box, reise, monat) {
  const status = box.querySelector('[data-status]');
  const ordnerKnopf = box.querySelector('[data-ordner]');
  ordnerOeffnenVerdrahten(ordnerKnopf, status);
  const excelKnopf = box.querySelector('[data-excel]');
  if (!excelKnopf) return;
  if (!anzeigen.has(monat)) anzeigen.set(monat, new Set());
  anzeigen.get(monat).add(box);
  excelKnopf.addEventListener('click', () => reisekostentabelleErstellen(reise, monat));
  if (stand.has(monat)) zeichnen(monat);
}
