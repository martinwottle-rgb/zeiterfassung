// Dienstreise eintragen (Sheet): mehrtägige Reise als Reisetage speichern, mit Vorschau der Verpflegung.
// Dazu gemeinsame Helfer für tag_sheet.js und ansicht_monat.js: Euro, Länderliste, Betragsprüfung, Feldfehler.
import { alle, loeschen, speichern } from './speicher.js';
import { LAENDER } from './laender.js';
import { hotelNaechteAus, reiseTageErzeugen, verpflegung } from './reisen.js';
import { addTage, minutenAusUhrzeit, uhrzeit, wochentag } from './zeit.js';

const KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
                'August', 'September', 'Oktober', 'November', 'Dezember'];
const EURO = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BETRAG = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const TAG = 1440; // 24:00

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

// Zeit als HH:MM für Zeitfelder, 24:00 als 24:00
function zeitFeldWert(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// Eingabe-Vorgabe für die Zeitfelder oben: 1440 (24:00) bleibt leer, sonst HH:MM
function zeitWert(min) {
  return min === TAG ? '' : zeitFeldWert(min);
}

// Häufigster Wert einer Liste, bei Gleichstand der zuerst vorkommende. Leere Liste: null.
function haeufigste(werte) {
  const zaehl = new Map();
  for (const w of werte) zaehl.set(w, (zaehl.get(w) ?? 0) + 1);
  let bester = null;
  let anzahl = 0;
  for (const [w, n] of zaehl) {
    if (n > anzahl) {
      bester = w;
      anzahl = n;
    }
  }
  return bester;
}

// Abende im Zeitraum (alle Tage außer dem letzten), JJJJ-MM-TT
function abendeZeitraum(von, bis) {
  const liste = [];
  if (!von || !bis) return liste;
  for (let d = von; d < bis; d = addTage(d, 1)) liste.push(d);
  return liste;
}

// Etikett des Nachtschalters: „Nacht vom 25. auf den 26. Oktober im Hotel“
function nachtEtikett(datum) {
  const folge = addTage(datum, 1);
  const [, m1, t1] = datum.split('-').map(Number);
  const [, m2, t2] = folge.split('-').map(Number);
  const teil1 = m1 === m2 ? `${t1}.` : `${t1}. ${MONATE[m1 - 1]}`;
  return `Nacht vom ${teil1} auf den ${t2}. ${MONATE[m2 - 1]} im Hotel`;
}

// Bett als Inline-SVG, Symbol für die Nacht im Hotel
function bettSymbol() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'reise-nacht-symbol');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of ['M3 5v14', 'M3 13h18v6', 'M3 17h18']) {
    const pfad = document.createElementNS(ns, 'path');
    pfad.setAttribute('d', d);
    svg.append(pfad);
  }
  const kissen = document.createElementNS(ns, 'circle');
  kissen.setAttribute('cx', '7.5');
  kissen.setAttribute('cy', '10');
  kissen.setAttribute('r', '2');
  svg.append(kissen);
  return svg;
}

// Gestellte Mahlzeiten: Schlüssel am Reisetag, Schalterbeschriftung und Wort für die zugeklappte Zeile
const MAHLZEITEN = [
  { schluessel: 'fruehstueck', schalter: 'Frühstück gestellt', wort: 'Frühstück' },
  { schluessel: 'mittag', schalter: 'Mittagessen gestellt', wort: 'Mittagessen' },
  { schluessel: 'abend', schalter: 'Abendessen gestellt', wort: 'Abendessen' },
];

// Zusätzliche Beträge je Reisetag (Euro), in der aufgeklappten Tageszeile
const BETRAEGE = [
  { schluessel: 'fahrt', name: 'Fahrt (Euro)' },
  { schluessel: 'neben', name: 'Nebenkosten (Euro)' },
];
const BETRAG_FEHLER = 'Bitte einen Betrag in Euro angeben, zum Beispiel 12,50.';
const ZEIT_FEHLER = 'Bitte eine Uhrzeit angeben.';
const RUECKKEHR_FEHLER = 'Die Rückkehr liegt nicht nach der Abfahrt.';
const PRUEFEN_HINWEIS = 'Bitte die Beträge und Zeiten in der Vorschau prüfen.';

