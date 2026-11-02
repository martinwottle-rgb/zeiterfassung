// Ansicht Suche (#suche/<begriff>): ein Suchfeld über Kontakte, Belege, Reisen und Auswertungen.
// Der Begriff steht im Hash, damit Zurück funktioniert. Beim Tippen wird der Hash nur ersetzt (replaceState)
// und die Trefferliste neu gezeichnet, das Feld behält den Fokus. Ab 2 Zeichen wird gesucht, ohne Groß und Klein.
import { alle, einstellungenLaden } from './speicher.js';
import { kontaktName } from './kontakte.js';
import { kontaktOeffnen } from './kontakt_sheet.js';
import { belegBearbeiten } from './beleg_sheet.js';
import { reisenGruppieren } from './reisen.js';
import { betragText } from './belege.js';
import { landAnzeige, reiseOeffnen } from './reise_sheet.js';

const GRENZE = 20; // höchstens so viele Treffer je Abschnitt werden angezeigt
const MIN_ZEICHEN = 2;

const text = (s) => String(s ?? '').trim();
const klein = (s) => s.toLocaleLowerCase('de-DE');

// 'JJJJ-MM-TT' zu 'TT.MM.JJJJ'; anderes unverändert
function datumDe(s) {
  const t = text(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : t;
}

// Suchtext aus den Feldern: leere weglassen, mit Leerzeichen verbinden, klein
function suchText(felder) {
  return klein(felder.map(text).filter(Boolean).join(' '));
}

function kontaktSuchText(k) {
  return suchText([kontaktName(k), k.firma, k.position, k.ort, k.land, k.email, k.telefon, k.mobil, k.notiz]);
}

function belegSuchText(b) {
  const betrag = typeof b.betrag === 'number' && Number.isFinite(b.betrag)
    ? b.betrag.toFixed(2).replace('.', ',')
    : '';
  return suchText([b.haendler, b.beschreibung, b.kategorie, betrag, betragText(b.betrag, b.waehrung), datumDe(b.datum)]);
}

function reiseSuchText(g) {
  return suchText([g.anlass, g.land, landAnzeige(g.land), datumDe(g.von), datumDe(g.bis)]);
}

function auswertungSuchText(a) {
  return suchText([a.anlass]);
}

// Treffer je Art. begriff ab 2 Zeichen; sonst leer. Nur nicht gelöschte Einträge.
// Jede Art höchstens `grenze` Treffer (Vorgabe 20); die Ansicht reicht Infinity, um die Gesamtzahl zu zeigen.
export function suchen(daten, begriff, grenze = GRENZE) {
  const leer = { kontakte: [], belege: [], reisen: [], auswertungen: [] };
  const q = klein(text(begriff));
  if (q.length < MIN_ZEICHEN) return leer;

  const passt = (liste, fn) => liste.filter((x) => fn(x).includes(q)).slice(0, grenze);

  const kontakte = (daten.kontakte ?? [])
    .filter((k) => k && !k.geloescht)
    .sort((a, b) => kontaktName(a).localeCompare(kontaktName(b), 'de'));
  const belege = (daten.belege ?? [])
    .filter((b) => b && !b.geloescht)
    .sort((a, b) => ((b.datum ?? '') < (a.datum ?? '') ? -1 : (b.datum ?? '') > (a.datum ?? '') ? 1 : 0));
  // Reisen gruppiert wie in der Reiseansicht; reisenGruppieren lässt gelöschte Tage weg
  const reisen = reisenGruppieren(daten.reisen ?? []);
  const auswertungen = (daten.auswertungen ?? [])
    .filter((a) => a && !a.geloescht)
    .sort((a, b) => (b.erstellt ?? 0) - (a.erstellt ?? 0));

  return {
    kontakte: passt(kontakte, kontaktSuchText),
    belege: passt(belege, belegSuchText),
    reisen: passt(reisen.slice().reverse(), reiseSuchText),
    auswertungen: passt(auswertungen, auswertungSuchText),
  };
}

function el(tag, klasse = null, inhalt = null) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (inhalt != null) e.textContent = inhalt;
  return e;
}

// Abschnitt mit Überschrift „Titel (N)“ und Liste; N ist die Gesamtzahl, angezeigt werden die ersten GRENZE
function abschnittBauen(titel, gesamt, treffer, zeileFn) {
  const box = el('section', 'suche-abschnitt');
  box.append(el('h2', 'suche-abschnitt-kopf', `${titel} (${gesamt})`));
  const ul = el('ul', 'liste');
  for (const t of treffer.slice(0, GRENZE)) {
    const li = el('li');
    li.append(zeileFn(t));
    ul.append(li);
  }
  box.append(ul);
  if (gesamt > GRENZE) box.append(el('p', 'notiz suche-mehr', `Die ersten ${GRENZE} werden angezeigt.`));
  return box;
}

