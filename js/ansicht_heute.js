// Ansicht Heute: Kopf, Ring, Knöpfe, Tagesverlauf und Karten.
// Darstellung nach Entwurf A. Zeit kommt aus kontext.heute und kontext.jetzt, Daten aus kontext.daten.
import { dauer, dauerMitVorzeichen, uhrzeit, langesDatum, monatsname, wochenbeginn, minutenAusUhrzeit, wochentag } from './zeit.js';
import { tagesInfo, woche, kontostand, urlaubRest, urlaubAnspruch, hinweise, monat, offeneAltbloecke, laufendeBloecke } from './rechnen.js';
import { stempeln } from './stempeln.js';
import { speichern, loeschen } from './speicher.js';
import { tagOeffnen } from './tag_sheet.js';
import { pcVorschlaege, reiseVorschlaege, pcUebernehmen, verwerfen } from './vorschlaege.js';
import { reiseOeffnen } from './reise_sheet.js';

const PAUSE_AB = 15;              // Lücken ab 15 min zählen als Pause, wie in rechnen.js
const ACHSE_VON = 6 * 60;         // Zeitleiste mindestens 6 bis 20 Uhr
const ACHSE_BIS = 20 * 60;
const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
const ABWESENHEIT_NAME = {
  urlaub: 'Urlaub',
  krank: 'Krank',
  ueberstunden: 'Überstundenabbau',
  sonstiges: 'Abwesend',
};

