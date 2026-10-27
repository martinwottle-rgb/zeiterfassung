// Belege in Sheets: erfassen (Scan, Foto, PDF, Erkennung, Formular), bearbeiten und löschen.
// Neue Seiten werden erst beim Sichern im Speicher abgelegt, damit Abbrechen keine Bilder ohne Beleg hinterlässt.
// Scannen, Zuschneiden und Erkennung ersetzen das Sheet; der Stand des Formulars wird deshalb vorher gelesen
// und danach wieder aufgebaut.
import { alle, bildLaden, bildSpeichern, loeschen, speichern } from './speicher.js';
import { KATEGORIEN, belegLesen, betragLesen, reiseAm } from './belege.js';
import { pdfErsteSeite } from './beleg_pdf.js';
import { textErkennen } from './ocr.js';
import { scannen } from './scanner.js';
import { BELEG_SEITEN } from './kantenerkennung.js';
import { zuschneiden } from './zuschnitt.js';

const BILD_AUSWAHL = 'image/*,.heic,.heif';
const PDF_AUSWAHL = 'application/pdf,.pdf';
const WAEHRUNGEN = ['EUR', 'TRY', 'GBP', 'USD', 'CHF'];
const TANKEN = 'Tanken';
// Kennzeichen in der Beschreibung, zum Beispiel S-AB1234
const KENNZEICHEN = /\b[A-ZÄÖÜ]{1,3}-[A-Z]{1,2} ?\d{1,4}[EH]?\b/;
const SCAN = { seiten: ['Seite 1', 'Seite 2', 'Seite 3', 'Seite 4'], seitenVerhaeltnis: BELEG_SEITEN, wort: 'Beleg', titel: 'Beleg scannen' };
const HINWEIS_NICHT_ERKANNT = 'Text nicht erkannt. Bitte Datum und Betrag eintragen.';
const HINWEIS_GELESEN = 'Aus dem Beleg gelesen, bitte prüfen';
const SPEICHERN_FEHLER = 'Speichern hat nicht geklappt. Bitte noch einmal versuchen.';

// Kategorien als Namen für die Auswahl (falls belege.js Objekte liefert, deren Name)
const KATEGORIE_NAMEN = KATEGORIEN.map((k) => (typeof k === 'string' ? k : (k.name ?? k.text ?? k.wert)));

const leereFelder = () => ({ datum: '', betrag: '', waehrung: 'EUR', kategorie: '', haendler: '', beschreibung: '' });

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Betrag als Text für das Feld: 12.5 wird „12,50“
function betragAnzeige(n) {
  if (typeof n === 'number') return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '';
  return n == null ? '' : String(n);
}

// Werte aus der Erkennung in die Felder des Formulars
function felderAus(b) {
  return {
    datum: b.datum ?? '',
    betrag: betragAnzeige(b.betrag),
    waehrung: WAEHRUNGEN.includes(b.waehrung) ? b.waehrung : 'EUR',
    kategorie: b.kategorie ?? '',
    haendler: b.haendler ?? '',
    beschreibung: '',
  };
}

// PDF erkennen: am Typ oder an der Kennung %PDF- am Anfang
async function istPdf(blob) {
  if (blob.type === 'application/pdf') return true;
  const kopf = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...kopf) === '%PDF-';
}

// Seite aus dem Speicher (neu: blob, gespeichert: id). Fehlt sie, null.
async function seiteBlob(s) {
  if (s.blob) return s.blob;
  return s.id ? bildLaden(s.id) : null;
}

// Miniatur einer Seite: bei PDF die erste Seite als JPEG
async function seiteVorschau(s) {
  const blob = await seiteBlob(s);
  if (!blob) return null;
  const pdf = await istPdf(blob);
  return { bild: pdf ? await pdfErsteSeite(blob) : blob, pdf };
}

// Datei-Auswahl als Knopf: das Eingabefeld steckt im Label und ist für Screenreader und Tastatur erreichbar
function dateiKnopf(text, accept, mehrere, onDateien) {
  const label = el('label', 'knopf beleg-datei');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = mehrere;
  input.className = 'nur-sr';
  input.addEventListener('change', () => {
    const dateien = [...(input.files ?? [])];
    input.value = '';
    if (dateien.length) onDateien(dateien);
  });
  label.append(input, document.createTextNode(text));
  return label;
}

