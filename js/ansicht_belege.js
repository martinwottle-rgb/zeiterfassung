// Ansicht Belege: Kopf mit „Auswählen“ und „Beleg erfassen“, Filter (Offen, Abgegeben, Alle) und die Belege je Monat.
// Jede Monatsüberschrift klebt beim Scrollen und zeigt die Summen und einen PDF-Knopf. Antippen öffnet den Beleg.
// Auswahlmodus: Häkchen an den Belegen, darunter PDF und „Als abgegeben markieren“. Nach einer Ausgabe fragt ein
// Banner, ob die Belege als abgegeben markiert werden sollen. Miniaturen werden nach dem Zeichnen nachgeladen.
import { alle, bildLaden, speichern } from './speicher.js';
import { belegDateiname, betragText, nachMonat, reiseAm } from './belege.js';
import { belegBearbeiten, belegErfassen } from './beleg_sheet.js';
import { belegePdf, pdfErsteSeite } from './beleg_pdf.js';
import { bildHolen, einrichtungLaden } from './abgleich.js';
import { heute } from './zeit.js';

const FILTER_MERKEN = 'belege-filter';
const FILTER = [
  { wert: 'offen', text: 'Offen' },
  { wert: 'abgegeben', text: 'Abgegeben' },
  { wert: 'alle', text: 'Alle' },
];
const LEER_TEXT = {
  offen: 'Keine offenen Belege.',
  abgegeben: 'Keine abgegebenen Belege.',
};
const PLATZHALTER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>';

// Zähler für eindeutige Ids der Überschriften
let folge = 0;
// Zeichnungszähler und Object-URLs der Miniaturen: beim nächsten Zeichnen werden alte Ladevorgänge verworfen
let zug = 0;
let urls = [];

function urlsFreigeben() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];
}

// Gemerkten Filter lesen, sonst „Offen“
function filterLesen() {
  try {
    const wert = localStorage.getItem(FILTER_MERKEN);
    if (FILTER.some((f) => f.wert === wert)) return wert;
  } catch { /* Speicher nicht verfügbar: Vorgabe */ }
  return 'offen';
}

function filterMerken(wert) {
  try { localStorage.setItem(FILTER_MERKEN, wert); } catch { /* nicht merkbar: egal */ }
}

const txt = (s) => String(s ?? '').trim();

function el(tag, klasse, inhalt) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (inhalt !== undefined) e.textContent = inhalt;
  return e;
}

// Anzahl mit Einzahl und Mehrzahl
function anzahlText(n) {
  if (n === 0) return 'Keine Belege';
  return `${n} ${n === 1 ? 'Beleg' : 'Belege'}`;
}

// Datum 2026-10-14 wird 14.10.2026
function datumAnzeige(datum) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(datum));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

// Ist der Blob ein PDF (am Typ oder an der Kennung %PDF- am Anfang)?
async function istPdf(blob) {
  if (blob.type === 'application/pdf') return true;
  const kopf = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...kopf) === '%PDF-';
}

// Bild lokal aus dem Speicher, fehlt es, von GitHub
const ladeBild = async (id) => (await bildLaden(id)) ?? (await bildHolen(id, einrichtungLaden()));

// Miniatur des ersten Bildes: bei PDF die erste Seite als JPEG. Ohne Bild null.
async function miniBlob(beleg) {
  const id = Array.isArray(beleg.bilder) ? beleg.bilder[0] : null;
  if (!id) return null;
  const blob = await ladeBild(id);
  if (!blob) return null;
  return (await istPdf(blob)) ? pdfErsteSeite(blob) : blob;
}

// Miniaturen nacheinander nachladen, damit die Liste nicht warten muss. Veraltete Zeichnungen brechen ab.
async function minisNachladen(paare, zugNr) {
  for (const { beleg, mini } of paare) {
    if (zugNr !== zug) return;
    try {
      const blob = await miniBlob(beleg);
      if (zugNr !== zug) return;
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const bild = document.createElement('img');
      bild.alt = '';
      bild.src = url;
      mini.replaceChildren(bild);
    } catch (e) {
      console.warn('Miniatur nicht geladen:', e?.message);
    }
  }
}