// Escaping für alles, was aus Daten stammt.
function esc(wert) {
  return String(wert).replace(/[&<>"']/g, (z) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[z]);
}

// Prozentwert auf zwei Nachkommastellen für style-Attribute.
function pr(wert) {
  return Math.round(wert * 100) / 100;
}

// Anzahl mit Komma statt Punkt (21,5).
function zahlText(n) {
  return String(n).replace('.', ',');
}

// Knöpfe je Stempelzustand.
function knoepfe(zustand) {
  const haupt = (aktion, text) =>
    `<button class="knopf knopf-haupt knopf-gross" type="button" data-stempel="${aktion}">${text}</button>`;
  const klein = (aktion, text) =>
    `<button class="knopf knopf-klein" type="button" data-stempel="${aktion}">${text}</button>`;
  if (zustand === 'arbeit') return haupt('pause', 'Pause') + klein('gehen', 'Gehen');
  if (zustand === 'pause') return haupt('kommen', 'Weiter') + klein('gehen', 'Gehen');
  if (zustand === 'gegangen') return klein('kommen', 'Weiter arbeiten');
  return haupt('kommen', 'Kommen');
}

// Erzeugt ein Element. Attribute mit false, null oder undefined werden weggelassen, true wird zum leeren Attribut.
function el(tag, attribute = {}, kinder = []) {
  const e = document.createElement(tag);
  for (const [name, wert] of Object.entries(attribute)) {
    if (wert === false || wert === null || wert === undefined) continue;
    if (name === 'text') e.textContent = wert;
    else if (name === 'klasse') e.className = wert;
    else e.setAttribute(name, wert === true ? '' : String(wert));
  }
  e.append(...kinder.filter(Boolean));
  return e;
}

// 480 zu '08:00' (Format des Zeitfelds).
function hhmm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// Fehler unter dem Feld: aria-invalid und aria-describedby zeigen auf die Meldung. Leerer Text räumt auf.
function fehlerSetzen(eingabe, fehler, text) {
  if (text) {
    eingabe.setAttribute('aria-invalid', 'true');
    eingabe.setAttribute('aria-describedby', fehler.id);
    fehler.textContent = text;
    fehler.hidden = false;
  } else {
    eingabe.setAttribute('aria-invalid', 'false');
    eingabe.removeAttribute('aria-describedby');
    fehler.textContent = '';
    fehler.hidden = true;
  }
}

const UHR_TITEL = { kommen: 'Kommen um', pause: 'Pause um', gehen: 'Gehen um' };

// Sheet „Andere Uhrzeit“: stempelt mit einer frei gewählten Uhrzeit. Bei arbeit wählt man Pause oder Gehen.
function andereUhrzeitOeffnen(kontext, zustand) {
  const jetzt = kontext.jetzt;
  const mitSegment = zustand === 'arbeit';
  const beginn = mitSegment ? 'pause' : 'kommen';
  let sendet = false;

  const segment = mitSegment
    ? el('div', { klasse: 'feld', role: 'radiogroup', 'aria-labelledby': 'uhr-aktion-name' }, [
      el('span', { klasse: 'feld-name', id: 'uhr-aktion-name', text: 'Aktion' }),
      el('div', { klasse: 'segment' }, [['pause', 'Pause'], ['gehen', 'Gehen']].map(([wert, name]) => el('label', { klasse: 'segment-teil' }, [
        el('input', { type: 'radio', name: 'aktion', value: wert, checked: wert === beginn }),
        el('span', { text: name }),
      ]))),
    ])
    : null;

  // Die Überschrift des Sheets folgt der gewählten Aktion.
  if (segment) {
    segment.querySelectorAll('input[name="aktion"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const titel = document.getElementById('sheet-titel');
        if (titel) titel.textContent = UHR_TITEL[radio.value];
      });
    });
  }

  const zeitEingabe = el('input', { type: 'time', id: 'uhr-zeit', name: 'uhrzeit', step: 60, value: hhmm(jetzt) });
  const zeitFehler = el('p', { klasse: 'notiz feld-fehler', id: 'uhr-zeit-fehler', hidden: true });
  zeitEingabe.addEventListener('input', () => fehlerSetzen(zeitEingabe, zeitFehler, ''));

  // Schnellwahl: setzt nur das Feld. Liegt die Zeit vor 0 Uhr, ist der Knopf aus.
  const schnell = [[15, 'vor 15 Min'], [30, 'vor 30 Min'], [60, 'vor 1 Std']].map(([min, text]) => {
    const knopf = el('button', { type: 'button', klasse: 'knopf klein', text, disabled: jetzt - min < 0 });
    knopf.addEventListener('click', () => {
      zeitEingabe.value = hhmm(jetzt - min);
      fehlerSetzen(zeitEingabe, zeitFehler, '');
    });
    return knopf;
  });

  const abbrechen = el('button', { type: 'button', klasse: 'knopf', text: 'Abbrechen' });
  abbrechen.addEventListener('click', () => kontext.sheet.schliessen());
  const stempelKnopf = el('button', { type: 'submit', klasse: 'knopf haupt', text: 'Stempeln' });

  const form = el('form', { novalidate: true }, [
    segment,
    el('div', { klasse: 'feld' }, [
      el('label', { for: 'uhr-zeit', text: 'Uhrzeit' }),
      zeitEingabe,
      zeitFehler,
    ]),
    el('div', { klasse: 'aktionen' }, schnell),
    el('div', { klasse: 'aktionen' }, [abbrechen, stempelKnopf]),
  ]);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (sendet) return;
    const minuten = minutenAusUhrzeit(zeitEingabe.value);
    if (minuten === null) {
      fehlerSetzen(zeitEingabe, zeitFehler, 'Bitte eine Uhrzeit wie 8:00 eingeben.');
      zeitEingabe.focus();
      return;
    }
    fehlerSetzen(zeitEingabe, zeitFehler, '');
    const aktion = mitSegment ? (form.querySelector('input[name="aktion"]:checked')?.value ?? 'pause') : 'kommen';
    sendet = true;
    stempelKnopf.disabled = true;
    try {
      await stempeln(aktion, minuten);
      kontext.sheet.schliessen();
    } catch (e) {
      sendet = false;
      stempelKnopf.disabled = false;
      fehlerSetzen(zeitEingabe, zeitFehler, e?.message || 'Speichern fehlgeschlagen. Bitte noch einmal versuchen.');
      zeitEingabe.focus();
    }
  });

  kontext.sheet.oeffnen(UHR_TITEL[beginn], form);
}

// Ring: erste Runde bis 100 %, darüber eine zweite Runde mit halber Deckkraft.
function ringSvg(ist, soll) {
  const anteil = soll > 0 ? ist / soll : 0;
  const erste = pr(Math.min(anteil, 1) * 100);
  const zweite = pr(Math.min(Math.max(anteil - 1, 0), 1) * 100);
  const drehung = 'transform="rotate(-90 110 110)"';
  let kreise = '<circle class="ring-spur" cx="110" cy="110" r="100"/>';
  if (erste > 0) {
    kreise += `<circle class="ring-stand" cx="110" cy="110" r="100" pathLength="100" ${drehung} style="stroke-dasharray: ${erste} 100"/>`;
  }
  if (zweite > 0) {
    kreise += `<circle class="ring-stand ring-zweit" cx="110" cy="110" r="100" pathLength="100" ${drehung} style="stroke-dasharray: ${zweite} 100"/>`;
  }
  return `<svg viewBox="0 0 220 220" aria-hidden="true">${kreise}</svg>`;
}

