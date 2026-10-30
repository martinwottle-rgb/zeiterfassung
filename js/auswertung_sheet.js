// Messe auswerten: Kontakte eines Zeitraums (Dienstreise oder Datum von bis) als Paket für einen Claude-Chat
// zusammenstellen, die Antwort einlesen und am Kontakt speichern. Jeder Lauf wird in den Einstellungen festgehalten.
import { alle, einstellungenLaden, einstellungenSpeichern, speichern } from './speicher.js';
import { reisenGruppieren } from './reisen.js';
import { kontaktName } from './kontakte.js';
import { addTage, datumText } from './zeit.js';
// Namensraum statt benannter Importe: fehlt eine Funktion, bricht so nicht das ganze Modul
import * as lead from './lead.js';

const SPEICHERN_FEHLER = 'Speichern hat nicht geklappt. Bitte noch einmal versuchen.';
const VORLAGEN_FEHLEN = 'Die Vorlagen für Claude fehlen. Öffne die App einmal am Laptop, dann kommen sie über den Abgleich.';
const CLAUDE_HINWEIS = 'Kopiere das Paket in einen neuen Claude-Chat. Wenn Claude fertig ist, kopierst du die ganze Antwort und liest sie hier ein.';

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Feld mit Beschriftung. steuer hat schon seine id.
function feld(name, steuer) {
  const box = el('div', 'feld');
  const label = el('label', null, name);
  label.htmlFor = steuer.id;
  box.append(label, steuer);
  return box;
}

// Einzelwahl als Segment (ohne Abwählen). optionen: [wert, text, deaktiviert?]
function segment(optionen, vorwahl, aendern) {
  let aktuell = vorwahl;
  const huelle = el('div', 'segment auswertung-segment');
  huelle.setAttribute('role', 'group');
  huelle.setAttribute('aria-label', 'Auswahl');
  const teile = optionen.map(([wert, text, aus]) => {
    const knopf = el('button', 'segment-teil');
    knopf.type = 'button';
    knopf.disabled = Boolean(aus);
    knopf.append(el('span', null, text));
    knopf.addEventListener('click', () => {
      aktuell = wert;
      zeichnen();
      aendern();
    });
    return { wert, knopf };
  });
  const zeichnen = () => {
    for (const { wert, knopf } of teile) knopf.setAttribute('aria-pressed', String(aktuell === wert));
  };
  zeichnen();
  huelle.append(...teile.map((t) => t.knopf));
  return { huelle, wert: () => aktuell };
}

// 'YYYY-MM-DD' wird zu 'TT.MM.JJJJ'
function datumDe(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

// 'YYYY-MM-DD' wird zu 'TT.MM.'
function datumKurz(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.` : '';
}

// Text einer Dienstreise: „Anlass, TT.MM. bis TT.MM.JJJJ“
function reiseText(g) {
  return `${g.anlass || 'Reise'}, ${datumKurz(g.von)} bis ${datumDe(g.bis)}`;
}

// Kontakte, die im Zeitraum angelegt wurden (Ortszeit, einschließlich), optional nur mit Lead-Daten
function imZeitraum(kontakte, von, bis, nurLead) {
  return kontakte.filter((k) => {
    if (k.geloescht || !(k.erstellt > 0)) return false;
    const tag = datumText(new Date(k.erstellt));
    if (tag < von || tag > bis) return false;
    return !nurLead || !lead.leadLeer(k.lead);
  });
}

// Kontakt steht in der Liste, wenn er auswertbar ist oder bewusst ausgeschlossen wurde (Lieferant, damit er wieder angehakt werden kann).
// Die eigene Firma steht nicht in der Liste.
function listeSichtbar(k) {
  return k.auswertungAus === true || Boolean(lead.auswertbar(k));
}

// Bezeichnung in der Liste: „Firma · Name“, ohne Firma nur der Name
function bezeichnung(k) {
  return [String(k.firma ?? '').trim(), kontaktName(k)].filter(Boolean).join(' · ');
}

// Anzahl eindeutiger Firmen; Kontakte ohne Firma zählen je einzeln
function firmenZahl(liste) {
  const namen = new Set();
  for (const k of liste) {
    const firma = String(k.firma ?? '').trim().toLowerCase();
    namen.add(firma || `#${k.id}`);
  }
  return namen.size;
}