// Betrag für ein Feld: leer bei 0, sonst mit Komma ohne Tausenderpunkt
function betragText(n) {
  return n ? BETRAG.format(n) : '';
}

// Auf Cent runden
function cent2(x) {
  return Math.round(x * 100) / 100;
}

// Summe der zusätzlichen Beträge eines Tages
function extras(t) {
  return (t.uebernachtung ?? 0) + (t.fahrt ?? 0) + (t.neben ?? 0);
}

// Wert der Tageszeile: Verpflegung plus Beträge, „offen“ bei unbekanntem Land
function tagWert(t) {
  const v = verpflegung(t);
  return v === null ? 'offen' : euro(cent2(v + extras(t)));
}

// Gesamtsumme der Vorschau (offene Tage zählen 0)
function summeVon(tage) {
  let summe = 0;
  for (const t of tage) summe += (verpflegung(t) ?? 0) + extras(t);
  return cent2(summe);
}

// Tage der Reise aus den Feldern des Sheets (Vorschau und Sichern). Leer, solange Angaben fehlen.
// abweichungen: { 'JJJJ-MM-TT': { abend: true, beginn: 420, ... } } überschreibt Felder des Tages.
// Abfahrt nur an Tagen, die nicht um 0:00 beginnen; Rückkehr nur an Tagen, die nicht um 24:00 enden.
// hotelNaechte: Abende im Hotel. uebernachtung: alte Übernachtungsbeträge je Datum (bleiben erhalten).
function tageAusFeldern(f, abweichungen = {}, hotelNaechte = [], uebernachtung = {}) {
  const von = f.von.input.value;
  const bis = f.bis.input.value;
  const beginn = minutenAusUhrzeit(f.abfahrt.input.value);
  const ende = minutenAusUhrzeit(f.rueck.input.value);
  if (!von || !bis || bis < von || beginn === null || ende === null) return [];
  const land = landAusEingabe(f.land.input.value) ?? landAnzeige(f.land.input.value);
  const tage = reiseTageErzeugen({
    von,
    bis,
    beginn,
    ende,
    land,
    anlass: f.anlass.input.value.trim(),
    zusatz: f.zusatz.input.value.trim(),
    hotelFruehstueck: von !== bis && f.fruehstueck.input.checked,
    hotelNaechte,
  });
  return tage.map((t) => {
    const o = { ...t, uebernachtung: uebernachtung[t.datum] ?? 0 };
    for (const [schluessel, wert] of Object.entries(abweichungen[t.datum] ?? {})) {
      if (schluessel === 'beginn' && t.beginn === 0) continue;
      if (schluessel === 'ende' && t.ende === TAG) continue;
      o[schluessel] = wert;
    }
    return o;
  });
}