// Tagesverlauf: Blöcke, Pausen (Lücken), Jetzt-Linie, Achse und Legende.
function verlauf(bloecke, zustand, jetzt) {
  const laeuft = zustand !== 'aus';

  // Pausen: Lücken zwischen zwei Blöcken, nur wenn der vorherige Block ein Ende hat.
  const pausen = [];
  for (let i = 1; i < bloecke.length; i++) {
    const vorher = bloecke[i - 1];
    if (vorher.ende === null) continue;
    if (bloecke[i].beginn - vorher.ende >= PAUSE_AB) {
      pausen.push({ von: vorher.ende, bis: bloecke[i].beginn });
    }
  }

  // Achse: 6 bis 20 Uhr, erweitert auf volle Stunden, wenn Blöcke oder Jetzt außerhalb liegen.
  let von = ACHSE_VON;
  let bis = ACHSE_BIS;
  for (const b of bloecke) von = Math.min(von, b.beginn);
  for (const b of bloecke) bis = Math.max(bis, b.ende ?? jetzt);
  if (laeuft) bis = Math.max(bis, jetzt);
  const stundeVon = Math.floor(von / 60);
  const stundeBis = Math.ceil(bis / 60);
  const spanne = (stundeBis - stundeVon) * 60;
  const pos = (minute) => pr(((minute - stundeVon * 60) / spanne) * 100);
  const breite = (a, b) => pr(pos(b) - pos(a));

  const inhalt = [];
  for (const b of bloecke) {
    const ende = b.ende ?? jetzt;
    const klasse = b.ende === null ? 'laeuft' : 'arbeit';
    inhalt.push(`<span class="block ${klasse}" style="left: ${pos(b.beginn)}%; width: ${breite(b.beginn, ende)}%"></span>`);
  }
  for (const p of pausen) {
    inhalt.push(`<span class="block pause" style="left: ${pos(p.von)}%; width: ${breite(p.von, p.bis)}%"></span>`);
  }
  if (laeuft) {
    inhalt.push(`<span class="jetzt-linie" style="left: ${pos(jetzt)}%"></span>`);
    inhalt.push(`<span class="jetzt" style="left: ${pos(jetzt)}%">Jetzt</span>`);
  }

  // Stundenbeschriftung alle zwei Stunden, am Ende die letzte Stunde mit „Uhr“.
  const stunden = [];
  for (let h = stundeVon; h < stundeBis - 1; h += 2) {
    stunden.push(`<span style="left: ${pos(h * 60)}%">${h}</span>`);
  }
  stunden.push(`<span>${stundeBis} Uhr</span>`);

  // Legende in zeitlicher Reihenfolge.
  const eintraege = [];
  for (const b of bloecke) {
    const text = b.ende === null
      ? `Arbeit seit ${uhrzeit(b.beginn)}, läuft`
      : `Arbeit ${uhrzeit(b.beginn)} bis ${uhrzeit(b.ende)}`;
    eintraege.push({ start: b.beginn, html: `<li><i class="sw-arbeit"></i>${esc(text)}</li>` });
  }
  for (const p of pausen) {
    eintraege.push({
      start: p.von,
      html: `<li><i class="sw-pause"></i>Pause ${uhrzeit(p.von)} bis ${uhrzeit(p.bis)}</li>`,
    });
  }
  eintraege.sort((a, b) => a.start - b.start);
  const legende = eintraege.length > 0
    ? `<ul class="legende">${eintraege.map((e) => e.html).join('')}</ul>`
    : '';

  return `
      <section class="karte zeit" aria-labelledby="zeit-titel">
        <h2 id="zeit-titel">Tagesverlauf</h2>
        <button class="zeitleiste" type="button" aria-label="Tag bearbeiten" data-tag>${inhalt.join('')}</button>
        <div class="stunden" aria-hidden="true">${stunden.join('')}</div>
        ${legende}
      </section>`;
}