// Gruppe mit Überschrift (fieldset), Inhalt untereinander
function gruppe(titel, inhalt) {
  const fs = el('fieldset', 'beleg-gruppe');
  fs.append(el('legend', 'beleg-legende', titel), ...inhalt);
  return fs;
}

function fehlerSetzen(feld, text) {
  feld.fehler.textContent = text ?? '';
  feld.fehler.hidden = !text;
  if (text) feld.input.setAttribute('aria-invalid', 'true');
  else feld.input.removeAttribute('aria-invalid');
}

// Hinweis „bitte prüfen“ für ein aus dem Beleg gelesenes Feld
function unsicherSetzen(feld, an) {
  feld.box.classList.toggle('beleg-unsicher', an);
  feld.unsicher.hidden = !an;
  feld.input.setAttribute('aria-describedby', an ? `${feld.fehler.id} ${feld.unsicher.id}` : feld.fehler.id);
}

// Feld mit Beschriftung, Hinweis und Fehlerzeile. steuer ist das Eingabeelement mit id.
function feldBauen(name, steuer) {
  const box = el('div', 'feld');
  const label = el('label', null, name);
  label.htmlFor = steuer.id;
  const unsicher = el('p', 'notiz beleg-unsicher-hinweis', 'bitte prüfen');
  unsicher.id = `${steuer.id}-unsicher`;
  unsicher.hidden = true;
  const fehler = el('p', 'notiz fehler');
  fehler.id = `${steuer.id}-fehler`;
  fehler.hidden = true;
  steuer.setAttribute('aria-describedby', fehler.id);
  box.append(label, steuer, unsicher, fehler);
  return { box, input: steuer, fehler, unsicher };
}

// Fotos nacheinander zuschneiden. Abgebrochene werden übersprungen, Fehler kommen als Text zurück.
async function fotosZuschneiden(dateien, kontext) {
  const blobs = [];
  let fehler = '';
  for (const datei of dateien) {
    try {
      const blob = await zuschneiden(datei, kontext);
      if (blob) blobs.push(blob);
    } catch (e) {
      console.error(e);
      fehler = e?.message || 'Ein Foto konnte nicht verarbeitet werden.';
    }
  }
  return { blobs, fehler };
}

// Ergebnis ohne Erkennung (Fehler oder kein Text)
const leerErgebnis = () => ({ felder: null, text: '', fehler: HINWEIS_NICHT_ERKANNT });

// Fortschritt der Erkennung im Sheet. Liefert die Rückruffunktion für textErkennen.
function fortschrittZeigen(kontext) {
  const titel = el('p', 'beleg-fortschritt-titel', 'Beleg wird gelesen …');
  titel.id = 'beleg-ocr-titel';
  const balken = document.createElement('progress');
  balken.className = 'beleg-fortschritt';
  balken.max = 100;
  balken.value = 0;
  balken.setAttribute('aria-labelledby', titel.id);
  const prozent = el('p', 'notiz zahl', '0 %');
  const huelle = el('div', 'beleg-fortschritt-huelle');
  huelle.append(titel, balken, prozent);
  kontext.sheet.oeffnen('Beleg lesen', huelle);
  return (p) => {
    const wert = Math.round(Math.min(Math.max(Number.isFinite(p) ? p : 0, 0), 1) * 100);
    balken.value = wert;
    prozent.textContent = `${wert} %`;
  };
}

// Erste Seite lesen (bei PDF deren erste Seite). Fehler kommen als Hinweis zurück, nie als Wurf.
async function erkennungLaufen(seiten, kontext) {
  const zeigen = fortschrittZeigen(kontext);
  try {
    const blob = await seiteBlob(seiten[0]);
    if (!blob) return leerErgebnis();
    const bild = (await istPdf(blob)) ? await pdfErsteSeite(blob) : blob;
    const text = (await textErkennen(bild, zeigen)) ?? '';
    if (!text.trim()) return leerErgebnis();
    const gelesen = await belegLesen(text, { heute: kontext.heute });
    return { felder: felderAus(gelesen ?? {}), text, fehler: '' };
  } catch (e) {
    console.error(e);
    return leerErgebnis();
  }
}