// Sheet „Dienstreise eintragen“ oder „Dienstreise bearbeiten“.
// vorgabe: {von, bis, beginn, ende, land, anlass, zusatz} (alles optional), oder {tage} mit den vorhandenen
// Reisetagen einer Reise (Bearbeiten). Gesichert wird je Tag über speichern('reisen', tag), die alten Tage
// bekommen den Grabstein.
export async function reiseOeffnen(vorgabe = {}, kontext) {
  const heuteText = kontext.heute;
  const bearbeitet = Array.isArray(vorgabe.tage) && vorgabe.tage.length > 0
    ? [...vorgabe.tage].sort((a, b) => (a.datum === b.datum ? a.beginn - b.beginn : a.datum < b.datum ? -1 : 1))
    : null;
  const erste = bearbeitet?.[0];
  const letzte = bearbeitet?.[bearbeitet.length - 1];
  // Abende im Hotel, wie sie gespeichert sind
  const nachtDaten = bearbeitet ? hotelNaechteAus(bearbeitet) : [];
  // Beim Bearbeiten: häufigste Abfahrt und Rückkehr als Vorgabe, der Rest wird als Abweichung gemerkt
  const quelle = bearbeitet
    ? {
      von: erste.datum,
      bis: letzte.datum,
      beginn: haeufigste(bearbeitet.filter((t) => t.beginn !== 0).map((t) => t.beginn)) ?? 480,
      ende: haeufigste(bearbeitet.filter((t) => t.ende !== TAG).map((t) => t.ende)) ?? 960,
      land: erste.land,
      anlass: erste.anlass,
      zusatz: erste.zusatz ?? '',
    }
    : vorgabe;
  // „Frühstück im Hotel“ gilt, wenn alle Tage nach einer Hotelnacht Frühstück haben (Vorgabe: an)
  const nachHotelnacht = bearbeitet
    ? bearbeitet.filter((t) => nachtDaten.includes(addTage(t.datum, -1)))
    : [];
  const hotel = nachHotelnacht.length === 0 || nachHotelnacht.every((t) => t.fruehstueck);
  const bestehendeId = bearbeitet?.find((t) => t.reiseId)?.reiseId ?? null;
  const alteIds = new Set((bearbeitet ?? []).map((t) => t.id));
  // Übernachtungsbeträge der bisherigen Tage bleiben beim Sichern erhalten (das Feld entfällt im Sheet)
  const uebernachtungAlt = Object.fromEntries((bearbeitet ?? []).map((t) => [t.datum, t.uebernachtung ?? 0]));
  // Belegte Tage ohne die Tage der Reise, die gerade bearbeitet wird
  const vorhanden = (await alle('reisen')).filter((r) => !r.geloescht && !alteIds.has(r.id));

  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'formular-stapel reise-form';

  const f = {
    anlass: reiseFeld('reise-anlass', 'Anlass und Ort', 'text', quelle.anlass ?? ''),
    land: reiseFeld('reise-land', 'Land', 'text', landAnzeige(quelle.land ?? 'Deutschland')),
    von: reiseFeld('reise-von', 'Von', 'date', quelle.von ?? heuteText),
    bis: reiseFeld('reise-bis', 'Bis', 'date', quelle.bis ?? quelle.von ?? heuteText),
    abfahrt: reiseFeld('reise-abfahrt', 'Abfahrt', 'time', zeitWert(quelle.beginn ?? 480)),
    rueck: reiseFeld('reise-rueck', 'Rückkehr', 'time', zeitWert(quelle.ende ?? 960)),
    uebernachtung: reiseSchalter('reise-uebernachtung', 'Übernachtung im Hotel', true),
    fruehstueck: reiseSchalter('reise-fruehstueck', 'Frühstück im Hotel', hotel),
    zusatz: reiseFeld('reise-zusatz', 'Zusatz', 'text', quelle.zusatz ?? ''),
  };
  f.anlass.input.required = true;
  f.land.input.setAttribute('list', 'reise-laender');
  f.von.input.required = true;
  f.bis.input.required = true;
  f.anlass.input.placeholder = 'z. B. Kundenbesuch in Wien';
  f.zusatz.input.placeholder = 'z. B. Hotel von Kunde bezahlt';
  f.zusatz.input.autocomplete = 'off';
  f.anlass.input.autocomplete = 'off';

  // Abfahrt und Rückkehr oben, mit Hinweis darunter
  const zeitenHinweis = document.createElement('p');
  zeitenHinweis.className = 'notiz reise-zeiten-hinweis';
  zeitenHinweis.id = 'reise-zeiten-hinweis';
  zeitenHinweis.textContent = 'Gilt für jeden Tag, an dem du morgens losfährst bzw. abends heimkommst.';
  for (const feld of [f.abfahrt, f.rueck]) {
    feld.input.setAttribute('aria-describedby', `${zeitenHinweis.id} ${feld.fehler.id}`);
  }
  const zeiten = document.createElement('div');
  zeiten.className = 'reise-zeiten';
  zeiten.append(f.abfahrt.box, f.rueck.box);

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

  // Reise löschen: nur beim Bearbeiten, erst mit Rückfrage
  const loeschZone = document.createElement('div');
  loeschZone.className = 'reisen-loeschen';
  const startKnopf = document.createElement('button');
  startKnopf.type = 'button';
  startKnopf.className = 'knopf gefahr';
  startKnopf.textContent = 'Reise löschen';
  startKnopf.addEventListener('click', () => rueckfrageZeigen());
  loeschZone.replaceChildren(startKnopf);
  loeschZone.hidden = !bearbeitet;

  fuss.append(gesamtFehler, knoepfe, loeschZone);

  const laenderDatalist = landListe('reise-laender');

  form.replaceChildren(
    f.anlass.box,
    f.land.box,
    laenderDatalist,
    f.von.box,
    f.bis.box,
    f.uebernachtung.box,
    f.fruehstueck.box,
    zeiten,
    zeitenHinweis,
    f.zusatz.box,
    vorschauTitel,
    vorschauListe,
    fuss,
  );

  let beschaeftigt = false;

  // Abweichungen je Reisetag (Mahlzeiten, Beträge, Zeiten, die vom Standard abweichen) und offene Zeilen
  const abweichungen = {};
  const offen = new Set();
  // Schalter, der nach dem Neuzeichnen wieder den Fokus bekommt
  let fokusId = null;
  // Wertfelder der Tageszeilen (datum -> Element) und Summenfeld, für Änderungen ohne Neuaufbau
  const wertElemente = new Map();
  let summeWert = null;
  // Ungültig eingetippte Beträge und Uhrzeiten, je „datum|feld“: bleiben stehen und blockieren das Sichern
  const roh = new Map();
  // Abende, an denen man NICHT im Hotel bleibt (Datumstexte). Alle übrigen Abende im Zeitraum sind im Hotel.
  const aus = new Set();

  // Abende im Hotel im aktuellen Zeitraum
  const nachtListe = () => abendeZeitraum(f.von.input.value, f.bis.input.value).filter((d) => !aus.has(d));
  const nachtAlleAn = () => abendeZeitraum(f.von.input.value, f.bis.input.value).every((d) => !aus.has(d));
  // Tage der Reise mit Abweichungen; ohne Abweichungen (mit {}) der Standard
  const tageJetzt = (mit = abweichungen) => tageAusFeldern(f, mit, nachtListe(), uebernachtungAlt);

  if (bearbeitet) {
    for (const d of abendeZeitraum(quelle.von, quelle.bis)) if (!nachtDaten.includes(d)) aus.add(d);
  }
  f.uebernachtung.input.checked = nachtAlleAn();

  // Beim Bearbeiten: Abweichungen von der Vorgabe aus den gespeicherten Tagen übernehmen
  if (bearbeitet) {
    const standard = tageJetzt({});
    for (const t of bearbeitet) {
      const std = standard.find((s) => s.datum === t.datum) ?? {};
      const eintrag = {};
      for (const m of MAHLZEITEN) {
        if (Boolean(t[m.schluessel]) !== Boolean(std[m.schluessel])) eintrag[m.schluessel] = Boolean(t[m.schluessel]);
      }
      for (const b of BETRAEGE) {
        if ((t[b.schluessel] ?? 0) !== (std[b.schluessel] ?? 0)) eintrag[b.schluessel] = t[b.schluessel] ?? 0;
      }
      if (t.beginn !== 0 && t.beginn !== std.beginn) eintrag.beginn = t.beginn;
      if (t.ende !== TAG && t.ende !== std.ende) eintrag.ende = t.ende;
      if (Object.keys(eintrag).length) abweichungen[t.datum] = eintrag;
    }
  }

  // Ein Betrag eines Tages geändert (Komma oder Punkt, leer ist 0). Nur Werte und Summe werden aktualisiert.
  function betragGeaendert(datum, schluessel, feld) {
    const merk = `${datum}|${schluessel}`;
    const betrag = betragAusText(feld.input.value);
    if (Number.isNaN(betrag)) {
      roh.set(merk, feld.input.value);
      feldFehler(feld, BETRAG_FEHLER);
    } else {
      roh.delete(merk);
      feldFehler(feld, '');
      const standard = tageJetzt({}).find((t) => t.datum === datum);
      const eintrag = { ...abweichungen[datum] };
      if (betrag === (standard?.[schluessel] ?? 0)) delete eintrag[schluessel];
      else eintrag[schluessel] = betrag;
      if (Object.keys(eintrag).length) abweichungen[datum] = eintrag;
      else delete abweichungen[datum];
      feld.input.value = betragText(betrag);
    }
    vorschauWerteAktualisieren();
  }

  // Abfahrt oder Rückkehr eines Tages geändert. Entspricht der Wert der Vorgabe, gibt es keine Abweichung.
  function zeitGeaendert(datum, schluessel, feld) {
    const merk = `${datum}|${schluessel}`;
    const min = minutenAusUhrzeit(feld.input.value);
    if (min === null) {
      roh.set(merk, feld.input.value);
    } else {
      roh.delete(merk);
      const standard = tageJetzt({}).find((t) => t.datum === datum);
      const eintrag = { ...abweichungen[datum] };
      if (min === standard?.[schluessel]) delete eintrag[schluessel];
      else eintrag[schluessel] = min;
      if (Object.keys(eintrag).length) abweichungen[datum] = eintrag;
      else delete abweichungen[datum];
    }
    fokusId = feld.input.id;
    vorschauZeichnen();
  }

  // Tageswerte und Summe in der Vorschau aktualisieren, ohne die Zeilen neu aufzubauen (der Fokus bleibt)
  function vorschauWerteAktualisieren() {
    const tage = tageJetzt();
    for (const t of tage) {
      const wert = wertElemente.get(t.datum);
      if (wert) wert.textContent = tagWert(t);
    }
    if (summeWert) summeWert.textContent = euro(summeVon(tage));
    sperrenAktualisieren();
  }

  // Eine Mahlzeit eines Tages umschalten. Entspricht der Wert dem Standard, wird die Abweichung gelöscht.
  function mahlzeitGeaendert(datum, schluessel, input) {
    const standard = tageJetzt({}).find((t) => t.datum === datum);
    if (!standard) return;
    const eintrag = { ...abweichungen[datum] };
    if (input.checked === standard[schluessel]) delete eintrag[schluessel];
    else eintrag[schluessel] = input.checked;
    if (Object.keys(eintrag).length) abweichungen[datum] = eintrag;
    else delete abweichungen[datum];
    fokusId = input.id;
    vorschauZeichnen();
  }

  // Eine Hotelnacht ein- oder ausschalten: nur dieser Abend ändert sich, die Vorschau wird neu gezeichnet
  function nachtGeaendert(datum, input) {
    if (input.checked) aus.delete(datum);
    else aus.add(datum);
    f.uebernachtung.input.checked = nachtAlleAn();
    fokusId = input.id;
    vorschauZeichnen();
  }

  // Gesperrt, solange ein Betrag oder eine Uhrzeit ungültig ist oder eine Rückkehr nicht nach der Abfahrt liegt
  function gesperrt() {
    return roh.size > 0 || tageJetzt().some((t) => t.ende <= t.beginn);
  }

  // Sichern-Schalter und Hinweis an den Zustand der Vorschau anpassen
  function sperrenAktualisieren() {
    const sperre = gesperrt();
    sichernKnopf.disabled = beschaeftigt || sperre;
    if (sperre) {
      gesamtFehler.textContent = PRUEFEN_HINWEIS;
      gesamtFehler.hidden = false;
    } else if (gesamtFehler.textContent === PRUEFEN_HINWEIS) {
      gesamtFehler.textContent = '';
      gesamtFehler.hidden = true;
    }
  }

  // Zeitfeld eines Tages; ungültige Eingaben bleiben stehen (roh)
  function zeitFeldFuer(t, schluessel, name, id, wert) {
    const merk = `${t.datum}|${schluessel}`;
    const feld = reiseFeld(`${id}-${schluessel}`, name, 'time', roh.has(merk) ? roh.get(merk) : zeitFeldWert(wert));
    feld.input.addEventListener('change', () => zeitGeaendert(t.datum, schluessel, feld));
    if (roh.has(merk)) feldFehler(feld, ZEIT_FEHLER);
    return feld;
  }

  // Schalter „Nacht im Hotel“ zwischen zwei Tagen der Vorschau
  function nachtZeile(datum, an) {
    const zeile = document.createElement('div');
    zeile.className = 'reise-nacht';
    const text = document.createElement('span');
    text.className = 'reise-nacht-text';
    text.textContent = 'Nacht im Hotel';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.id = `reise-nacht-${datum}`;
    input.name = input.id;
    input.checked = an;
    input.setAttribute('aria-label', nachtEtikett(datum));
    input.addEventListener('change', () => nachtGeaendert(datum, input));
    zeile.append(bettSymbol(), text, input);
    return zeile;
  }

  // Vorschau und Schalter „Übernachtung“ und „Frühstück im Hotel“ (nur bei mehreren Tagen) an die Eingaben anpassen
  function vorschauZeichnen() {
    const einzeln = f.von.input.value === f.bis.input.value;
    f.uebernachtung.box.hidden = einzeln;
    f.fruehstueck.box.hidden = einzeln;
    const tage = tageJetzt();
    vorschauListe.replaceChildren();
    wertElemente.clear();
    if (tage.length === 0) {
      summeWert = null;
      const leer = document.createElement('p');
      leer.className = 'notiz reise-vorschau-leer';
      leer.textContent = 'Von, Bis, Abfahrt und Rückkehr angeben, dann erscheinen die Tage hier.';
      vorschauListe.append(leer);
      sperrenAktualisieren();
      return;
    }
    tage.forEach((t, i) => {
      const id = `reise-tag-${t.datum}`;
      // Rückkehr nicht nach der Abfahrt: Fehler an der Zeile, die Zeile klappt auf
      const zeitFehler = t.ende <= t.beginn;
      const hatRoh = [...roh.keys()].some((k) => k.startsWith(`${t.datum}|`));
      if (zeitFehler || hatRoh) offen.add(t.datum);

      const zeile = document.createElement('button');
      zeile.type = 'button';
      zeile.id = `${id}-knopf`;
      zeile.className = 'liste-zeile reise-vorschau-tag';
      zeile.setAttribute('aria-controls', `${id}-felder`);
      const ist = offen.has(t.datum);
      zeile.setAttribute('aria-expanded', String(ist));
      const text = document.createElement('span');
      text.className = 'liste-text';
      const titel = document.createElement('span');
      titel.className = 'liste-titel';
      titel.textContent = kurzesDatum(t.datum);
      const unter = document.createElement('span');
      unter.className = 'liste-unter';
      const anreise = t.anreise ? ', An- oder Rückreise' : '';
      unter.textContent = `${uhrzeit(t.beginn)} bis ${uhrzeit(t.ende)}${anreise}`;
      const gestellt = MAHLZEITEN.filter((m) => t[m.schluessel]).map((m) => m.wort);
      if (gestellt.length) {
        const kurz = document.createElement('span');
        kurz.className = 'reise-vorschau-gestellt';
        kurz.textContent = ` · ${gestellt.join(', ')} gestellt`;
        unter.append(kurz);
      }
      text.append(titel, unter);
      const wert = document.createElement('span');
      wert.className = 'liste-wert';
      wert.textContent = tagWert(t);
      wertElemente.set(t.datum, wert);
      zeile.append(text, wert);

      const felder = document.createElement('div');
      felder.className = 'reise-vorschau-felder';
      felder.id = `${id}-felder`;
      felder.setAttribute('role', 'group');
      felder.setAttribute('aria-labelledby', zeile.id);
      felder.hidden = !ist;
      for (const m of MAHLZEITEN) {
        const schalter = reiseSchalter(`${id}-${m.schluessel}`, m.schalter, Boolean(t[m.schluessel]));
        schalter.input.addEventListener('change', () => mahlzeitGeaendert(t.datum, m.schluessel, schalter.input));
        felder.append(schalter.box);
      }
      const betragBox = document.createElement('div');
      betragBox.className = 'reise-betraege zwei';
      for (const b of BETRAEGE) {
        const merk = `${t.datum}|${b.schluessel}`;
        const feld = reiseFeld(`${id}-${b.schluessel}`, b.name, 'text',
          roh.has(merk) ? roh.get(merk) : betragText(t[b.schluessel]));
        feld.input.inputMode = 'decimal';
        feld.input.autocomplete = 'off';
        feld.input.placeholder = '0,00';
        if (roh.has(merk)) feldFehler(feld, BETRAG_FEHLER);
        feld.input.addEventListener('change', () => betragGeaendert(t.datum, b.schluessel, feld));
        betragBox.append(feld.box);
      }
      felder.append(betragBox);

      // Abfahrt und Rückkehr nur an Tagen, die nicht um 0:00 beginnen bzw. nicht um 24:00 enden
      if (t.beginn !== 0 || t.ende !== TAG) {
        const zeitBox = document.createElement('div');
        zeitBox.className = 'reise-zeiten';
        if (t.beginn !== 0) zeitBox.append(zeitFeldFuer(t, 'beginn', 'Abfahrt', id, t.beginn).box);
        if (t.ende !== TAG) {
          const rueck = zeitFeldFuer(t, 'ende', 'Rückkehr', id, t.ende);
          if (zeitFehler && !roh.has(`${t.datum}|ende`)) feldFehler(rueck, RUECKKEHR_FEHLER);
          zeitBox.append(rueck.box);
        }
        felder.append(zeitBox);
      }

      zeile.addEventListener('click', () => {
        const auf = !offen.has(t.datum);
        if (auf) offen.add(t.datum);
        else offen.delete(t.datum);
        zeile.setAttribute('aria-expanded', String(auf));
        felder.hidden = !auf;
      });

      vorschauListe.append(zeile, felder);
      if (i < tage.length - 1) vorschauListe.append(nachtZeile(t.datum, !aus.has(t.datum)));
    });
    const summeZeile = document.createElement('div');
    summeZeile.className = 'liste-zeile reise-summe-zeile';
    const summeText = document.createElement('span');
    summeText.className = 'liste-titel';
    summeText.textContent = 'Summe';
    summeWert = document.createElement('span');
    summeWert.className = 'liste-wert reise-summe-wert';
    summeWert.textContent = euro(summeVon(tage));
    summeZeile.append(summeText, summeWert);
    vorschauListe.append(summeZeile);
    sperrenAktualisieren();
    if (fokusId) {
      document.getElementById(fokusId)?.focus();
      fokusId = null;
    }
  }

  // Bis folgt Von, wenn Bis davor liegt
  f.von.input.addEventListener('input', () => {
    const von = f.von.input.value;
    if (von && f.bis.input.value < von) f.bis.input.value = von;
  });

  // „Übernachtung im Hotel“ setzt alle Abende im Zeitraum (die Vorschau zeichnet das Formular danach neu)
  f.uebernachtung.input.addEventListener('change', () => {
    const an = f.uebernachtung.input.checked;
    for (const d of abendeZeitraum(f.von.input.value, f.bis.input.value)) {
      if (an) aus.delete(d);
      else aus.add(d);
    }
  });

  // „Frühstück im Hotel“ ändert das Frühstück aller Tage: Frühstück-Abweichungen verwerfen, Mittag und Abend behalten
  f.fruehstueck.input.addEventListener('change', () => {
    for (const datum of Object.keys(abweichungen)) {
      delete abweichungen[datum].fruehstueck;
      if (Object.keys(abweichungen[datum]).length === 0) delete abweichungen[datum];
    }
  });

  // Änderungen in der Vorschau übernehmen die Schalter selbst (mahlzeitGeaendert, nachtGeaendert, …).
  // Der Ereignispfad gilt schon beim Auslösen; nach dem Neuzeichnen ist das Ziel nicht mehr im Dokument.
  // Der Schalter „Übernachtung im Hotel“ selbst bleibt beim Ereignis unverändert, sonst setzt das Neuzeichnen
  // ihn zurück, bevor sein change-Ereignis die Nächte ändert.
  const inVorschau = (e) => e.composedPath().includes(vorschauListe);
  const neuZeichnen = (e) => {
    if (inVorschau(e)) return;
    if (e.target !== f.uebernachtung.input) f.uebernachtung.input.checked = nachtAlleAn();
    vorschauZeichnen();
  };
  form.addEventListener('input', neuZeichnen);
  form.addEventListener('change', neuZeichnen);

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
    if (roh.size > 0) {
      gesamtFehler.textContent = PRUEFEN_HINWEIS;
      gesamtFehler.hidden = false;
      return;
    }

    const tage = tageJetzt();
    const zeitFehlerTag = tage.find((t) => t.ende <= t.beginn);
    if (zeitFehlerTag) {
      gesamtFehler.textContent = `Am ${langesDatumDe(zeitFehlerTag.datum)} liegt die Rückkehr nicht nach der Abfahrt. Bitte die Zeiten in der Vorschau prüfen.`;
      gesamtFehler.hidden = false;
      vorschauZeichnen();
      return;
    }
    const belegt = new Set(vorhanden.map((r) => r.datum));
    const doppelt = tage.find((t) => belegt.has(t.datum));
    if (doppelt) {
      gesamtFehler.textContent = `Am ${langesDatumDe(doppelt.datum)} gibt es schon einen Reisetag. Bitte dort ändern.`;
      gesamtFehler.hidden = false;
      return;
    }

    // Eine Reise hat eine reiseId; beim Bearbeiten bleibt die bestehende
    const reiseId = bestehendeId ?? crypto.randomUUID();
    beschaeftigt = true;
    sichernKnopf.disabled = true;
    try {
      for (const tag of tage) await speichern('reisen', { ...tag, reiseId });
      // Erst nach dem Speichern der neuen Tage die alten als Grabsteine markieren
      for (const alt of bearbeitet ?? []) await loeschen('reisen', alt.id);
      kontext.sheet.schliessen();
    } catch (e) {
      console.error(e);
      gesamtFehler.textContent = 'Speichern hat nicht geklappt. Bitte noch einmal versuchen.';
      gesamtFehler.hidden = false;
    } finally {
      beschaeftigt = false;
      sichernKnopf.disabled = gesperrt();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    absenden();
  });

  // Rückfrage im Sheet, dann alle Tage der Reise als Grabstein
  function rueckfrageZeigen() {
    const frage = document.createElement('p');
    frage.className = 'notiz';
    frage.id = 'reise-loeschen-frage';
    frage.textContent = `Reise vom ${langesDatumDe(erste.datum)} bis ${langesDatumDe(letzte.datum)} wirklich löschen?`;
    const nein = document.createElement('button');
    nein.type = 'button';
    nein.className = 'knopf';
    nein.textContent = 'Nein, behalten';
    nein.addEventListener('click', () => loeschZone.replaceChildren(startKnopf));
    const ja = document.createElement('button');
    ja.type = 'button';
    ja.className = 'knopf gefahr';
    ja.textContent = 'Ja, löschen';
    ja.addEventListener('click', () => reiseLoeschen());
    const knopfZeile = document.createElement('div');
    knopfZeile.className = 'reise-fuss-knoepfe';
    knopfZeile.append(nein, ja);
    loeschZone.replaceChildren(frage, knopfZeile);
    nein.focus();
  }

  async function reiseLoeschen() {
    if (beschaeftigt || !bearbeitet) return;
    beschaeftigt = true;
    try {
      for (const t of bearbeitet) await loeschen('reisen', t.id);
      kontext.sheet.schliessen();
    } catch (e) {
      console.error(e);
      gesamtFehler.textContent = 'Löschen hat nicht geklappt. Bitte noch einmal versuchen.';
      gesamtFehler.hidden = false;
      loeschZone.replaceChildren(startKnopf);
    } finally {
      beschaeftigt = false;
    }
  }

  vorschauZeichnen();
  kontext.sheet.oeffnen(bearbeitet ? 'Dienstreise bearbeiten' : 'Dienstreise eintragen', form);
  return form;
}