// Zeile mit Titel und Unterzeile; Antippen ruft onKlick auf
function knopfZeile(titel, unter, onKlick) {
  const zeile = el('button', 'liste-zeile suche-zeile');
  zeile.type = 'button';
  const textBlock = el('span', 'liste-text');
  textBlock.append(el('span', 'liste-titel', titel));
  if (unter) textBlock.append(el('span', 'liste-unter', unter));
  zeile.append(textBlock);
  zeile.addEventListener('click', onKlick);
  return zeile;
}

export async function zeigen(ziel, kontext) {
  const begriff = kontext?.parameter ?? '';
  const [kontakte, belege, reisen, einst] = await Promise.all([
    alle('kontakte'),
    alle('belege'),
    alle('reisen'),
    einstellungenLaden(),
  ]);
  const daten = { kontakte, belege, reisen, auswertungen: einst.auswertungen ?? [] };

  // Das Feld hat den Fokus nur, wenn er nicht schon in dieser Ansicht liegt (Neuzeichnen nach Datenänderung)
  const fokusNoetig = !ziel.contains(document.activeElement);

  ziel.innerHTML = `
    <header class="kopf glas">
      <div>
        <h1>Suche</h1>
      </div>
    </header>
  `;

  const feldBox = el('div', 'kontakt-suche suche-feld');
  const feld = el('input');
  feld.type = 'search';
  feld.id = 'suche-feld';
  feld.name = 'suche';
  feld.value = begriff;
  feld.placeholder = 'Kontakte, Belege, Reisen, Auswertungen';
  feld.autocomplete = 'off';
  feld.setAttribute('enterkeyhint', 'search');
  feld.setAttribute('aria-label', 'Alles durchsuchen');
  feldBox.append(feld);

  const ergebnis = el('div', 'suche-ergebnis');
  ziel.append(feldBox, ergebnis);

  function oeffneBeleg(b) {
    belegBearbeiten(b, kontext);
  }

  function ergebnisZeichnen() {
    const q = text(feld.value);
    ergebnis.replaceChildren();
    if (q.length < MIN_ZEICHEN) {
      ergebnis.append(el('p', 'leer', 'Gib mindestens 2 Zeichen ein.'));
      return;
    }
    const treffer = suchen(daten, q, Infinity);
    const gesamt = treffer.kontakte.length + treffer.belege.length + treffer.reisen.length + treffer.auswertungen.length;
    if (gesamt === 0) {
      ergebnis.append(el('p', 'leer', 'Nichts gefunden.'));
      return;
    }

    if (treffer.kontakte.length) {
      ergebnis.append(abschnittBauen('Kontakte', treffer.kontakte.length, treffer.kontakte, (k) => knopfZeile(
        kontaktName(k),
        [text(k.firma), text(k.ort)].filter(Boolean).join(' · '),
        () => kontaktOeffnen(k),
      )));
    }

    if (treffer.belege.length) {
      ergebnis.append(abschnittBauen('Belege', treffer.belege.length, treffer.belege, (b) => knopfZeile(
        text(b.haendler) || text(b.kategorie) || 'Beleg',
        [datumDe(b.datum), betragText(b.betrag, b.waehrung)].filter(Boolean).join(' · '),
        () => oeffneBeleg(b),
      )));
    }

    if (treffer.reisen.length) {
      ergebnis.append(abschnittBauen('Reisen', treffer.reisen.length, treffer.reisen, (g) => {
        const tage = g.tage.length;
        const zeitraum = g.von === g.bis ? datumDe(g.von) : `${datumDe(g.von)} bis ${datumDe(g.bis)}`;
        return knopfZeile(
          text(g.anlass) || 'Ohne Anlass',
          [landAnzeige(g.land), zeitraum, `${tage} ${tage === 1 ? 'Tag' : 'Tage'}`].filter(Boolean).join(' · '),
          () => reiseOeffnen({ tage: g.tage }, kontext).catch((e) => console.error(e)),
        );
      }));
    }

    if (treffer.auswertungen.length) {
      ergebnis.append(abschnittBauen('Auswertungen', treffer.auswertungen.length, treffer.auswertungen, (a) => {
        const link = el('a', 'liste-zeile suche-zeile');
        link.href = '#auswertung/' + encodeURIComponent(a.id);
        const textBlock = el('span', 'liste-text');
        textBlock.append(el('span', 'liste-titel', text(a.anlass) || 'Auswertung'));
        const zeitraum = [datumDe(a.von), datumDe(a.bis)].filter(Boolean).join(' bis ');
        if (zeitraum) textBlock.append(el('span', 'liste-unter', zeitraum));
        link.append(textBlock);
        return link;
      }));
    }
  }

  // Beim Tippen nur den Hash ersetzen (kein hashchange, also keine Neuzeichnung der Ansicht)
  feld.addEventListener('input', () => {
    history.replaceState(null, '', '#suche/' + encodeURIComponent(feld.value));
    ergebnisZeichnen();
  });

  ergebnisZeichnen();

  // app.js setzt nach dem Wechsel den Fokus auf die Ansicht; deshalb erst danach ins Feld
  if (fokusNoetig) setTimeout(() => feld.focus({ preventScroll: true }), 0);
}
