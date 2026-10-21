// Reisekostentabelle (Excel) über den lokalen Laptop-Server erstellen. Gemeinsam genutzt von
// ansicht_monat.js und ansicht_reisen.js. Nur am Laptop, denn dort läuft /api/reisekosten.
import { verpflegung } from './reisen.js';

// Erstellt die Tabelle für einen Monat (monat: 'JJJJ-MM') aus den Reisetagen einer reisekostenMonat-Auswertung.
// knopf, status und ordnerKnopf gehören zur aufrufenden Ansicht.
export async function reisekostentabelleErstellen(reise, monat, knopf, status, ordnerKnopf) {
  const tage = reise.tage.map(({ id, geaendert, geloescht, ...rest }) => rest);
  knopf.disabled = true;
  knopf.textContent = 'Excel arbeitet …';
  status.textContent = '';
  status.classList.remove('fehler');
  ordnerKnopf.hidden = true;
  try {
    const antwort = await fetch('/api/reisekosten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monat, tage }),
      cache: 'no-store',
    });
    const daten = await antwort.json().catch(() => null);
    if (!antwort.ok || !daten?.datei) {
      status.textContent = daten?.fehler ?? 'Die Reisekostentabelle konnte nicht erstellt werden.';
      status.classList.add('fehler');
      return;
    }
    const name = String(daten.datei).split(/[\\/]/).pop();
    status.textContent = `Gespeichert: ${name}`;
    // Excel-Werte (Spalte J) gegen die eigene Rechnung prüfen
    const excel = Array.isArray(daten.verpflegung) ? daten.verpflegung.map(Number) : [];
    const eigen = reise.tage.map((t) => verpflegung(t) ?? 0);
    const abweichung = excel.length !== eigen.length || excel.some((w, i) => Math.abs(w - eigen[i]) > 0.01);
    if (abweichung) {
      const hinweis = document.createElement('span');
      hinweis.className = 'reise-hinweis';
      hinweis.textContent = 'Excel rechnet anders als die App: bitte prüfen.';
      status.append(document.createElement('br'), hinweis);
    }
    ordnerKnopf.hidden = false;
  } catch (e) {
    console.error(e);
    status.textContent = 'Die Reisekostentabelle konnte nicht erstellt werden. Läuft der Laptop-Server?';
    status.classList.add('fehler');
  } finally {
    knopf.disabled = false;
    knopf.textContent = 'Reisekostentabelle erstellen';
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

// Excel-Knopf und Ordner-Knopf eines Bereichs (Elemente mit data-excel, data-ordner, data-status) verdrahten.
// Ohne data-excel (kein Laptop) passiert nichts.
export function reisekostenKnopfVerdrahten(box, reise, monat) {
  const status = box.querySelector('[data-status]');
  const ordnerKnopf = box.querySelector('[data-ordner]');
  ordnerOeffnenVerdrahten(ordnerKnopf, status);
  const excelKnopf = box.querySelector('[data-excel]');
  if (excelKnopf) {
    excelKnopf.addEventListener('click', () => {
      reisekostentabelleErstellen(reise, monat, excelKnopf, status, ordnerKnopf);
    });
  }
}
