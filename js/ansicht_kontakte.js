// Ansicht Kontakte: Kopf mit „Kontakt erfassen“, Suche (Name, Firma, Ort, Groß und Klein egal), Liste neueste oben.
// Jede Zeile zeigt Name, Firma und Ort sowie den Outlook-Zustand als Punkt mit Text für Screenreader.
// Antippen öffnet das Detail. Die Liste kommt direkt aus dem Speicher (kontext.daten kennt keine Kontakte).
import { alle } from './speicher.js';
import { kontaktName } from './kontakte.js';
import { kontaktErfassen, kontaktOeffnen, outlookZustand } from './kontakt_sheet.js';

// Anzahl mit Einzahl und Mehrzahl
function anzahlText(n) {
  if (n === 0) return 'Noch keine Kontakte';
  return `${n} ${n === 1 ? 'Kontakt' : 'Kontakte'}`;
}

// Suchtext je Kontakt, klein geschrieben
function suchText(k) {
  return [kontaktName(k), k.firma, k.ort].filter(Boolean).join(' ').toLocaleLowerCase('de-DE');
}

// Eine Zeile als Schaltfläche: Name, darunter Firma und Ort, rechts der Outlook-Punkt
function zeileBauen(k, kontext) {
  const zeile = document.createElement('button');
  zeile.type = 'button';
  zeile.className = 'liste-zeile kontakt-zeile';

  const text = document.createElement('span');
  text.className = 'liste-text';
  const titel = document.createElement('span');
  titel.className = 'liste-titel';
  titel.textContent = kontaktName(k);
  text.append(titel);
  const unter = [k.firma, k.ort].filter(Boolean).join(' · ');
  if (unter) {
    const zeileUnter = document.createElement('span');
    zeileUnter.className = 'liste-unter';
    zeileUnter.textContent = unter;
    text.append(zeileUnter);
  }

  const o = outlookZustand(k);
  const outlook = document.createElement('span');
  outlook.className = 'kontakt-outlook';
  if (o.art === 'fehler' && o.meldung) outlook.title = o.meldung;
  const punkt = document.createElement('span');
  punkt.className = `kontakt-punkt ${o.art}`;
  punkt.setAttribute('aria-hidden', 'true');
  const sr = document.createElement('span');
  sr.className = 'nur-sr';
  sr.textContent = o.text;
  outlook.append(punkt, sr);

  zeile.append(text, outlook);
  zeile.addEventListener('click', () => kontaktOeffnen(k, kontext));
  return zeile;
}

export async function zeigen(ziel, kontext) {
  const kontakte = (await alle('kontakte'))
    .filter((k) => !k.geloescht)
    .sort((a, b) => (b.erstellt ?? 0) - (a.erstellt ?? 0));

  ziel.innerHTML = `
    <header class="kopf glas">
      <div>
        <h1>Kontakte</h1>
        <p class="notiz zahl" data-anzahl></p>
      </div>
      <nav class="aktionen" aria-label="Kontakte">
        <button type="button" class="knopf haupt" data-erfassen>Kontakt erfassen</button>
      </nav>
    </header>
    <div class="kontakt-suche">
      <label class="nur-sr" for="kontakt-suche-feld">Kontakte suchen</label>
      <input type="search" id="kontakt-suche-feld" name="suche" placeholder="Name, Firma oder Ort" autocomplete="off" enterkeyhint="search">
    </div>
    <div class="liste" data-liste></div>
  `;

  ziel.querySelector('[data-anzahl]').textContent = anzahlText(kontakte.length);
  ziel.querySelector('[data-erfassen]').addEventListener('click', () => kontaktErfassen(kontext));

  const liste = ziel.querySelector('[data-liste]');
  const suche = ziel.querySelector('#kontakt-suche-feld');

  function listeZeichnen() {
    const q = suche.value.trim().toLocaleLowerCase('de-DE');
    const treffer = q ? kontakte.filter((k) => suchText(k).includes(q)) : kontakte;
    liste.replaceChildren();
    if (kontakte.length === 0) {
      const leer = document.createElement('p');
      leer.className = 'leer';
      leer.textContent = 'Noch keine Kontakte. Fotografiere eine Visitenkarte, um zu beginnen.';
      liste.append(leer);
      return;
    }
    if (treffer.length === 0) {
      const leer = document.createElement('p');
      leer.className = 'leer';
      leer.textContent = 'Kein Kontakt passt zur Suche.';
      liste.append(leer);
      return;
    }
    for (const k of treffer) liste.append(zeileBauen(k, kontext));
  }

  suche.addEventListener('input', listeZeichnen);
  listeZeichnen();
}