// Karte Diese Woche: Mo bis Fr mit Balken zum Tagessoll. Jede Zeile ist ein Knopf und öffnet ihren Tag.
function karteWoche(tage, heute) {
  const zeilen = WOCHENTAGE_KURZ.map((kurz, i) => {
    const t = tage[i];
    const laeuftJetzt = t.datum === heute && t.zustand === 'arbeit';
    const anteil = t.soll > 0 ? Math.min(t.ist / t.soll, 1) : (t.ist > 0 ? 1 : 0);
    const wert = laeuftJetzt ? 'läuft' : dauer(t.ist);
    const klasse = laeuftJetzt ? ' class="laeuft"' : '';
    return `
        <button class="woche-zeile woche-tag-knopf" type="button" data-tag-datum="${esc(t.datum)}" aria-label="${esc(`${langesDatum(t.datum)} bearbeiten`)}"><span class="tag">${kurz}</span><div class="balken"><i${klasse} style="width: ${pr(anteil * 100)}%"></i></div><span class="wert zahl">${wert}</span></button>`;
  }).join('');
  const istWoche = tage.reduce((summe, t) => summe + t.ist, 0);
  const sollWoche = tage.reduce((summe, t) => summe + t.soll, 0);
  return `
      <section class="karte karte-link" aria-labelledby="k-woche">
        <h2 id="k-woche"><a class="karte-ziel" href="#woche">Diese Woche</a></h2>${zeilen}
        <div class="saldo"><span>Woche bisher</span><strong class="zahl">${dauer(istWoche)} von ${dauer(sollWoche)}</strong></div>
      </section>`;
}

// Hinweise zu Pause, Höchstarbeitszeit und Ruhezeit (nur wenn vorhanden).
function karteHinweise(liste) {
  const punkte = liste.map((h) => {
    const symbol = h.erfuellt
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.5L16 9.5"/></svg>'
      : '<svg class="warnsymbol" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16h.01"/></svg>';
    return `
        <div class="hinweis">${symbol}<div><p>${esc(h.text)}</p></div></div>`;
  }).join('');
  return `
      <section class="karte karte-link breit" aria-labelledby="k-hinweise">
        <h2 id="k-hinweise"><button class="karte-ziel" type="button" data-tag-heute>Hinweise</button></h2>${punkte}
      </section>`;
}

// Vorschläge: höchstens drei Einträge, der Rest als Link zur Woche.
const KURZ_TAG = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const VORSCHLAG_MAX = 3;

