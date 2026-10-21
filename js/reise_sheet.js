// Dienstreise eintragen (Sheet): mehrtägige Reise als Reisetage speichern, mit Vorschau der Verpflegung.
// Dazu gemeinsame Helfer für tag_sheet.js und ansicht_monat.js: Euro, Länderliste, Betragsprüfung, Feldfehler.
import { alle, speichern } from './speicher.js';
import { LAENDER } from './laender.js';
import { reiseTageErzeugen, verpflegung } from './reisen.js';
import { minutenAusUhrzeit, uhrzeit, wochentag } from './zeit.js';

const KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const EURO = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Betrag mit zwei Nachkommastellen und Komma: „26,40 €“
export function euro(betrag) {
  return `${EURO.format(betrag ?? 0)} €`;
}

// „Di 28.07.“ aus JJJJ-MM-TT
export function kurzesDatum(datum) {
  const [, m, t] = datum.split('-');
  return `${KURZ[wochentag(datum)]} ${t}.${m}.`;
}

// „28.07.2026“ aus JJJJ-MM-TT
function langesDatumDe(datum) {
  const [j, m, t] = datum.split('-');
  return `${t}.${m}.${j}`;
}

// Land für die Anzeige: Zeilenumbrüche und Mehrfach-Leerzeichen werden zu einem Leerzeichen.
export function landAnzeige(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

const NACH_NAME = new Map(LAENDER.map((l) => [landAnzeige(l.name), l.name]));

// Eingabe zum exakten Namen aus LAENDER (so wie er in der Excel-Vorlage steht), sonst null.
export function landAusEingabe(text) {
  return NACH_NAME.get(landAnzeige(text)) ?? null;
}

// Datalist mit allen Ländern, Anzeige ohne Zeilenumbrüche
export function landListe(id) {
  const liste = document.createElement('datalist');
  liste.id = id;
  for (const l of LAENDER) {
    const o = document.createElement('option');
    o.value = landAnzeige(l.name);
    liste.append(o);
  }
  return liste;
}

// Betrag aus Text: leer ist 0; Komma oder Punkt, höchstens zwei Nachkommastellen. Sonst NaN.
export function betragAusText(text) {
  const t = String(text ?? '').replace(/€/g, '').replace(/\s/g, '');
  if (t === '') return 0;
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t.replace(',', '.')) * 100) / 100;
}

// Fehlertext unter einem Feld, aria-invalid am Eingabefeld. Leerer Text löscht den Fehler.
export function feldFehler(f, text) {
  f.fehler.textContent = text ?? '';
  f.fehler.hidden = !text;
  if (text) f.input.setAttribute('aria-invalid', 'true');
  else f.input.removeAttribute('aria-invalid');
}

// Textfeld oder Zeit- und Datumsfeld mit sichtbarer Beschriftung und Fehlerzeile
export function reiseFeld(id, name, typ, wert = '') {
  const box = document.createElement('div');
  box.className = 'feld';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = name;
  const input = document.createElement('input');
  input.type = typ;
  input.id = id;
  input.name = id;
  input.value = wert;
  const fehler = document.createElement('p');
  fehler.className = 'notiz fehler';
  fehler.id = `${id}-fehler`;
  fehler.hidden = true;
  input.setAttribute('aria-describedby', fehler.id);
  box.append(label, input, fehler);
  return { box, label, input, fehler };
}

// Schalter im iOS-Stil mit Beschriftung links
export function reiseSchalter(id, text, an = false) {
  const box = document.createElement('div');
  box.className = 'reise-schalter';
  const name = document.createElement('span');
  name.className = 'liste-titel';
  name.id = `${id}-name`;
  name.textContent = text;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.id = id;
  input.name = id;
  input.checked = an;
  input.setAttribute('aria-labelledby', name.id);
  box.append(name, input);
  return { box, input };
}