// Eine Zeile: Miniatur, Titel mit Datum, Kategorie und Dienstreise, rechts Betrag und Status.
// Im Auswahlmodus mit Häkchen statt Antippen zum Öffnen.
function zeileBauen(ctx, b, paare) {
  const titel = txt(b.beschreibung) || txt(b.haendler) || txt(b.kategorie) || 'Beleg';
  const reise = reiseAm(b.datum, ctx.reisen);
  const reiseText = reise ? ['Dienstreise', txt(reise.anlass)].filter(Boolean).join(' ') : '';
  const unter = [datumAnzeige(b.datum), txt(b.kategorie), reiseText].filter(Boolean).join(' · ');

  const mini = el('span', 'belege-mini');
  mini.innerHTML = PLATZHALTER;
  if (Array.isArray(b.bilder) && b.bilder.length) paare.push({ beleg: b, mini });

  const textBlock = el('span', 'liste-text');
  textBlock.append(el('span', 'liste-titel', titel));
  if (unter) textBlock.append(el('span', 'liste-unter', unter));

  const rechts = el('span', 'belege-rechts');
  if (Number.isFinite(b.betrag)) rechts.append(el('span', 'zahl', betragText(b.betrag, b.waehrung)));
  else rechts.append(el('span', 'belege-fehlt', 'Betrag fehlt'));
  if (b.status === 'abgegeben') rechts.append(el('span', 'belege-abgegeben', 'abgegeben'));

  if (ctx.auswahlModus) {
    const zeile = el('label', 'liste-zeile belege-zeile');
    const haken = document.createElement('input');
    haken.type = 'checkbox';
    haken.className = 'belege-haken';
    haken.checked = ctx.gewaehlt.has(b.id);
    haken.addEventListener('change', () => {
      if (haken.checked) ctx.gewaehlt.add(b.id);
      else ctx.gewaehlt.delete(b.id);
      ctx.leisteZeichnen();
    });
    zeile.append(haken, mini, textBlock, rechts);
    return zeile;
  }

  const zeile = el('button', 'liste-zeile belege-zeile');
  zeile.type = 'button';
  zeile.addEventListener('click', () => belegBearbeiten(b, ctx.kontext));
  zeile.append(mini, textBlock, rechts);
  return zeile;
}

