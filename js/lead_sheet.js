// Lead zu einem Kontakt erfassen und bearbeiten: ein Sheet mit Gruppen wie das Papierformular.
// Der Lead hängt am Kontakt (k.lead); gesichert wird am aktuellen Stand des Kontakts.
import { alle, speichern } from './speicher.js';
import { kontaktName } from './kontakte.js';
import { datumText } from './zeit.js';
// Namensraum statt benannter Importe: fehlt eine Funktion, bricht so nicht das ganze Modul
import * as lead from './lead.js';

const SONSTIGES = 'Sonstiges';
const SPEICHERN_FEHLER = 'Speichern hat nicht geklappt. Bitte noch einmal versuchen.';

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Gruppe mit Überschrift (fieldset), Inhalt untereinander
function gruppe(titel, inhalt) {
  const fs = el('fieldset', 'kontakt-gruppe');
  fs.append(el('legend', 'kontakt-legende', titel), ...inhalt);
  return fs;
}

// Feld mit Beschriftung. steuer hat schon seine id.
function feld(name, steuer) {
  const box = el('div', 'feld');
  const label = el('label', null, name);
  label.htmlFor = steuer.id;
  box.append(label, steuer);
  return box;
}

// Textfeld mit id lead-<key>; liefert Kasten (box) und Eingabe (input)
function textFeld(key, name, wert, platz = '') {
  const input = document.createElement('input');
  input.type = 'text';
  input.id = `lead-${key}`;
  input.name = key;
  input.value = wert ?? '';
  input.autocomplete = 'off';
  if (platz) input.placeholder = platz;
  return { box: feld(name, input), input };
}

// Überschrift über Umschaltknöpfen oder Segment ohne eigenes Label
function feldName(text) {
  return el('p', 'lead-feldname', text);
}

// Einzelwahl als Segment: nochmal tippen hebt die Wahl auf. Liefert Element und Wert.
function segment(name, optionen, wert, aendern) {
  let aktuell = wert ?? '';
  const huelle = el('div', 'segment lead-segment');
  huelle.setAttribute('role', 'group');
  huelle.setAttribute('aria-label', name);
  const teile = optionen.map(([v, text]) => {
    const knopf = el('button', 'segment-teil');
    knopf.type = 'button';
    knopf.append(el('span', null, text));
    knopf.addEventListener('click', () => {
      aktuell = aktuell === v ? '' : v;
      zeichnen();
      aendern();
    });
    return { v, knopf };
  });
  const zeichnen = () => {
    for (const { v, knopf } of teile) knopf.setAttribute('aria-pressed', String(aktuell === v));
  };
  zeichnen();
  huelle.append(...teile.map((t) => t.knopf));
  return { huelle, wert: () => aktuell };
}

// Mehrfachwahl als Umschaltknöpfe. aendern bekommt die gewählten Texte.
function umschalter(name, optionen, gewaehlt, aendern) {
  const aktiv = new Set(gewaehlt ?? []);
  const werte = () => optionen.filter((o) => aktiv.has(o));
  const huelle = el('div', 'lead-wahl');
  huelle.setAttribute('role', 'group');
  huelle.setAttribute('aria-label', name);
  const knoepfe = optionen.map((text) => {
    const knopf = el('button', 'lead-umschalter', text);
    knopf.type = 'button';
    knopf.setAttribute('aria-pressed', String(aktiv.has(text)));
    knopf.addEventListener('click', () => {
      if (aktiv.has(text)) aktiv.delete(text);
      else aktiv.add(text);
      knopf.setAttribute('aria-pressed', String(aktiv.has(text)));
      aendern(werte());
    });
    return knopf;
  });
  huelle.append(...knoepfe);
  return { huelle, werte };
}

// Erfassungstag als YYYY-MM-DD in Ortszeit: aus dem Anlegen des Kontakts, sonst heute
function erfassungstag(kontakt, kontext) {
  if (kontakt.erstellt) return datumText(new Date(kontakt.erstellt));
  return kontext.heute;
}