// '2026-10-22' zu 'Do 22.10.'
function tagKurz(d) {
  const [, m, t] = d.split('-').map(Number);
  return `${KURZ_TAG[wochentag(d)]} ${String(t).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
}

function vorschlagText(v) {
  if (v.quelle === 'pc') {
    const erster = v.bloecke[0];
    const letzter = v.bloecke[v.bloecke.length - 1];
    const anzahl = v.bloecke.length;
    return `${langesDatum(v.datum)}: PC aktiv ${uhrzeit(erster.beginn)} bis ${uhrzeit(letzter.ende)} (${anzahl} ${anzahl === 1 ? 'Block' : 'Blöcke'}). Übernehmen?`;
  }
  return `${tagKurz(v.datum)} Termin ‚${v.betreff || 'ohne Betreff'}‘ in ${v.ort} (aus Outlook). Als Dienstreise eintragen?`;
}

// Ein Eintrag der Karte. Verwerfen zeichnet nur die Karte neu, Übernehmen löst über daten-geaendert ein Neuzeichnen aus.
function vorschlagEintrag(v, platz, liste, kontext) {
  const hinweis = el('p', { klasse: 'notiz', role: 'status', hidden: true });
  const zeigeFehler = (text) => {
    hinweis.textContent = text;
    hinweis.hidden = false;
  };
  const verwerfenKnopf = el('button', { type: 'button', klasse: 'knopf knopf-karte', text: 'Verwerfen' });
  verwerfenKnopf.addEventListener('click', () => {
    verwerfen(v.schluessel);
    vorschlagKarte(platz, liste.filter((x) => x !== v), kontext);
  });

  let knoepfe;
  if (v.quelle === 'pc') {
    const uebernehmenKnopf = el('button', { type: 'button', klasse: 'knopf knopf-haupt knopf-karte', text: 'Übernehmen' });
    uebernehmenKnopf.addEventListener('click', async () => {
      uebernehmenKnopf.disabled = true;
      try {
        await pcUebernehmen(v);
      } catch (e) {
        uebernehmenKnopf.disabled = false;
        zeigeFehler(e?.message || 'Übernehmen hat nicht geklappt.');
      }
    });
    const ansehenKnopf = el('button', { type: 'button', klasse: 'knopf knopf-karte', text: 'Ansehen' });
    ansehenKnopf.addEventListener('click', () => tagOeffnen(v.datum, kontext));
    knoepfe = [uebernehmenKnopf, ansehenKnopf, verwerfenKnopf];
  } else {
    const eintragenKnopf = el('button', { type: 'button', klasse: 'knopf knopf-haupt knopf-karte', text: 'Eintragen' });
    eintragenKnopf.addEventListener('click', async () => {
      try {
        await reiseOeffnen({
          von: v.datum,
          bis: v.datum,
          beginn: v.beginn,
          ende: v.ende,
          anlass: `${v.betreff}, ${v.ort}`,
        }, kontext);
      } catch (e) {
        zeigeFehler(e?.message || 'Die Reise konnte nicht geöffnet werden.');
      }
    });
    knoepfe = [eintragenKnopf, verwerfenKnopf];
  }

  return el('li', { klasse: 'vorschlag-eintrag' }, [
    el('p', { text: vorschlagText(v) }),
    el('div', { klasse: 'karte-aktion' }, knoepfe),
    hinweis,
  ]);
}

// Zeichnet die Karte in den Platz. Leere Liste: keine Karte.
function vorschlagKarte(platz, liste, kontext) {
  if (liste.length === 0) {
    platz.replaceChildren();
    return;
  }
  const sichtbar = liste.slice(0, VORSCHLAG_MAX);
  const weitere = liste.length - sichtbar.length;
  const eintraege = sichtbar.map((v) => vorschlagEintrag(v, platz, liste, kontext));
  const karte = el('section', { klasse: 'karte breit vorschlaege', 'aria-labelledby': 'k-vorschlaege' }, [
    el('h2', { id: 'k-vorschlaege', text: 'Vorschläge' }),
    el('ul', { klasse: 'vorschlag-liste' }, eintraege),
    weitere > 0
      ? el('div', { klasse: 'karte-aktion' }, [el('a', { klasse: 'vorschlag-mehr', href: '#woche', text: `und ${weitere} weitere` })])
      : null,
  ]);
  platz.replaceChildren(karte);
}

// Lädt PC-Vorschläge und Reisevorschläge nach. Die übrige Ansicht ist schon da; ist der Platz inzwischen weg, passiert nichts.
async function vorschlaegeLaden(platz, kontext) {
  let liste = [];
  try {
    const [pc, reise] = await Promise.all([pcVorschlaege(kontext), reiseVorschlaege(kontext)]);
    liste = [...pc, ...reise].sort((a, b) => {
      if (a.datum !== b.datum) return a.datum > b.datum ? -1 : 1; // neueste zuerst
      if (a.quelle === b.quelle) return 0;
      return a.quelle === 'pc' ? -1 : 1;
    });
  } catch {
    liste = [];
  }
  if (!platz.isConnected) return;
  vorschlagKarte(platz, liste, kontext);
}

// Abgleich-Etikett im Kopf: zeigt den Stand des Abgleichs mit GitHub und startet ihn beim Antippen.
const ABGLEICH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14.6-4.5"/><path d="M19 3.5v4h-4"/><path d="M20 12a8 8 0 0 1-14.6 4.5"/><path d="M5 16.5v4h4"/></svg>';
let abgleichBeobachter = null;

function isoDatum(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Zeitpunkt in Worten, bezogen auf den heutigen Tag (JJJJ-MM-TT)
function abgeglichenText(ms, heuteIso) {
  const d = new Date(ms);
  const iso = isoDatum(d);
  if (iso === heuteIso) {
    return `Abgeglichen ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const [j, m, t] = heuteIso.split('-').map(Number);
  if (iso === isoDatum(new Date(j, m - 1, t - 1))) return 'Abgeglichen gestern';
  return `Abgeglichen am ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}

function abgleichEtikettZeichnen(knopf, kontext) {
  const s = kontext.abgleichStatus();
  knopf.hidden = !s.eingerichtet;
  if (!s.eingerichtet) return;
  // Während eines Abgleichs dreht nur das Symbol; der Text bleibt stehen, damit der Kopf nicht springt
  let text;
  if (s.fehler && !s.laeuft) text = 'Abgleich gestört';
  else if (s.zuletzt) text = abgeglichenText(s.zuletzt, kontext.heute);
  else text = s.laeuft ? 'Gleicht ab' : 'Noch nicht abgeglichen';

  knopf.classList.toggle('laeuft', Boolean(s.laeuft));
  knopf.classList.toggle('gestoert', !s.laeuft && Boolean(s.fehler));
  knopf.querySelector('[data-abgleich-text]').textContent = text;
  if (!s.laeuft && s.fehler) {
    knopf.title = s.fehler;
    knopf.setAttribute('aria-label', `Abgleich gestört: ${s.fehler}`);
  } else {
    knopf.removeAttribute('title');
    knopf.removeAttribute('aria-label');
  }
}

function abgleichEtikettAnbinden(knopf, kontext) {
  if (abgleichBeobachter) {
    window.removeEventListener('abgleich-status', abgleichBeobachter);
    abgleichBeobachter = null;
  }
  knopf.addEventListener('click', () => kontext.abgleichJetzt());
  abgleichEtikettZeichnen(knopf, kontext);
  // Nur das Etikett neu setzen. Verschwindet die Ansicht, meldet sich der Beobachter ab.
  abgleichBeobachter = () => {
    if (!knopf.isConnected) {
      window.removeEventListener('abgleich-status', abgleichBeobachter);
      abgleichBeobachter = null;
      return;
    }
    abgleichEtikettZeichnen(knopf, kontext);
  };
  window.addEventListener('abgleich-status', abgleichBeobachter);
}

// Warnsymbol für die Überschriften der Karten oben. Nur das Symbol trägt die Warnfarbe.
const WARN_SVG = '<svg class="warnsymbol" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16h.01"/></svg>';

// Ein Svg-Element aus Text (createElement kennt den SVG-Namensraum nicht).
function svgAus(markup) {
  const vorlage = document.createElement('template');
  vorlage.innerHTML = markup;
  return vorlage.content.firstElementChild;
}

function kartenTitel(id, text) {
  return el('h2', { id }, [svgAus(WARN_SVG), el('span', { text })]);
}

// Karte für einen Block von einem früheren Tag, der nie ausgestempelt wurde: Gehzeit nachtragen.
function altblockKarte(b, kontext) {
  const titelId = `k-altblock-${b.id}`;
  const feldId = `altblock-ende-${b.id}`;
  const fehlerId = `altblock-fehler-${b.id}`;
  const eingabe = el('input', { type: 'time', id: feldId, name: 'ende', step: 60 });
  const fehler = el('p', { klasse: 'notiz feld-fehler', id: fehlerId, hidden: true });
  eingabe.addEventListener('input', () => fehlerSetzen(eingabe, fehler, ''));

  const sichernKnopf = el('button', { type: 'submit', klasse: 'knopf knopf-haupt knopf-karte', text: 'Sichern' });
  const tagKnopf = el('button', { type: 'button', klasse: 'knopf knopf-karte', text: 'Tag ansehen' });
  tagKnopf.addEventListener('click', () => tagOeffnen(b.datum, kontext));

  const form = el('form', { novalidate: true }, [
    el('p', { text: `Am ${langesDatum(b.datum)} bist du seit ${uhrzeit(b.beginn)} eingestempelt. Wann bist du gegangen?` }),
    el('div', { klasse: 'feld' }, [
      el('label', { for: feldId, text: 'Gegangen um' }),
      eingabe,
      fehler,
    ]),
    el('div', { klasse: 'karte-aktion' }, [sichernKnopf, tagKnopf]),
  ]);

  let sendet = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (sendet) return;
    const minuten = minutenAusUhrzeit(eingabe.value);
    if (minuten === null) {
      fehlerSetzen(eingabe, fehler, 'Bitte eine Uhrzeit wie 17:00 eingeben.');
      eingabe.focus();
      return;
    }
    if (minuten <= b.beginn) {
      fehlerSetzen(eingabe, fehler, `Die Uhrzeit muss nach ${uhrzeit(b.beginn)} liegen.`);
      eingabe.focus();
      return;
    }
    fehlerSetzen(eingabe, fehler, '');
    sendet = true;
    sichernKnopf.disabled = true;
    try {
      // Die Ansicht zeichnet sich nach dem Speichern neu; die Karte verschwindet dann mit dem Block.
      await speichern('bloecke', { ...b, ende: minuten, gehen: true });
    } catch (e) {
      sendet = false;
      sichernKnopf.disabled = false;
      fehlerSetzen(eingabe, fehler, e?.message || 'Speichern fehlgeschlagen. Bitte noch einmal versuchen.');
      eingabe.focus();
    }
  });

  return el('section', { klasse: 'karte breit heute-karte', 'aria-labelledby': titelId }, [
    kartenTitel(titelId, 'Ausstempeln vergessen'),
    form,
  ]);
}

// Karte, wenn heute mehrere Blöcke gleichzeitig laufen: je Block ein Knopf, der die anderen löscht.
function mehrfachKarte(liste) {
  const titelId = 'k-mehrfach';
  const fehler = el('p', { klasse: 'notiz feld-fehler', role: 'status', hidden: true });
  const knoepfe = liste.map((b) => {
    const knopf = el('button', { type: 'button', klasse: 'knopf knopf-karte', text: `Seit ${uhrzeit(b.beginn)} behalten` });
    knopf.addEventListener('click', async () => {
      knoepfe.forEach((k) => { k.disabled = true; });
      try {
        for (const andere of liste) {
          if (andere.id !== b.id) await loeschen('bloecke', andere.id);
        }
      } catch (e) {
        knoepfe.forEach((k) => { k.disabled = false; });
        fehler.textContent = e?.message || 'Das hat nicht geklappt. Bitte noch einmal versuchen.';
        fehler.hidden = false;
      }
    });
    return knopf;
  });

  return el('section', { klasse: 'karte breit heute-karte', 'aria-labelledby': titelId }, [
    kartenTitel(titelId, 'Mehrere laufende Blöcke'),
    el('p', { text: 'Heute laufen mehrere Blöcke gleichzeitig. Welcher stimmt?' }),
    el('div', { klasse: 'karte-aktion' }, knoepfe),
    fehler,
  ]);
}

// Karten über dem Ring: je offenem Altblock eine Karte, dazu eine, wenn heute mehrere Blöcke laufen. Ohne Karten fällt der Platz weg.
function kartenZeichnen(platz, bloecke, heute, kontext) {
  const karten = offeneAltbloecke(bloecke, heute).map((b) => altblockKarte(b, kontext));
  const laufend = laufendeBloecke(bloecke, heute);
  if (laufend.length >= 2) karten.push(mehrfachKarte(laufend));
  if (karten.length === 0) {
    platz.remove();
    return;
  }
  platz.replaceChildren(...karten);
}

export async function zeigen(ziel, kontext) {
  const { heute, jetzt } = kontext;
  const { bloecke, abwesenheiten: abw, einstellungen: einst } = kontext.daten;

  const info = tagesInfo(bloecke, abw, einst, heute, jetzt);
  const tage = woche(bloecke, abw, einst, wochenbeginn(heute), jetzt, heute);

  const jahr = Number(heute.slice(0, 4));
  const monatNr = Number(heute.slice(5, 7));
  const m = monat(bloecke, abw, einst, jahr, monatNr, jetzt, heute);
  const konto = kontostand(bloecke, abw, einst, heute);
  const rest = urlaubRest(abw, einst, jahr);
  const anspruch = urlaubAnspruch(einst, jahr);
  const restAnteil = anspruch > 0 ? Math.min(Math.max(rest / anspruch, 0), 1) : 0;
  const hinweisListe = hinweise(bloecke, heute, jetzt, einst);

  // Untertitel unter dem Ring: Feiertag, Abwesenheit, frei oder Soll.
  let untertitel;
  if (info.feiertag) untertitel = info.feiertag;
  else if (info.abwesenheit) untertitel = ABWESENHEIT_NAME[info.abwesenheit.art] ?? 'Abwesend';
  else if (info.soll === 0) untertitel = 'frei';
  else untertitel = `von ${dauer(info.soll)}`;

  ziel.innerHTML = `
    <header class="kopf glas">
      <div>
        <p class="eyebrow">Heute</p>
        <h1>${esc(langesDatum(heute))}</h1>
      </div>
      <button class="abgleich-etikett" type="button" data-abgleich aria-live="polite" hidden>${ABGLEICH_SVG}<span data-abgleich-text></span></button>
    </header>

    <div class="heute-karten" data-heute-karten></div>

    <section class="hero" aria-label="Arbeitszeit heute">
      <div class="ring" role="img" aria-label="${esc(`${dauer(info.ist)} von ${dauer(info.soll)} gearbeitet`)}">
        ${ringSvg(info.ist, info.soll)}
        <div class="ring-mitte">
          <p class="ring-wert zahl">${dauer(info.ist)}</p>
          <p class="ring-soll">${esc(untertitel)}</p>
        </div>
      </div>
      <div class="aktionen">${knoepfe(info.zustand)}</div>
      <button class="knopf klein" type="button" data-andere-uhrzeit>Andere Uhrzeit</button>
    </section>

    ${verlauf(info.bloecke, info.zustand, jetzt)}

    <div class="raster">
      ${karteWoche(tage, heute)}

      <section class="karte karte-link" aria-labelledby="k-konto">
        <h2 id="k-konto"><a class="karte-ziel" href="#monat">Überstundenkonto</a></h2>
        <p class="kennzahl zahl">${dauerMitVorzeichen(konto)}</p>
      </section>

      <section class="karte karte-link" aria-labelledby="k-urlaub">
        <h2 id="k-urlaub"><a class="karte-ziel" href="#abwesenheiten">Urlaub</a></h2>
        <p class="urlaub-text">${zahlText(rest)} von ${zahlText(anspruch)} Tagen übrig</p>
        <div class="fortschritt" aria-hidden="true"><i style="width: ${pr(restAnteil * 100)}%"></i></div>
      </section>

      <section class="karte karte-link" aria-labelledby="k-monat">
        <h2 id="k-monat"><a class="karte-ziel" href="#monat">Monat</a></h2>
        <p class="zahl">${monatsname(monatNr)} bisher ${dauer(m.summeIst)}</p>
        <div class="karte-aktion">
          <a class="knopf knopf-karte" href="#monat">Monat ansehen</a>
        </div>
      </section>

      ${kontext.laptop ? '<div class="vorschlaege-platz" data-vorschlaege></div>' : ''}
      ${hinweisListe.length > 0 ? karteHinweise(hinweisListe) : ''}
    </div>`;

  // Abgleich-Etikett anbinden (Klick und Aktualisierung bei 'abgleich-status')
  abgleichEtikettAnbinden(ziel.querySelector('[data-abgleich]'), kontext);

  // Karten oben: vergessenes Ausstempeln und mehrere laufende Blöcke
  kartenZeichnen(ziel.querySelector('[data-heute-karten]'), bloecke, heute, kontext);

  // Stempeln: während des Aufrufs alle Stempelknöpfe sperren.
  const stempelKnoepfe = [...ziel.querySelectorAll('[data-stempel]')];
  for (const knopf of stempelKnoepfe) {
    knopf.addEventListener('click', async () => {
      stempelKnoepfe.forEach((k) => { k.disabled = true; });
      try {
        await stempeln(knopf.dataset.stempel);
      } finally {
        stempelKnoepfe.forEach((k) => { k.disabled = false; });
      }
    });
  }

  // Andere Uhrzeit: Sheet mit Zeitfeld, Schnellwahl und Stempeln.
  ziel.querySelector('[data-andere-uhrzeit]').addEventListener('click', () => andereUhrzeitOeffnen(kontext, info.zustand));

  // Tagesverlauf: Klick öffnet den Tag im Sheet.
  const zeitleiste = ziel.querySelector('[data-tag]');
  if (zeitleiste) {
    zeitleiste.addEventListener('click', () => tagOeffnen(heute, kontext));
  }

  // Karten Hinweise und Wochentage: öffnen den Tag im Sheet.
  ziel.querySelector('[data-tag-heute]')?.addEventListener('click', () => tagOeffnen(heute, kontext));
  ziel.querySelectorAll('[data-tag-datum]').forEach((knopf) => {
    knopf.addEventListener('click', () => tagOeffnen(knopf.dataset.tagDatum, kontext));
  });

  // Vorschläge nachladen, ohne die Ansicht zu bremsen (nur am Laptop)
  const platz = ziel.querySelector('[data-vorschlaege]');
  if (platz) vorschlaegeLaden(platz, kontext);
}