// Text in die Zwischenablage. true, wenn es geklappt hat.
export async function textKopieren(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Sheet mit dem Paket: Hinweis, Vorschau, Kopieren und Einlesen
function paketAnzeigen(lauf, kontext) {
  const huelle = el('div', 'auswertung-form');
  const hinweis = el('p', 'notiz auswertung-hinweis', CLAUDE_HINWEIS);
  const vorschau = el('pre', 'auswertung-vorschau', lauf.text ?? '');
  vorschau.tabIndex = 0;

  const kopierKnopf = el('button', 'knopf', 'Paket kopieren');
  kopierKnopf.type = 'button';
  kopierKnopf.addEventListener('click', async () => {
    const ok = await textKopieren(lauf.text ?? '');
    kopierKnopf.textContent = ok ? 'Kopiert' : 'Kopieren hat nicht geklappt';
  });

  const einlesenKnopf = el('button', 'knopf haupt', 'Ergebnis einlesen');
  einlesenKnopf.type = 'button';
  einlesenKnopf.addEventListener('click', () => ergebnisEinlesen(lauf, kontext));

  const fuss = el('div', 'auswertung-fuss');
  fuss.append(kopierKnopf, einlesenKnopf);
  huelle.append(hinweis, vorschau, fuss);
  kontext.sheet.oeffnen('Messe auswerten', huelle, { ohneRueckfrage: true });
}

// Startet das Sheet „Messe auswerten“
export async function auswertungStarten(kontext) {
  const heute = kontext.heute || datumText(new Date());
  let gruppen = [];
  let kontakte = [];
  let vorlagenDa = false;
  try {
    gruppen = reisenGruppieren(await alle('reisen')).sort((a, b) => (a.von < b.von ? 1 : a.von > b.von ? -1 : 0));
    kontakte = (await alle('kontakte')).filter((k) => !k.geloescht);
    const einst = await einstellungenLaden();
    vorlagenDa = Boolean(einst.claudeVorlagen?.auftrag);
  } catch (e) {
    console.error(e);
    kontext.sheet.oeffnen('Messe auswerten', el('p', 'notiz fehler', 'Die Daten konnten nicht geladen werden. Bitte noch einmal versuchen.'));
    return;
  }

  // Häkchen je Kontakt (Schlüssel: Id). Anfangszustand: auswertbar
  const haken = new Map(kontakte.map((k) => [String(k.id), Boolean(lead.auswertbar(k))]));

  let modus = gruppen.length ? 'reise' : 'zeitraum';
  let beschaeftigt = false;
  const form = el('form', 'auswertung-form');
  form.noValidate = true;

  // Modus: Dienstreise oder Zeitraum
  const modusWahl = segment(
    [['reise', 'Dienstreise', gruppen.length === 0], ['zeitraum', 'Zeitraum']],
    modus,
    () => {
      modus = modusWahl.wert();
      panelAktualisieren();
      zeitraumGeaendert();
    },
  );

  // Dienstreise: Auswahl, neueste zuerst
  const reiseSelect = document.createElement('select');
  reiseSelect.id = 'auswertung-reise';
  reiseSelect.name = 'reise';
  gruppen.forEach((g, i) => reiseSelect.append(new Option(reiseText(g), String(i))));
  const reisePanel = el('div', 'auswertung-panel');
  reisePanel.append(feld('Dienstreise', reiseSelect));

  // Zeitraum: Von und Bis, Vorgabe die letzten sieben Tage
  const vonEingabe = document.createElement('input');
  vonEingabe.type = 'date';
  vonEingabe.id = 'auswertung-von';
  vonEingabe.name = 'von';
  vonEingabe.value = addTage(heute, -6);
  const bisEingabe = document.createElement('input');
  bisEingabe.type = 'date';
  bisEingabe.id = 'auswertung-bis';
  bisEingabe.name = 'bis';
  bisEingabe.value = heute;
  const zeitPanel = el('div', 'auswertung-panel auswertung-zeitraum');
  zeitPanel.append(feld('Von', vonEingabe), feld('Bis', bisEingabe));

  // Anlass, vorbelegt mit dem Anlass der Dienstreise
  const anlassEingabe = document.createElement('input');
  anlassEingabe.type = 'text';
  anlassEingabe.id = 'auswertung-anlass';
  anlassEingabe.name = 'anlass';
  anlassEingabe.autocomplete = 'off';
  anlassEingabe.placeholder = 'Messe, Kundenbesuch …';
  if (gruppen.length && modus === 'reise') anlassEingabe.value = gruppen[0].anlass || '';

  // Schalter: nur Kontakte mit Lead-Daten
  const nurLead = document.createElement('input');
  nurLead.type = 'checkbox';
  nurLead.id = 'auswertung-nur-lead';
  nurLead.name = 'nurLead';
  nurLead.setAttribute('role', 'switch');
  const schalter = el('label', 'auswertung-schalter');
  schalter.append(nurLead, el('span', null, 'Nur Kontakte mit Lead-Daten'));

  const zaehler = el('p', 'notiz zahl auswertung-zaehler');
  zaehler.setAttribute('role', 'status');
  // Liste der Kontakte mit Häkchen unter dem Zähler
  const listeBox = el('div', 'auswertung-haken-liste');
  listeBox.setAttribute('role', 'group');
  listeBox.setAttribute('aria-label', 'Kontakte für das Paket');

  const zeitHinweis = el('p', 'notiz fehler', 'Das Datum Bis liegt vor dem Datum Von.');
  zeitHinweis.hidden = true;
  const vorlagenHinweis = el('p', 'notiz auswertung-hinweis', VORLAGEN_FEHLEN);
  vorlagenHinweis.hidden = vorlagenDa;
  const fehlerText = el('p', 'notiz fehler');
  fehlerText.setAttribute('role', 'alert');
  fehlerText.hidden = true;

  const paketKnopf = el('button', 'knopf haupt', 'Paket erstellen');
  paketKnopf.type = 'button';
  const fuss = el('div', 'auswertung-fuss');
  fuss.append(paketKnopf);

  // Zeitraum aus der Auswahl: Dienstreise oder die Datumsfelder
  function zeitraum() {
    if (modus === 'reise') {
      const g = gruppen[Number(reiseSelect.value)];
      return g ? { von: g.von, bis: g.bis } : null;
    }
    return { von: vonEingabe.value, bis: bisEingabe.value };
  }

  // Kontakte der Liste: im Zeitraum (mit Schalter), ohne die eigene Firma; bei ungültigem Zeitraum keine
  function anzeige() {
    const z = zeitraum();
    if (!z || !z.von || !z.bis || z.von > z.bis) return [];
    return imZeitraum(kontakte, z.von, z.bis, nurLead.checked).filter(listeSichtbar);
  }

  // Angehakte Kontakte der Liste: kommen ins Paket
  function treffer() {
    return anzeige().filter((k) => haken.get(String(k.id)) === true);
  }

  // Eine Zeile mit Häkchen und „Firma · Name“
  function hakenZeile(k) {
    const id = String(k.id);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.name = 'kontakt';
    box.value = id;
    box.checked = haken.get(id) === true;
    box.addEventListener('change', () => hakenAendern(k, box));
    const label = el('label', 'auswertung-haken');
    label.append(box, el('span', null, bezeichnung(k)));
    return label;
  }

  // Liste neu aufbauen, wenn sich Zeitraum oder Schalter ändern
  function listeNeuZeichnen() {
    const liste = [...anzeige()].sort((a, b) => bezeichnung(a).localeCompare(bezeichnung(b), 'de'));
    if (liste.length === 0) {
      listeBox.replaceChildren(el('p', 'notiz', 'Keine Kontakte in diesem Zeitraum.'));
      return;
    }
    listeBox.replaceChildren(...liste.map(hakenZeile));
  }

  // Ein Häkchen geändert: am Kontakt merken, damit Lieferanten künftig draußen bleiben
  async function hakenAendern(k, box) {
    const id = String(k.id);
    const neu = box.checked;
    haken.set(id, neu);
    aktualisieren();
    try {
      // Frisch laden, damit Änderungen seit dem Öffnen nicht überschrieben werden
      const frisch = (await alle('kontakte')).find((x) => String(x.id) === id) ?? k;
      await speichern('kontakte', { ...frisch, auswertungAus: !neu });
      k.auswertungAus = !neu;
    } catch (e) {
      console.error(e);
      box.checked = !neu;
      haken.set(id, !neu);
      aktualisieren();
      fehlerText.textContent = SPEICHERN_FEHLER;
      fehlerText.hidden = false;
    }
  }

  // Zeitraum oder Schalter haben sich geändert: Liste neu und Zähler aktualisieren
  function zeitraumGeaendert() {
    listeNeuZeichnen();
    aktualisieren();
  }

  // Zähler, Hinweis zum Zeitraum und Freigabe des Pakets
  function aktualisieren() {
    const z = zeitraum();
    const falsch = Boolean(z && z.von && z.bis && z.von > z.bis);
    zeitHinweis.hidden = !falsch;
    const liste = treffer();
    const n = liste.length;
    const firmen = firmenZahl(liste);
    zaehler.textContent = `${n} ${n === 1 ? 'Kontakt' : 'Kontakte'}, ${firmen} ${firmen === 1 ? 'Firma' : 'Firmen'} im Paket`;
    paketKnopf.disabled = n === 0 || !vorlagenDa || beschaeftigt;
  }

  function panelAktualisieren() {
    reisePanel.hidden = modus !== 'reise';
    zeitPanel.hidden = modus !== 'zeitraum';
  }

  reiseSelect.addEventListener('change', () => {
    const g = gruppen[Number(reiseSelect.value)];
    anlassEingabe.value = g?.anlass || '';
    zeitraumGeaendert();
  });
  for (const e of [vonEingabe, bisEingabe]) {
    e.addEventListener('input', zeitraumGeaendert);
    e.addEventListener('change', zeitraumGeaendert);
  }
  nurLead.addEventListener('change', zeitraumGeaendert);

  // Paket bauen, als Lauf speichern und im selben Sheet anzeigen
  async function paketErstellen() {
    if (beschaeftigt) return;
    const z = zeitraum();
    const liste = treffer();
    if (!z || liste.length === 0) return;
    fehlerText.hidden = true;
    beschaeftigt = true;
    paketKnopf.disabled = true;
    try {
      const einst = await einstellungenLaden();
      if (!einst.claudeVorlagen?.auftrag) {
        vorlagenHinweis.hidden = false;
        return;
      }
      const anlass = anlassEingabe.value.trim();
      const { text, nummern, gruppen: paketGruppen } = lead.paketBauen({ anlass, kontakte: liste, vorlagen: einst.claudeVorlagen });
      const lauf = {
        id: crypto.randomUUID(),
        anlass,
        von: z.von,
        bis: z.bis,
        erstellt: Date.now(),
        nummern,
        gruppen: paketGruppen,
        text,
        eingelesen: null,
      };
      await einstellungenSpeichern({ ...einst, auswertungen: [lauf, ...(einst.auswertungen ?? [])] });
      paketAnzeigen(lauf, kontext);
    } catch (e) {
      console.error(e);
      fehlerText.textContent = SPEICHERN_FEHLER;
      fehlerText.hidden = false;
    } finally {
      beschaeftigt = false;
      aktualisieren();
    }
  }
  paketKnopf.addEventListener('click', paketErstellen);

  form.append(
    el('p', 'auswertung-feldname', 'Zeitraum'),
    modusWahl.huelle,
    reisePanel,
    zeitPanel,
    feld('Anlass', anlassEingabe),
    schalter,
    zaehler,
    listeBox,
    zeitHinweis,
    vorlagenHinweis,
    fehlerText,
    fuss,
  );

  panelAktualisieren();
  listeNeuZeichnen();
  aktualisieren();
  kontext.sheet.oeffnen('Messe auswerten', form, { ohneRueckfrage: true });
}

// Antwort von Claude einlesen: Einträge am Kontakt speichern, Lauf als eingelesen markieren
export function ergebnisEinlesen(lauf, kontext) {
  let beschaeftigt = false;
  const form = el('form', 'auswertung-form');
  form.noValidate = true;

  const antwort = document.createElement('textarea');
  antwort.id = 'auswertung-antwort';
  antwort.name = 'antwort';
  antwort.rows = 12;
  antwort.spellcheck = true;
  antwort.lang = 'de-DE';
  const antwortFeld = feld('Antwort von Claude hier einfügen', antwort);

  const meldung = el('p', 'notiz auswertung-meldung');
  meldung.setAttribute('role', 'status');
  meldung.hidden = true;
  const fehlerListe = el('ul', 'auswertung-fehlerliste');
  fehlerListe.hidden = true;

  const einlesenKnopf = el('button', 'knopf haupt', 'Einlesen');
  einlesenKnopf.type = 'submit';
  const weiterKnopf = el('button', 'knopf haupt', 'Prioritätenliste öffnen');
  weiterKnopf.type = 'button';
  weiterKnopf.hidden = true;
  const fuss = el('div', 'auswertung-fuss');
  fuss.append(einlesenKnopf, weiterKnopf);

  function meldungZeigen(text, fehler) {
    meldung.textContent = text;
    meldung.hidden = false;
    fehlerListe.replaceChildren(...fehler.map((f) => el('li', null, f)));
    fehlerListe.hidden = fehler.length === 0;
  }

  async function einlesen() {
    if (beschaeftigt) return;
    beschaeftigt = true;
    einlesenKnopf.disabled = true;
    weiterKnopf.hidden = true;
    try {
      const ergebnis = lead.ergebnisLesen(antwort.value, lauf.nummern, lauf.gruppen);
      const eintraege = ergebnis?.eintraege ?? [];
      const fehler = [...(ergebnis?.fehler ?? [])];
      if (eintraege.length === 0) {
        meldungZeigen('0 Einträge eingelesen', fehler);
        return;
      }

      let gespeichert = 0;
      for (const eintrag of eintraege) {
        const { kontaktId, kontaktIds, ...rest } = eintrag;
        // Ein Eintrag gilt für alle Kontakte seiner Firma; ohne Liste nur für kontaktId
        const ids = Array.isArray(kontaktIds) && kontaktIds.length ? kontaktIds : [kontaktId];
        let ok = 0;
        for (const id of ids) {
          // Je Kontakt frisch laden, damit Änderungen seit dem Öffnen nicht überschrieben werden
          const kontakte = await alle('kontakte');
          const k = kontakte.find((x) => String(x.id) === String(id));
          if (!k || k.geloescht) {
            fehler.push(`Kontakt zu ${eintrag.nr} nicht gefunden.`);
            continue;
          }
          await speichern('kontakte', {
            ...k,
            auswertung: { ...rest, laufId: lauf.id, eingelesen: Date.now() },
          });
          ok += 1;
        }
        if (ok > 0) gespeichert += 1;
      }

      if (gespeichert > 0) {
        const einst = await einstellungenLaden();
        const stand = Date.now();
        const auswertungen = (einst.auswertungen ?? []).map((l) => (l.id === lauf.id ? { ...l, eingelesen: stand } : l));
        await einstellungenSpeichern({ ...einst, auswertungen });
        lauf.eingelesen = stand;
        weiterKnopf.hidden = false;
      }
      meldungZeigen(`${gespeichert} ${gespeichert === 1 ? 'Eintrag' : 'Einträge'} eingelesen`, fehler);
    } catch (e) {
      console.error(e);
      meldungZeigen(SPEICHERN_FEHLER, []);
    } finally {
      beschaeftigt = false;
      einlesenKnopf.disabled = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    einlesen();
  });

  weiterKnopf.addEventListener('click', () => {
    const ziel = '#auswertung/' + lauf.id;
    // Gleiche Ansicht: neu zeichnen, sonst wechselt die Route
    if (location.hash === ziel && kontext.neuZeichnen) kontext.neuZeichnen();
    else location.hash = ziel;
    kontext.sheet.schliessen();
  });

  form.append(antwortFeld, meldung, fehlerListe, fuss);
  kontext.sheet.oeffnen('Ergebnis einlesen', form, { ohneRueckfrage: true });
  return form;
}

// Pakettext des Laufs erneut in die Zwischenablage. Klappt das nicht, steht der Text im Sheet zum Kopieren.
export async function paketErneutKopieren(lauf, kontext) {
  if (!lauf?.text) {
    kontext.sheet.oeffnen('Paket kopieren', el('p', 'notiz auswertung-hinweis',
      'Dieses Paket ist nicht mehr gespeichert. Starte eine neue Auswertung.'));
    return false;
  }
  if (await textKopieren(lauf.text)) return true;

  const huelle = el('div', 'auswertung-form');
  const hinweis = el('p', 'notiz auswertung-hinweis',
    'Kopieren hat nicht geklappt. Markiere den Text unten und kopiere ihn von Hand.');
  const vorschau = el('pre', 'auswertung-vorschau', lauf.text);
  vorschau.tabIndex = 0;
  huelle.append(hinweis, vorschau);
  kontext.sheet.oeffnen('Paket kopieren', huelle, { ohneRueckfrage: true });
  return false;
}
