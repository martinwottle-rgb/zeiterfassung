// Ablegen (Sheet): Fotos und Dateien wählen, Angaben dazu, dann als Ablage-Eintrag speichern.
// Am Laptop heißt das Sheet „Datei aufs Handy“ und hat keine Kamera-Taste. dateienZiehen macht ein Element zur Ablagefläche.
import { alle } from './speicher.js';
import { ARTEN, ablageAnlegen } from './ablage.js';

const DATEI_AUSWAHL = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.msg,.eml';

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Größe für die Anzeige: KB bis 1 MB, danach MB mit Komma (z. B. „1,5 MB“)
export function groesseText(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// Firmen aller nicht gelöschten Kontakte: eindeutig, deutsch sortiert
async function firmenLaden() {
  try {
    const kontakte = await alle('kontakte');
    const namen = new Set(kontakte.filter((k) => k && !k.geloescht).map((k) => String(k.firma ?? '').trim()).filter(Boolean));
    return [...namen].sort((a, b) => a.localeCompare(b, 'de'));
  } catch (e) {
    console.warn('Kontakte nicht geladen', e?.message);
    return [];
  }
}

// Dienstreise am heutigen Tag (nicht gelöscht), sonst null
async function reiseHeute(heute) {
  try {
    const reisen = await alle('reisen');
    return reisen.find((r) => r && !r.geloescht && r.datum === heute) ?? null;
  } catch (e) {
    console.warn('Reisen nicht geladen', e?.message);
    return null;
  }
}

// Beobachtet das Sheet: wenn das Formular daraus verschwindet, ist es geschlossen. Dann läuft aufZu einmal.
function beimSchliessen(form, aufZu) {
  const huelle = document.getElementById('sheet');
  if (!huelle) return;
  const beobachter = new MutationObserver(() => {
    if (form.isConnected) return;
    beobachter.disconnect();
    aufZu();
  });
  beobachter.observe(huelle, { childList: true });
}

// Sheet „Ablegen“. startDateien: Dateien aus einem Drag & Drop, sie stehen gleich in der Liste.
export async function ablegenOeffnen(kontext, startDateien = []) {
  const laptop = Boolean(kontext.laptop);
  // Gezogene Dateien vor dem ersten await übernehmen (die Auswahl am Ziel ist danach leer)
  const start = [...startDateien];
  const [firmen, reise] = await Promise.all([firmenLaden(), reiseHeute(kontext.heute)]);

  // dateien: { datei, url } je gewählter Datei; url nur bei Fotos (Vorschau)
  const dateien = [];
  let art = '';
  let beschaeftigt = false;

  const form = el('form', 'formular-stapel ablage-form');
  form.noValidate = true;

  const fehler = el('p', 'notiz fehler');
  fehler.setAttribute('role', 'alert');
  fehler.hidden = true;

  // Dateiauswahl als Knopf: das Eingabefeld steckt im Label (wie bei Belegen)
  function dateiKnopf(text, accept, kamera) {
    const label = el('label', 'knopf knopf-karte ablage-knopf');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.className = 'nur-sr';
    if (kamera) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => {
      const neu = [...(input.files ?? [])];
      input.value = '';
      if (neu.length) hinzufuegen(neu);
    });
    label.append(input, document.createTextNode(text));
    return label;
  }

  const auswahl = el('div', 'aktionen');
  if (!laptop) auswahl.append(dateiKnopf('Foto aufnehmen', 'image/*', true));
  auswahl.append(dateiKnopf('Datei wählen', DATEI_AUSWAHL, false));

  // Gewählte Dateien: Liste mit Vorschau bei Fotos und Entfernen je Datei
  const listeEl = el('div', 'ablage-auswahl-huelle');

  function listeZeichnen() {
    if (!dateien.length) {
      listeEl.replaceChildren(el('p', 'notiz ablage-leer', 'Noch keine Datei gewählt.'));
      return;
    }
    const ul = el('ul', 'liste ablage-auswahl');
    for (const eintrag of dateien) {
      const li = el('li', 'ablage-auswahl-zeile');
      const name = eintrag.datei.name || 'Foto';
      if (eintrag.url) {
        const bild = el('img', 'ablage-vorschau');
        bild.alt = '';
        bild.src = eintrag.url;
        li.append(bild);
      }
      const text = el('span', 'ablage-auswahl-text');
      text.append(el('span', 'liste-titel', name), el('span', 'liste-unter', groesseText(eintrag.datei.size)));
      const weg = el('button', 'knopf knopf-karte', 'Entfernen');
      weg.type = 'button';
      weg.setAttribute('aria-label', `${name} entfernen`);
      weg.addEventListener('click', () => entfernen(eintrag));
      li.append(text, weg);
      ul.append(li);
    }
    listeEl.replaceChildren(ul);
  }

  function hinzufuegen(neu) {
    for (const datei of neu) {
      const url = datei.type?.startsWith('image/') ? URL.createObjectURL(datei) : null;
      dateien.push({ datei, url });
    }
    listeZeichnen();
    // Eine Auswahl zählt als ungesicherte Änderung (Rückfrage beim Schließen)
    form.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function entfernen(eintrag) {
    const i = dateien.indexOf(eintrag);
    if (i < 0) return;
    dateien.splice(i, 1);
    if (eintrag.url) URL.revokeObjectURL(eintrag.url);
    listeZeichnen();
    form.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Gehört zu: Eingabe mit Vorschlägen aus den Kontakten
  const firmaEl = el('input');
  firmaEl.type = 'text';
  firmaEl.id = 'ablage-firma';
  firmaEl.name = 'firma';
  firmaEl.autocomplete = 'off';
  firmaEl.setAttribute('list', 'ablage-firmen');
  const firmenListe = el('datalist');
  firmenListe.id = 'ablage-firmen';
  for (const name of firmen) {
    const o = el('option');
    o.value = name;
    firmenListe.append(o);
  }
  const firmaFeld = el('div', 'feld');
  firmaFeld.append(el('label', null, 'Gehört zu'), firmaEl, firmenListe);
  firmaFeld.querySelector('label').htmlFor = 'ablage-firma';

  // Art: eine Auswahl, erneuter Klick hebt sie auf
  const artKnoepfe = ARTEN.map((name) => {
    const knopf = el('button', 'segment-teil');
    knopf.type = 'button';
    knopf.dataset.art = name;
    knopf.append(el('span', null, name));
    knopf.addEventListener('click', () => {
      art = art === name ? '' : name;
      artZeichnen();
      form.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return knopf;
  });
  function artZeichnen() {
    for (const knopf of artKnoepfe) knopf.setAttribute('aria-pressed', String(knopf.dataset.art === art));
  }
  artZeichnen();
  const artSegment = el('div', 'segment ablage-art');
  artSegment.setAttribute('role', 'group');
  artSegment.setAttribute('aria-label', 'Art');
  artSegment.append(...artKnoepfe);
  const artFeld = el('div', 'feld');
  artFeld.append(el('p', 'feld-name', 'Art'), artSegment);

  // Notiz
  const notizEl = el('textarea');
  notizEl.id = 'ablage-notiz';
  notizEl.name = 'notiz';
  notizEl.rows = 3;
  const notizFeld = el('div', 'feld');
  notizFeld.append(el('label', null, 'Notiz'), notizEl);
  notizFeld.querySelector('label').htmlFor = 'ablage-notiz';

  // Original behalten: Fotos nicht verkleinern, Vorgabe aus
  const originalEl = el('input');
  originalEl.type = 'checkbox';
  originalEl.id = 'ablage-original';
  originalEl.name = 'original';
  originalEl.setAttribute('role', 'switch');
  const originalName = el('span', 'liste-titel', 'Original behalten');
  originalName.id = 'ablage-original-name';
  originalEl.setAttribute('aria-labelledby', originalName.id);
  const originalZeile = el('div', 'ablage-schalter');
  originalZeile.append(originalName, originalEl);

  // Dienstreise am heutigen Tag: Hinweis und die reiseId für den Eintrag
  const reiseZeile = el('p', 'notiz ablage-reise', reise ? `Gehört zur Dienstreise: ${String(reise.anlass ?? '').trim() || 'ohne Anlass'}` : '');
  reiseZeile.hidden = !reise;

  const ablegenKnopf = el('button', 'knopf haupt', 'Ablegen');
  ablegenKnopf.type = 'submit';

  async function absenden() {
    if (beschaeftigt) return;
    beschaeftigt = true;
    fehler.hidden = true;
    ablegenKnopf.disabled = true;
    ablegenKnopf.textContent = 'Wird abgelegt …';
    try {
      await ablageAnlegen({
        dateien: dateien.map((d) => d.datei),
        firma: firmaEl.value,
        art,
        notiz: notizEl.value,
        reiseId: reise?.reiseId ?? null,
        original: originalEl.checked,
        quelle: laptop ? 'laptop' : 'handy',
      });
      kontext.sheet.schliessen();
      kontext.abgleichJetzt();
    } catch (e) {
      fehler.textContent = e?.message || 'Ablegen hat nicht geklappt. Bitte noch einmal versuchen.';
      fehler.hidden = false;
      beschaeftigt = false;
      ablegenKnopf.disabled = false;
      ablegenKnopf.textContent = 'Ablegen';
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    absenden();
  });

  form.append(auswahl, listeEl, firmaFeld, artFeld, notizFeld, originalZeile, reiseZeile, fehler, ablegenKnopf);

  listeZeichnen();
  kontext.sheet.oeffnen(laptop ? 'Datei aufs Handy' : 'Ablegen', form);
  // Vorschaubilder freigeben, sobald das Formular aus dem Sheet verschwunden ist
  beimSchliessen(form, () => {
    for (const d of dateien) if (d.url) URL.revokeObjectURL(d.url);
  });
  // Gezogene Dateien erst nach dem Öffnen: so zählen sie als Änderung (Rückfrage beim Schließen)
  if (start.length) hinzufuegen(start);
  return form;
}

// Macht ein Element zur Ablagefläche: gezogene Dateien öffnen das Sheet mit ihnen in der Liste.
// Mehrfacher Aufruf für dasselbe Element legt keine zweiten Ereignisse an.
const angebunden = new WeakMap(); // Element -> kontext, der beim Ziehen gilt

export function dateienZiehen(element, kontext) {
  if (angebunden.has(element)) {
    angebunden.set(element, kontext);
    return;
  }
  angebunden.set(element, kontext);
  const hatDateien = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  let tiefe = 0; // dragenter und dragleave kommen auch für Kindelemente

  element.addEventListener('dragenter', (e) => {
    if (!hatDateien(e)) return;
    e.preventDefault();
    tiefe += 1;
    element.classList.add('ablage-ziehen-aktiv');
  });
  element.addEventListener('dragover', (e) => {
    if (!hatDateien(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  element.addEventListener('dragleave', (e) => {
    if (!hatDateien(e)) return;
    tiefe = Math.max(0, tiefe - 1);
    if (tiefe === 0) element.classList.remove('ablage-ziehen-aktiv');
  });
  element.addEventListener('drop', (e) => {
    if (!hatDateien(e)) return;
    e.preventDefault();
    tiefe = 0;
    element.classList.remove('ablage-ziehen-aktiv');
    const dateien = [...(e.dataTransfer.files ?? [])];
    if (dateien.length) ablegenOeffnen(angebunden.get(element), dateien);
  });
}