// Ausgabe eines PDFs. Am Laptop auf dem Server speichern, sonst teilen oder herunterladen.
// Gibt true bei Erfolg, false bei Abbruch zurück; Fehler werden geworfen.
async function pdfAusgeben(ctx, liste, name) {
  const blob = await belegePdf(liste, ladeBild);
  if (ctx.kontext?.laptop) {
    const antwort = await fetch('/api/beleg-pdf?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
    const json = await antwort.json();
    if (!json?.ok) throw new Error('Speichern am Laptop fehlgeschlagen');
    ctx.meldungZeigen(`Gespeichert: ${json.datei}`, { ordner: true });
    return true;
  }
  const datei = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [datei] })) {
    try {
      await navigator.share({ files: [datei], title: name });
    } catch (e) {
      if (e?.name === 'AbortError') return false;
      throw e;
    }
    return true;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

// Ausgabe mit Knopf-Zustand: während der Arbeit deaktiviert. Gibt true bei Erfolg zurück.
async function ausgeben(ctx, liste, name, knopf) {
  const alt = knopf.textContent;
  knopf.disabled = true;
  knopf.textContent = 'PDF wird erstellt …';
  try {
    return await pdfAusgeben(ctx, liste, name);
  } catch (e) {
    console.error(e);
    ctx.meldungZeigen(
      e?.message === 'Keine Belegbilder vorhanden.' ? 'Diese Belege haben keine Fotos.' : 'PDF konnte nicht erstellt werden.',
      { fehler: true },
    );
    return false;
  } finally {
    knopf.disabled = false;
    knopf.textContent = alt;
  }
}

export async function zeigen(ziel, kontext) {
  const [roh, reisen] = await Promise.all([alle('belege'), alle('reisen')]);
  let belege = roh.filter((b) => b && !b.geloescht);
  let filter = filterLesen();
  let auswahlModus = false;
  let banner = null;
  const gewaehlt = new Set();

  ziel.innerHTML = `
    <header class="kopf glas">
      <div>
        <h1>Belege</h1>
        <p class="notiz zahl" data-anzahl></p>
      </div>
      <nav class="aktionen" aria-label="Belege">
        <button type="button" class="knopf knopf-klein belege-auswahl-knopf" data-auswahl hidden>Auswählen</button>
        <button type="button" class="knopf haupt" data-erfassen>Beleg erfassen</button>
      </nav>
    </header>
    <div class="segment belege-segment" role="group" aria-label="Welche Belege zeigen" data-segment></div>
    <div class="belege-banner" data-banner hidden></div>
    <p class="belege-meldung" role="status" data-meldung hidden></p>
    <div data-liste></div>
    <div class="belege-leiste" data-leiste hidden>
      <button type="button" class="knopf knopf-karte" data-leiste-pdf>PDF (0)</button>
      <button type="button" class="knopf knopf-karte haupt" data-leiste-markieren>Als abgegeben markieren</button>
    </div>
  `;

  const anzahl = ziel.querySelector('[data-anzahl]');
  const auswahlKnopf = ziel.querySelector('[data-auswahl]');
  const segment = ziel.querySelector('[data-segment]');
  const bannerBox = ziel.querySelector('[data-banner]');
  const meldungEl = ziel.querySelector('[data-meldung]');
  const liste = ziel.querySelector('[data-liste]');
  const leiste = ziel.querySelector('[data-leiste]');
  const leistePdf = ziel.querySelector('[data-leiste-pdf]');
  const leisteMarkieren = ziel.querySelector('[data-leiste-markieren]');

  // Gemeinsamer Kontext für die Hilfsfunktionen oben (Zeile, Ausgabe)
  const ctx = {
    reisen,
    kontext,
    auswahlModus: false,
    gewaehlt,
    leisteZeichnen: () => leisteZeichnen(),
    meldungZeigen: (...a) => meldungZeigen(...a),
  };

  const sichtbar = () => belege.filter((b) => (
    filter === 'alle' || (filter === 'abgegeben') === (b.status === 'abgegeben')
  ));
  const gewaehltListe = () => sichtbar().filter((b) => gewaehlt.has(b.id));

  function leerText(t) {
    return el('p', 'leer', t);
  }

  function meldungZeigen(t, { fehler = false, ordner = false } = {}) {
    meldungEl.replaceChildren(el('span', null, t));
    meldungEl.classList.toggle('fehler', fehler);
    if (ordner) {
      const knopf = el('button', 'knopf knopf-karte', 'Ordner öffnen');
      knopf.type = 'button';
      knopf.addEventListener('click', ordnerOeffnen);
      meldungEl.append(knopf);
    }
    meldungEl.hidden = false;
  }

  async function ordnerOeffnen() {
    try {
      const antwort = await fetch('/api/ordner-oeffnen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unterordner: 'Belege' }),
      });
      if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
    } catch (e) {
      console.warn('Ordner nicht geöffnet:', e?.message);
      meldungZeigen('Der Ordner konnte nicht geöffnet werden.', { fehler: true });
    }
  }

  function auswahlAus() {
    auswahlModus = false;
    gewaehlt.clear();
  }

  // Ausgabe einer Liste, danach Banner, falls noch offene Belege darin sind
  async function ausgabeAbschliessen(liste2, name, knopf) {
    const ok = await ausgeben(ctx, liste2, name, knopf);
    if (!ok) return;
    const offen = liste2.filter((b) => b.status !== 'abgegeben');
    if (offen.length) banner = offen;
    render();
  }

  // Als abgegeben markieren, danach Auswahlmodus beenden und neu zeichnen
  async function markieren(offen) {
    const ids = new Set(offen.map((b) => b.id));
    const stand = kontext?.heute || heute();
    banner = null;
    auswahlAus();
    if (ids.size) {
      try {
        for (const b of offen) {
          await speichern('belege', { ...b, status: 'abgegeben', abgegebenAm: stand });
        }
        belege = belege.map((b) => (ids.has(b.id) ? { ...b, status: 'abgegeben', abgegebenAm: stand } : b));
      } catch (e) {
        console.error(e);
        meldungZeigen('Markieren hat nicht geklappt. Bitte noch einmal versuchen.', { fehler: true });
      }
    }
    render();
  }

  function bannerZeichnen() {
    bannerBox.replaceChildren();
    bannerBox.hidden = !banner;
    if (!banner) return;
    const liste2 = banner;
    const n = liste2.length;
    const frage = el('p', 'belege-banner-text', `${n} ${n === 1 ? 'Beleg' : 'Belege'} als abgegeben markieren?`);
    const ja = el('button', 'knopf knopf-karte haupt', 'Markieren');
    ja.type = 'button';
    ja.addEventListener('click', () => markieren(liste2));
    const nein = el('button', 'knopf knopf-karte', 'Nicht jetzt');
    nein.type = 'button';
    nein.addEventListener('click', () => {
      banner = null;
      render();
    });
    const aktionen = el('div', 'belege-banner-aktionen');
    aktionen.append(ja, nein);
    bannerBox.append(frage, aktionen);
  }

  function segmentZeichnen() {
    segment.replaceChildren(...FILTER.map(({ wert, text: t }) => {
      const knopf = el('button', 'segment-teil');
      knopf.type = 'button';
      knopf.setAttribute('aria-pressed', String(wert === filter));
      knopf.append(el('span', null, t));
      knopf.addEventListener('click', () => filterSetzen(wert));
      return knopf;
    }));
  }

  function filterSetzen(wert) {
    if (wert === filter) return;
    filter = wert;
    filterMerken(wert);
    auswahlAus();
    banner = null;
    render();
  }

  function gruppePdf(g, knopf) {
    const name = g.monat ? `Belege ${g.titel}.pdf` : 'Belege ohne Datum.pdf';
    return ausgabeAbschliessen(g.belege, name, knopf);
  }

  // Monatsabschnitt: klebende Überschrift mit Titel, Summen und PDF-Knopf, darunter die Zeilen
  function gruppeBauen(g, paare) {
    folge += 1;
    const id = `belege-gruppe-${folge}`;
    const abschnitt = el('section', 'belege-gruppe');
    abschnitt.setAttribute('aria-labelledby', id);

    const kopf = el('div', 'belege-gruppe-kopf');
    const titel = el('h2', 'belege-gruppe-titel', g.titel);
    titel.id = id;
    const rechts = el('div', 'belege-gruppe-rechts');
    const summe = Object.entries(g.summen).map(([w, b]) => betragText(b, w)).filter(Boolean).join(' · ');
    if (summe) rechts.append(el('span', 'belege-gruppe-summe zahl', summe));
    const pdf = el('button', 'belege-pdf', 'PDF');
    pdf.type = 'button';
    pdf.setAttribute('aria-label', `PDF für ${g.monat ? g.titel : 'Belege ohne Datum'}`);
    pdf.addEventListener('click', () => gruppePdf(g, pdf));
    rechts.append(pdf);
    kopf.append(titel, rechts);

    const ul = el('ul', 'liste belege-liste');
    for (const b of g.belege) {
      const eintrag = el('li');
      eintrag.append(zeileBauen(ctx, b, paare));
      ul.append(eintrag);
    }
    abschnitt.append(kopf, ul);
    return abschnitt;
  }

  // Fußleiste des Auswahlmodus: Zähler und Schaltflächen, deaktiviert bei 0 gewählt
  function leisteZeichnen() {
    const n = gewaehlt.size;
    leistePdf.textContent = `PDF (${n})`;
    leistePdf.disabled = n === 0;
    leisteMarkieren.disabled = n === 0;
  }

  function klebeOffset() {
    const kopf = ziel.querySelector('.kopf');
    if (!kopf) return;
    const oben = parseFloat(getComputedStyle(kopf).top) || 0;
    ziel.style.setProperty('--belege-oben', `${oben + kopf.offsetHeight + 8}px`);
  }

  function render() {
    zug += 1;
    urlsFreigeben();
    const zugNr = zug;
    ctx.auswahlModus = auswahlModus;

    const zeigbar = sichtbar();
    anzahl.textContent = anzahlText(belege.length);
    auswahlKnopf.hidden = belege.length === 0;
    auswahlKnopf.textContent = auswahlModus ? 'Fertig' : 'Auswählen';
    segmentZeichnen();
    bannerZeichnen();

    liste.replaceChildren();
    if (belege.length === 0) {
      liste.append(leerText('Noch keine Belege. Scanne einen Kassenzettel oder eine Rechnung.'));
    } else if (zeigbar.length === 0) {
      liste.append(leerText(LEER_TEXT[filter]));
    } else {
      const paare = [];
      for (const g of nachMonat(zeigbar)) liste.append(gruppeBauen(g, paare));
      minisNachladen(paare, zugNr);
    }

    leiste.hidden = !auswahlModus;
    leisteZeichnen();
    klebeOffset();
  }

  auswahlKnopf.addEventListener('click', () => {
    if (auswahlModus) auswahlAus();
    else auswahlModus = true;
    render();
  });
  ziel.querySelector('[data-erfassen]').addEventListener('click', () => belegErfassen(kontext));
  leistePdf.addEventListener('click', () => {
    const liste2 = gewaehltListe();
    if (!liste2.length) return;
    const name = liste2.length === 1
      ? belegDateiname(liste2[0])
      : `Belege Auswahl ${kontext?.heute || heute()}.pdf`;
    ausgabeAbschliessen(liste2, name, leistePdf);
  });
  leisteMarkieren.addEventListener('click', () => {
    markieren(gewaehltListe().filter((b) => b.status !== 'abgegeben'));
  });

  render();
  if ('ResizeObserver' in window) new ResizeObserver(klebeOffset).observe(ziel.querySelector('.kopf'));
}