// Lead-Sheet öffnen. kontakt ist der gespeicherte Kontakt (mit id); kontext liefert sheet und heute.
export async function leadBearbeiten(kontakt, kontext) {
  const bestand = kontakt.lead ?? {};
  const datumWert = bestand.datum || erfassungstag(kontakt, kontext);

  // Anlass ist leer: Vorschlag aus einer Reise an diesem Tag
  let anlassWert = bestand.anlass || '';
  if (!anlassWert) {
    try {
      anlassWert = lead.anlassVorschlag(datumWert, await alle('reisen')) || '';
    } catch (e) {
      console.warn('Reisen nicht geladen', e?.message);
    }
  }

  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'formular-stapel kontakt-form lead-form';
  // Jede Eingabe, auch über Knöpfe, zählt als ungesicherte Änderung (das Sheet hört auf input)
  const markieren = () => form.dispatchEvent(new Event('input', { bubbles: true }));

  const untertitel = el('p', 'notiz lead-untertitel', kontaktName(kontakt));

  // Erfassung
  const anlass = textFeld('anlass', 'Anlass', anlassWert, 'Messe, Kundenbesuch …');
  const datum = document.createElement('input');
  datum.type = 'date';
  datum.id = 'lead-datum';
  datum.name = 'datum';
  datum.autocomplete = 'off';
  datum.value = datumWert;
  const erfassungGruppe = gruppe('Erfassung', [anlass.box, feld('Datum', datum)]);

  // Kunde
  const branche = textFeld('branche', 'Branche und Produkte', bestand.branche);
  const kundeGruppe = gruppe('Kunde', [branche.box]);

  // Anfrage
  const sonst = textFeld('interesseSonst', 'Sonstiges, genauer', bestand.interesseSonst);
  sonst.box.hidden = !(bestand.interesse ?? []).includes(SONSTIGES);
  const interesse = umschalter('Interesse an', lead.LEAD_INTERESSE, bestand.interesse, (werte) => {
    sonst.box.hidden = !werte.includes(SONSTIGES);
    markieren();
  });

  const maschine = textFeld('maschine', 'Angefragte Maschine', bestand.maschine, 'Kutter, Wolf …');
  const maschinenListe = document.createElement('datalist');
  maschinenListe.id = 'lead-maschinen';
  maschinenListe.append(...lead.LEAD_MASCHINEN.map((m) => new Option(m, m)));
  maschine.input.setAttribute('list', maschinenListe.id);
  const leistung = textFeld('leistung', 'Schüsselinhalt oder Leistung', bestand.leistung);
  const menge = textFeld('menge', 'Menge pro Tag', bestand.menge);
  const anwendung = textFeld('anwendung', 'Produkt und Anwendung', bestand.anwendung);

  const fabrikat = textFeld('fabrikat', 'Fabrikat und Modell', bestand.fabrikat);
  fabrikat.box.hidden = bestand.bestehend !== 'ja';
  const bestehend = segment('Bestehende Maschine', [['ja', 'Ja'], ['nein', 'Nein']], bestand.bestehend, () => {
    fabrikat.box.hidden = bestehend.wert() !== 'ja';
    markieren();
  });
  const bestehendBlock = el('div', 'lead-block');
  bestehendBlock.append(feldName('Bestehende Maschine'), bestehend.huelle, fabrikat.box);

  const budget = textFeld('budget', 'Geschätztes Budget', bestand.budget, 'z. B. 20.000 €');
  const anfrageGruppe = gruppe('Anfrage', [
    feldName('Interesse an'),
    interesse.huelle,
    sonst.box,
    maschine.box,
    maschinenListe,
    leistung.box,
    menge.box,
    anwendung.box,
    bestehendBlock,
    budget.box,
  ]);

  // Bewertung
  const prio = segment(
    'Priorität',
    lead.LEAD_PRIORITAET.map((p) => [p.wert, `${p.wert} ${p.text}`]),
    bestand.prioritaet,
    markieren,
  );
  const schritte = umschalter('Nächste Schritte', lead.LEAD_SCHRITTE, bestand.schritte, markieren);
  const bewertungGruppe = gruppe('Bewertung', [
    feldName('Priorität'),
    prio.huelle,
    feldName('Nächste Schritte'),
    schritte.huelle,
  ]);

  // Notizen: Einwilligung. Die Kontaktnotiz steht im Kontaktformular.
  const einwilligung = segment(
    'Einwilligung zur Kontaktaufnahme',
    [['ja', 'Ja'], ['nein', 'Nein']],
    bestand.einwilligung,
    markieren,
  );
  const notizenGruppe = gruppe('Notizen', [feldName('Einwilligung zur Kontaktaufnahme'), einwilligung.huelle]);

  const gesamtFehler = el('p', 'fehler kontakt-gesamt');
  gesamtFehler.setAttribute('role', 'alert');
  gesamtFehler.hidden = true;

  const abbrechenKnopf = el('button', 'knopf', 'Abbrechen');
  abbrechenKnopf.type = 'button';
  abbrechenKnopf.addEventListener('click', () => kontext.sheet.schliessen());
  const sichernKnopf = el('button', 'knopf haupt', 'Sichern');
  sichernKnopf.type = 'submit';
  const fuss = el('div', 'kontakt-fuss');
  fuss.append(abbrechenKnopf, sichernKnopf);

  let beschaeftigt = false;

  async function absenden() {
    if (beschaeftigt) return;
    gesamtFehler.hidden = true;
    gesamtFehler.textContent = '';
    const v = (eingabe) => eingabe.value.trim();
    const gewaehlt = interesse.werte();

    const neu = {
      anlass: v(anlass.input),
      datum: datum.value,
      branche: v(branche.input),
      interesse: gewaehlt,
      interesseSonst: gewaehlt.includes(SONSTIGES) ? v(sonst.input) : '',
      maschine: v(maschine.input),
      leistung: v(leistung.input),
      menge: v(menge.input),
      anwendung: v(anwendung.input),
      bestehend: bestehend.wert(),
      fabrikat: bestehend.wert() === 'ja' ? v(fabrikat.input) : '',
      budget: v(budget.input),
      prioritaet: prio.wert(),
      schritte: schritte.werte(),
      einwilligung: einwilligung.wert(),
    };

    beschaeftigt = true;
    sichernKnopf.disabled = true;
    try {
      // Der aktuelle Stand des Kontakts, falls er inzwischen geändert wurde
      const liste = await alle('kontakte');
      const frisch = liste.find((x) => x.id === kontakt.id) ?? kontakt;
      if (frisch.geloescht) {
        gesamtFehler.textContent = 'Dieser Kontakt ist gelöscht.';
        gesamtFehler.hidden = false;
        return;
      }
      // Outlook: wie beim Sichern im Kontaktformular, der bisherige Status merkt sich in vorher
      const alt = kontakt.outlook ?? {};
      const vorher = alt.status === 'offen' ? (alt.vorher ?? '') : (alt.status ?? '');
      await speichern('kontakte', {
        ...frisch,
        lead: neu,
        outlook: { ...alt, status: 'offen', vorher, entryId: alt.entryId ?? '' },
      });
      kontext.sheet.schliessen();
    } catch (e) {
      console.error(e);
      gesamtFehler.textContent = SPEICHERN_FEHLER;
      gesamtFehler.hidden = false;
    } finally {
      beschaeftigt = false;
      sichernKnopf.disabled = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    absenden();
  });

  form.replaceChildren(
    untertitel,
    erfassungGruppe,
    kundeGruppe,
    anfrageGruppe,
    bewertungGruppe,
    notizenGruppe,
    gesamtFehler,
    fuss,
  );

  kontext.sheet.oeffnen('Lead', form);
  return form;
}