// Letztes Kennzeichen aus der Beschreibung des neuesten nicht gelöschten Tanken-Belegs. Sonst leer.
function letztesKennzeichen(liste) {
  const tanken = (liste ?? [])
    .filter((b) => b && !b.geloescht && b.kategorie === TANKEN)
    .sort((a, b) => (b.erstellt ?? 0) - (a.erstellt ?? 0));
  const treffer = KENNZEICHEN.exec(tanken[0]?.beschreibung ?? '');
  return treffer ? treffer[0] : '';
}

// Formular für Erfassen und Bearbeiten. stand: { titel, id, erstellt, beleg, status, seiten, felder, text,
// hinweis, unsicher }. seiten: [{ blob } | { id }] in Reihenfolge; beleg: gespeicherter Beleg (nur Bearbeiten).
function formularOeffnen(stand, kontext) {
  let seiten = [...(stand.seiten ?? [])];
  let beschaeftigt = false;
  const werte = { ...leereFelder(), ...(stand.felder ?? {}) };
  const offen = new Set(stand.unsicher ?? []);
  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'formular-stapel beleg-form';

  const hinweis = el('p', 'notiz beleg-hinweis', stand.hinweis ?? '');
  hinweis.setAttribute('role', 'status');
  hinweis.hidden = !stand.hinweis;

  const gesamtFehler = el('p', 'fehler beleg-gesamt');
  gesamtFehler.setAttribute('role', 'alert');
  gesamtFehler.hidden = true;

  // Seiten: Vorschau-Streifen, Seite hinzufügen (Scannen oder Foto wählen)
  const streifen = el('div', 'beleg-seiten');
  const hinzuKnopf = el('button', 'knopf', 'Seite hinzufügen');
  hinzuKnopf.type = 'button';
  hinzuKnopf.setAttribute('aria-expanded', 'false');
  hinzuKnopf.setAttribute('aria-controls', 'beleg-hinzu');
  const hinzu = el('div', 'beleg-hinzu');
  hinzu.id = 'beleg-hinzu';
  hinzu.hidden = true;
  hinzuKnopf.addEventListener('click', () => {
    const aufJetzt = hinzu.hidden;
    hinzu.hidden = !aufJetzt;
    hinzuKnopf.setAttribute('aria-expanded', String(aufJetzt));
  });
  const scanKnopf = el('button', 'knopf', 'Scannen');
  scanKnopf.type = 'button';
  scanKnopf.addEventListener('click', () => seiteScannen());
  const fotoKnopf = dateiKnopf('Foto wählen', BILD_AUSWAHL, true, (dateien) => seiteFotos(dateien));
  hinzu.append(scanKnopf, fotoKnopf);

  // Liest den aktuellen Stand aus dem Formular, bevor das Sheet neu aufgebaut wird
  const lesen = () => ({
    ...stand,
    seiten: [...seiten],
    felder: {
      datum: datumEl.value,
      betrag: betragEl.value,
      waehrung: waehrungEl.value,
      kategorie: kategorieEl.value,
      haendler: haendlerEl.value,
      beschreibung: beschreibungEl.value,
    },
    unsicher: [...offen],
    hinweis: '',
    status: abgegebenEl ? (abgegebenEl.checked ? 'abgegeben' : 'offen') : stand.status,
  });

  // Scannen und Foto ersetzen das Sheet: Stand merken, danach mit den neuen Seiten wieder aufbauen
  async function seiteScannen() {
    const vorher = lesen();
    let fehler = '';
    let blobs = [];
    kontext.sheet.schliessen();
    try {
      const ergebnis = await scannen(kontext, SCAN);
      blobs = ergebnis?.map((s) => s.blob).filter(Boolean) ?? [];
    } catch (e) {
      console.error(e);
      fehler = 'Der Scan hat nicht geklappt. Bitte noch einmal versuchen.';
    }
    formularOeffnen({
      ...vorher,
      seiten: [...vorher.seiten, ...blobs.map((blob) => ({ blob }))],
      hinweis: fehler || vorher.hinweis,
    }, kontext);
  }

  async function seiteFotos(dateien) {
    const vorher = lesen();
    const { blobs, fehler } = await fotosZuschneiden(dateien, kontext);
    formularOeffnen({
      ...vorher,
      seiten: [...vorher.seiten, ...blobs.map((blob) => ({ blob }))],
      hinweis: fehler || vorher.hinweis,
    }, kontext);
  }

  // Entfernen: die Seite fällt aus der Liste, das Sheet bleibt offen
  function streifenZeichnen() {
    if (!seiten.length) {
      streifen.replaceChildren(el('p', 'notiz beleg-leer', 'Noch keine Seite.'));
      return;
    }
    streifen.replaceChildren(...seiten.map((s, i) => seiteKarte(s, i)));
  }

  function seiteKarte(s, i) {
    const karte = el('div', 'beleg-seite');
    const weg = el('button', 'beleg-seite-entfernen', 'Entfernen');
    weg.type = 'button';
    weg.setAttribute('aria-label', `Seite ${i + 1} entfernen`);
    weg.addEventListener('click', () => {
      seiten = seiten.filter((x) => x !== s);
      streifenZeichnen();
      // Ein Entfernen zählt als ungesicherte Änderung
      form.dispatchEvent(new Event('input', { bubbles: true }));
      hinzuKnopf.focus();
    });
    karte.append(seiteVorschauKnopf(s, i), weg);
    return karte;
  }

  // Klein; Antippen vergrößert an Ort und Stelle (das Formular bleibt, wie es ist)
  function seiteVorschauKnopf(s, i) {
    const knopf = el('button', 'beleg-vorschau');
    knopf.type = 'button';
    knopf.setAttribute('aria-expanded', 'false');
    knopf.setAttribute('aria-label', `Seite ${i + 1}, antippen zum Vergrößern`);
    const platz = el('span', 'beleg-platzhalter', 'Wird geladen …');
    knopf.append(platz);
    knopf.addEventListener('click', () => {
      const gross = knopf.classList.toggle('gross');
      knopf.setAttribute('aria-expanded', String(gross));
    });
    s.vorschau ??= seiteVorschau(s);
    s.vorschau.then((v) => {
      if (!v) {
        platz.textContent = 'Auf diesem Gerät nicht vorhanden.';
        return;
      }
      const img = new Image();
      img.alt = `Seite ${i + 1}`;
      img.decoding = 'async';
      img.src = URL.createObjectURL(v.bild);
      knopf.replaceChildren(img);
      if (v.pdf) knopf.append(el('span', 'beleg-pdf', 'PDF'));
    }).catch(() => {
      platz.textContent = 'Die Seite konnte nicht geladen werden.';
    });
    return knopf;
  }

  // Felder
  const datumEl = document.createElement('input');
  datumEl.type = 'date';
  datumEl.id = 'beleg-datum';
  datumEl.name = 'datum';
  datumEl.autocomplete = 'off';
  datumEl.value = werte.datum;

  const betragEl = document.createElement('input');
  betragEl.type = 'text';
  betragEl.id = 'beleg-betrag';
  betragEl.name = 'betrag';
  betragEl.inputMode = 'decimal';
  betragEl.autocomplete = 'off';
  betragEl.value = werte.betrag;

  const waehrungEl = document.createElement('select');
  waehrungEl.id = 'beleg-waehrung';
  waehrungEl.name = 'waehrung';
  for (const w of WAEHRUNGEN) waehrungEl.append(new Option(w, w));
  waehrungEl.value = WAEHRUNGEN.includes(werte.waehrung) ? werte.waehrung : 'EUR';

  const kategorieEl = document.createElement('select');
  kategorieEl.id = 'beleg-kategorie';
  kategorieEl.name = 'kategorie';
  kategorieEl.append(new Option('Bitte wählen', ''));
  for (const name of KATEGORIE_NAMEN) kategorieEl.append(new Option(name, name));
  kategorieEl.value = werte.kategorie;

  const haendlerEl = document.createElement('input');
  haendlerEl.type = 'text';
  haendlerEl.id = 'beleg-haendler';
  haendlerEl.name = 'haendler';
  haendlerEl.autocomplete = 'organization';
  haendlerEl.value = werte.haendler;

  const beschreibungEl = document.createElement('input');
  beschreibungEl.type = 'text';
  beschreibungEl.id = 'beleg-beschreibung';
  beschreibungEl.name = 'beschreibung';
  beschreibungEl.autocomplete = 'off';
  beschreibungEl.placeholder = 'z. B. Tanken 207354 km S-AB1234';
  beschreibungEl.value = werte.beschreibung;

  const datumF = feldBauen('Datum', datumEl);
  const betragF = feldBauen('Betrag', betragEl);
  const waehrungF = feldBauen('Währung', waehrungEl);
  const kategorieF = feldBauen('Kategorie', kategorieEl);
  const haendlerF = feldBauen('Händler', haendlerEl);
  const beschreibungF = feldBauen('Beschreibung', beschreibungEl);
  const felderMap = { datum: datumF, betrag: betragF, waehrung: waehrungF, kategorie: kategorieF, haendler: haendlerF, beschreibung: beschreibungF };

  const betragZeile = el('div', 'beleg-betrag');
  betragZeile.append(betragF.box, waehrungF.box);

  // Gelesene Felder ohne Wert bekommen „bitte prüfen“; wer das Feld ändert, hat es geprüft
  for (const k of offen) if (felderMap[k]) unsicherSetzen(felderMap[k], true);
  for (const [k, f] of Object.entries(felderMap)) {
    f.input.addEventListener('input', () => {
      if (!offen.has(k)) return;
      offen.delete(k);
      unsicherSetzen(f, false);
    });
  }

  // Reisetag unter dem Datum: Dienstreise, wenn das Datum in eine Reise fällt
  const reiseZeile = el('p', 'notiz beleg-reise');
  reiseZeile.hidden = true;
  let reise = null;
  let reisenListe = [];
  function reisePruefen() {
    const tag = datumEl.value;
    reise = tag ? (reiseAm(tag, reisenListe) ?? null) : null;
    reiseZeile.textContent = reise ? `Dienstreise ${reise.ort}` : '';
    reiseZeile.hidden = !reise;
  }
  datumEl.addEventListener('input', reisePruefen);
  datumEl.addEventListener('change', reisePruefen);
  alle('reisen')
    .then((liste) => {
      reisenListe = liste ?? [];
      reisePruefen();
    })
    .catch((e) => console.warn('Reisen nicht geladen', e?.message));

  // Tanken: Beschreibung mit „Tanken  km “ und dem letzten Kennzeichen vorbelegen. Eigene Eingaben bleiben.
  let kennzeichen = '';
  let vorschlag = '';
  function tankenVorbelegen() {
    if (kategorieEl.value !== TANKEN) return;
    const jetzt = beschreibungEl.value;
    if (jetzt.trim() !== '' && jetzt !== vorschlag) return;
    vorschlag = `Tanken  km ${kennzeichen}`;
    beschreibungEl.value = vorschlag;
  }
  kategorieEl.addEventListener('change', tankenVorbelegen);
  alle('belege')
    .then((liste) => {
      kennzeichen = letztesKennzeichen(liste);
      tankenVorbelegen();
    })
    .catch((e) => console.warn('Belege nicht geladen', e?.message));

  // Bearbeiten: Schalter Abgegeben und Löschen
  let abgegebenEl = null;
  let abgegebenLabel = null;
  let loeschStart = null;
  let loeschZone = null;
  if (stand.id) {
    abgegebenEl = document.createElement('input');
    abgegebenEl.type = 'checkbox';
    abgegebenEl.name = 'abgegeben';
    abgegebenEl.setAttribute('role', 'switch');
    abgegebenEl.checked = stand.status === 'abgegeben';
    abgegebenLabel = el('label', 'beleg-schalter');
    abgegebenLabel.append(abgegebenEl, document.createTextNode('Abgegeben'));

    loeschStart = el('button', 'beleg-loeschen', 'Beleg löschen');
    loeschStart.type = 'button';
    loeschStart.addEventListener('click', () => rueckfrageZeigen());
    loeschZone = el('div', 'beleg-loeschen-zone');
    loeschZone.hidden = true;
  }

  function rueckfrageZeigen() {
    const frage = el('p', 'notiz', 'Diesen Beleg wirklich löschen?');
    frage.id = 'beleg-loeschen-frage';
    const nein = el('button', 'knopf', 'Nein, behalten');
    nein.type = 'button';
    nein.addEventListener('click', () => {
      loeschZone.replaceChildren();
      loeschZone.hidden = true;
      loeschStart.focus();
    });
    const ja = el('button', 'knopf gefahr', 'Ja, löschen');
    ja.type = 'button';
    ja.addEventListener('click', () => belegLoeschen());
    const reihe = el('div', 'beleg-fuss');
    reihe.append(nein, ja);
    loeschZone.replaceChildren(frage, reihe);
    loeschZone.hidden = false;
    nein.focus();
  }

  async function belegLoeschen() {
    if (beschaeftigt) return;
    beschaeftigt = true;
    try {
      await loeschen('belege', stand.id);
      kontext.sheet.schliessen();
    } catch (e) {
      console.error(e);
      gesamtFehler.textContent = 'Löschen hat nicht geklappt. Bitte noch einmal versuchen.';
      gesamtFehler.hidden = false;
      beschaeftigt = false;
    }
  }

  const abbrechenKnopf = el('button', 'knopf', 'Abbrechen');
  abbrechenKnopf.type = 'button';
  abbrechenKnopf.addEventListener('click', () => kontext.sheet.schliessen());
  const sichernKnopf = el('button', 'knopf haupt', 'Sichern');
  sichernKnopf.type = 'submit';
  const fuss = el('div', 'beleg-fuss');
  fuss.append(abbrechenKnopf, sichernKnopf);

  // Prüfen und sichern. Neue Seiten werden erst hier im Speicher abgelegt.
  async function absenden() {
    if (beschaeftigt) return;
    gesamtFehler.hidden = true;
    gesamtFehler.textContent = '';
    for (const f of Object.values(felderMap)) fehlerSetzen(f, '');

    const roh = betragEl.value.trim();
    const betragWert = roh === '' ? null : (betragLesen(roh) ?? null);
    const ungueltig = roh !== '' && (betragWert === null || Number.isNaN(betragWert));
    if (ungueltig) {
      fehlerSetzen(betragF, 'Betrag als Zahl, z. B. 12,50');
      betragEl.focus();
      return;
    }
    if (!seiten.length && betragWert === null) {
      gesamtFehler.textContent = 'Foto oder Betrag fehlt.';
      gesamtFehler.hidden = false;
      betragEl.focus();
      return;
    }

    beschaeftigt = true;
    sichernKnopf.disabled = true;
    try {
      const bilder = [];
      for (const s of seiten) bilder.push(s.blob ? await bildSpeichern(s.blob) : s.id);
      await speichern('belege', {
        ...(stand.beleg ?? {}),
        id: stand.id ?? null,
        datum: datumEl.value,
        betrag: betragWert,
        waehrung: waehrungEl.value,
        kategorie: kategorieEl.value,
        haendler: haendlerEl.value.trim(),
        beschreibung: beschreibungEl.value.trim(),
        bilder,
        status: abgegebenEl ? (abgegebenEl.checked ? 'abgegeben' : 'offen') : 'offen',
        erstellt: stand.erstellt ?? Date.now(),
        reiseId: reise?.reiseId ?? '',
        text: (stand.text ?? '').slice(0, 2000),
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
    hinweis,
    gruppe('Seiten', [streifen, hinzuKnopf, hinzu]),
    datumF.box,
    reiseZeile,
    betragZeile,
    kategorieF.box,
    haendlerF.box,
    beschreibungF.box,
    ...(abgegebenLabel ? [abgegebenLabel] : []),
    gesamtFehler,
    fuss,
    ...(loeschStart ? [loeschStart, loeschZone] : []),
  );

  streifenZeichnen();
  reisePruefen();
  tankenVorbelegen();
  kontext.sheet.oeffnen(stand.titel, form);
  // Das Sheet fokussiert das erste Eingabefeld; das ist hier der versteckte Datei-Knopf, deshalb nach vorn holen
  setTimeout(() => datumEl.focus({ preventScroll: true }), 0);
  return form;
}

// Auswahl am Anfang: Scannen, Foto (mehrere), PDF, ohne Foto. hinweis: Fehlertext von vorher (optional).
export function belegErfassen(kontext, hinweis = '') {
  const huelle = el('div', 'beleg-auswahl');
  const erklaerung = el('p', 'notiz', 'Scanne den Beleg, wähle ein Foto oder eine PDF. Die Schrift wird auf diesem Gerät erkannt, nichts geht in eine Cloud.');
  const status = el('p', 'notiz beleg-status', hinweis);
  status.setAttribute('role', 'status');
  status.classList.toggle('fehler', Boolean(hinweis));
  status.hidden = !hinweis;

  const scanKnopf = el('button', 'knopf haupt', 'Scannen');
  scanKnopf.type = 'button';
  scanKnopf.addEventListener('click', () => belegScannen(kontext));
  const fotoKnopf = dateiKnopf('Foto wählen', BILD_AUSWAHL, true, (dateien) => belegFotos(dateien, kontext));
  const pdfKnopf = dateiKnopf('PDF wählen', PDF_AUSWAHL, false, (dateien) => belegPdf(dateien[0], kontext));
  const ohneKnopf = el('button', 'knopf', 'Ohne Foto');
  ohneKnopf.type = 'button';
  ohneKnopf.addEventListener('click', () => {
    formularOeffnen({ titel: 'Beleg', felder: leereFelder(), seiten: [], text: '', hinweis: '', unsicher: [] }, kontext);
  });

  huelle.append(erklaerung, scanKnopf, fotoKnopf, pdfKnopf, ohneKnopf, status);
  kontext.sheet.oeffnen('Beleg erfassen', huelle);
}

// Scan: Auswahl schließen, der Scanner übernimmt. Ohne Ergebnis zurück zur Auswahl.
async function belegScannen(kontext) {
  kontext.sheet.schliessen();
  let blobs = [];
  try {
    const seiten = await scannen(kontext, SCAN);
    blobs = seiten?.map((s) => s.blob).filter(Boolean) ?? [];
  } catch (e) {
    console.error(e);
    belegErfassen(kontext, 'Der Scan hat nicht geklappt. Bitte noch einmal versuchen.');
    return;
  }
  if (!blobs.length) {
    belegErfassen(kontext);
    return;
  }
  await erkennenUndFormular(blobs.map((blob) => ({ blob })), kontext);
}

// Fotos aus der Mediathek: jedes zuschneiden, abgebrochene überspringen. Ohne Ergebnis zurück zur Auswahl.
async function belegFotos(dateien, kontext) {
  const { blobs, fehler } = await fotosZuschneiden(dateien, kontext);
  if (!blobs.length) {
    belegErfassen(kontext, fehler);
    return;
  }
  await erkennenUndFormular(blobs.map((blob) => ({ blob })), kontext);
}

// PDF: ganz übernommen, Erkennung über die erste Seite
async function belegPdf(datei, kontext) {
  if (!datei) return;
  await erkennenUndFormular([{ blob: datei }], kontext);
}

// Erkennung mit Fortschritt, danach das Formular mit den gelesenen Werten
async function erkennenUndFormular(seiten, kontext, zusatz = '') {
  const erg = await erkennungLaufen(seiten, kontext);
  const felder = erg.felder ?? leereFelder();
  formularOeffnen({
    titel: 'Beleg',
    seiten,
    felder,
    text: erg.text,
    hinweis: [zusatz, erg.fehler].filter(Boolean).join(' ') || HINWEIS_GELESEN,
    unsicher: ['datum', 'betrag'].filter((k) => !felder[k]),
  }, kontext);
}

// Bearbeiten: Formular mit den gespeicherten Werten und Bildern
export function belegBearbeiten(beleg, kontext) {
  formularOeffnen({
    titel: 'Beleg bearbeiten',
    id: beleg.id,
    erstellt: beleg.erstellt,
    beleg,
    status: beleg.status ?? 'offen',
    seiten: (beleg.bilder ?? []).map((id) => ({ id })),
    felder: {
      datum: beleg.datum ?? '',
      betrag: betragAnzeige(beleg.betrag),
      waehrung: beleg.waehrung ?? 'EUR',
      kategorie: beleg.kategorie ?? '',
      haendler: beleg.haendler ?? '',
      beschreibung: beleg.beschreibung ?? '',
    },
    text: beleg.text ?? '',
    hinweis: '',
    unsicher: [],
  }, kontext);
}