// Eingabe-Vorgabe für Zeitfelder: 1440 (24:00) bleibt leer, sonst HH:MM
function zeitWert(min) {
  if (min === 1440) return '';
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// Tage der Reise aus den Feldern des Sheets (Vorschau und Sichern). Leer, solange Angaben fehlen.
function tageAusFeldern(f) {
  const von = f.von.input.value;
  const bis = f.bis.input.value;
  const beginn = minutenAusUhrzeit(f.abfahrt.input.value);
  const ende = minutenAusUhrzeit(f.rueck.input.value);
  if (!von || !bis || bis < von || beginn === null || ende === null) return [];
  const land = landAusEingabe(f.land.input.value) ?? landAnzeige(f.land.input.value);
  return reiseTageErzeugen({
    von,
    bis,
    beginn,
    ende,
    land,
    anlass: f.anlass.input.value.trim(),
    zusatz: f.zusatz.input.value.trim(),
    hotelFruehstueck: von !== bis && f.fruehstueck.input.checked,
  });
}

// Sheet „Dienstreise eintragen“. vorgabe: {von, bis, beginn, ende, land, anlass, zusatz} (alles optional).
// Speichert jeden Reisetag einzeln über speichern('reisen', tag).
export async function reiseOeffnen(vorgabe = {}, kontext) {
  const heuteText = kontext.heute;
  const vorhanden = (await alle('reisen')).filter((r) => !r.geloescht);

  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'formular-stapel reise-form';

  const f = {
    anlass: reiseFeld('reise-anlass', 'Anlass und Ort', 'text', vorgabe.anlass ?? ''),
    land: reiseFeld('reise-land', 'Land', 'text', landAnzeige(vorgabe.land ?? 'Deutschland')),
    von: reiseFeld('reise-von', 'Von', 'date', vorgabe.von ?? heuteText),
    bis: reiseFeld('reise-bis', 'Bis', 'date', vorgabe.bis ?? vorgabe.von ?? heuteText),
    abfahrt: reiseFeld('reise-abfahrt', 'Abfahrt (erster Tag)', 'time', zeitWert(vorgabe.beginn ?? 480)),
    rueck: reiseFeld('reise-rueck', 'Rückkehr (letzter Tag)', 'time', zeitWert(vorgabe.ende ?? 960)),
    fruehstueck: reiseSchalter('reise-fruehstueck', 'Frühstück im Hotel', false),
    zusatz: reiseFeld('reise-zusatz', 'Zusatz', 'text', vorgabe.zusatz ?? ''),
  };
  f.anlass.input.required = true;
  f.land.input.setAttribute('list', 'reise-laender');
  f.von.input.required = true;
  f.bis.input.required = true;
  f.anlass.input.placeholder = 'z. B. Kundenbesuch in Wien';
  f.zusatz.input.placeholder = 'z. B. Hotel von Kunde bezahlt';
  f.zusatz.input.autocomplete = 'off';
  f.anlass.input.autocomplete = 'off';

  const vorschauTitel = document.createElement('p');
  vorschauTitel.className = 'eyebrow';
  vorschauTitel.id = 'reise-vorschau-titel';
  vorschauTitel.textContent = 'Vorschau';
  const vorschauListe = document.createElement('div');
  vorschauListe.className = 'liste reise-vorschau';
  vorschauListe.setAttribute('aria-labelledby', 'reise-vorschau-titel');

  const gesamtFehler = document.createElement('p');
  gesamtFehler.className = 'notiz fehler reise-fuss-fehler';
  gesamtFehler.setAttribute('role', 'alert');
  gesamtFehler.hidden = true;

  const abbrechenKnopf = document.createElement('button');
  abbrechenKnopf.type = 'button';
  abbrechenKnopf.className = 'knopf';
  abbrechenKnopf.textContent = 'Abbrechen';
  abbrechenKnopf.addEventListener('click', () => kontext.sheet.schliessen());

  const sichernKnopf = document.createElement('button');
  sichernKnopf.type = 'submit';
  sichernKnopf.className = 'knopf haupt';
  sichernKnopf.textContent = 'Sichern';

  const fuss = document.createElement('div');
  fuss.className = 'reise-fuss';
  const knoepfe = document.createElement('div');
  knoepfe.className = 'reise-fuss-knoepfe';
  knoepfe.append(abbrechenKnopf, sichernKnopf);
  fuss.append(gesamtFehler, knoepfe);

  const laenderDatalist = landListe('reise-laender');

  form.replaceChildren(
    f.anlass.box,
    f.land.box,
    laenderDatalist,
    f.von.box,
    f.bis.box,
    f.abfahrt.box,
    f.rueck.box,
    f.fruehstueck.box,
    f.zusatz.box,
    vorschauTitel,
    vorschauListe,
    fuss,
  );

  let beschaeftigt = false;

  // Vorschau und Schalter „Frühstück im Hotel“ (nur bei mehreren Tagen) an die Eingaben anpassen
  function vorschauZeichnen() {
    const einzeln = f.von.input.value === f.bis.input.value;
    f.fruehstueck.box.hidden = einzeln;
    const tage = tageAusFeldern(f);
    vorschauListe.replaceChildren();
    if (tage.length === 0) {
      const leer = document.createElement('p');
      leer.className = 'notiz reise-vorschau-leer';
      leer.textContent = 'Von, Bis, Abfahrt und Rückkehr angeben, dann erscheinen die Tage hier.';
      vorschauListe.append(leer);
      return;
    }
    let summe = 0;
    for (const t of tage) {
      const v = verpflegung(t);
      if (v !== null) summe += v;
      const zeile = document.createElement('div');
      zeile.className = 'liste-zeile';
      const text = document.createElement('span');
      text.className = 'liste-text';
      const titel = document.createElement('span');
      titel.className = 'liste-titel';
      titel.textContent = kurzesDatum(t.datum);
      const unter = document.createElement('span');
      unter.className = 'liste-unter';
      const anreise = t.anreise ? ', An- oder Rückreise' : '';
      unter.textContent = `${uhrzeit(t.beginn)} bis ${uhrzeit(t.ende)}${anreise}`;
      text.append(titel, unter);
      const wert = document.createElement('span');
      wert.className = 'liste-wert';
      wert.textContent = v === null ? 'offen' : euro(v);
      zeile.append(text, wert);
      vorschauListe.append(zeile);
    }
    const summeZeile = document.createElement('div');
    summeZeile.className = 'liste-zeile reise-summe-zeile';
    const summeText = document.createElement('span');
    summeText.className = 'liste-titel';
    summeText.textContent = 'Summe';
    const summeWert = document.createElement('span');
    summeWert.className = 'liste-wert reise-summe-wert';
    summeWert.textContent = euro(Math.round(summe * 100) / 100);
    summeZeile.append(summeText, summeWert);
    vorschauListe.append(summeZeile);
  }

  // Bis folgt Von, wenn Bis davor liegt
  f.von.input.addEventListener('input', () => {
    const von = f.von.input.value;
    if (von && f.bis.input.value < von) f.bis.input.value = von;
  });

  form.addEventListener('input', vorschauZeichnen);
  form.addEventListener('change', vorschauZeichnen);

  // Prüfen und speichern
  async function absenden() {
    if (beschaeftigt) return;
    gesamtFehler.hidden = true;
    gesamtFehler.textContent = '';
    for (const feld of Object.values(f)) if (feld.fehler) feldFehler(feld, '');

    let ersterFehler = null;
    const melde = (feld, text) => {
      feldFehler(feld, text);
      if (!ersterFehler) ersterFehler = feld.input;
    };

    if (!f.anlass.input.value.trim()) melde(f.anlass, 'Bitte Anlass und Ort angeben.');
    if (!landAusEingabe(f.land.input.value)) melde(f.land, 'Dieses Land steht nicht in der Länderliste.');

    const von = f.von.input.value;
    const bis = f.bis.input.value;
    if (!von) melde(f.von, 'Bitte ein Datum angeben.');
    if (!bis) melde(f.bis, 'Bitte ein Datum angeben.');
    else if (von && bis < von) melde(f.bis, 'Das Bis-Datum liegt vor dem Von-Datum.');

    const beginn = minutenAusUhrzeit(f.abfahrt.input.value);
    const ende = f.rueck.input.value === '' ? null : minutenAusUhrzeit(f.rueck.input.value);
    if (beginn === null) melde(f.abfahrt, 'Bitte eine Uhrzeit angeben.');
    if (ende === null) melde(f.rueck, 'Bitte eine Uhrzeit angeben.');
    else if (von && bis && bis >= von && beginn !== null) {
      if (von === bis && ende <= beginn) melde(f.rueck, 'Die Rückkehr liegt nicht nach der Abfahrt.');
      else if (von !== bis && ende === 0) melde(f.rueck, 'Die Rückkehr am letzten Tag muss nach 0:00 liegen.');
    }

    if (ersterFehler) {
      ersterFehler.focus();
      return;
    }

    const tage = tageAusFeldern(f);
    const belegt = new Set(vorhanden.map((r) => r.datum));
    const doppelt = tage.find((t) => belegt.has(t.datum));
    if (doppelt) {
      gesamtFehler.textContent = `Am ${langesDatumDe(doppelt.datum)} gibt es schon einen Reisetag. Bitte dort ändern.`;
      gesamtFehler.hidden = false;
      return;
    }

    beschaeftigt = true;
    sichernKnopf.disabled = true;
    try {
      for (const tag of tage) await speichern('reisen', tag);
      kontext.sheet.schliessen();
    } catch (e) {
      console.error(e);
      gesamtFehler.textContent = 'Speichern hat nicht geklappt. Bitte noch einmal versuchen.';
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

  vorschauZeichnen();
  kontext.sheet.oeffnen('Dienstreise eintragen', form);
  return form;
}
