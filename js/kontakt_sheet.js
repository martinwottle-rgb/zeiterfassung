// Kontakte in Sheets: erfassen (Foto, Zuschnitt, Texterkennung, Formular), bearbeiten und ansehen.
// Neue Fotos werden erst beim Sichern im Speicher abgelegt, damit Abbrechen keine Bilder ohne Kontakt hinterlässt.
// Beim Zuschneiden ersetzt das Zuschnitt-Sheet den Inhalt des Sheets; der Stand des Formulars wird deshalb
// vorher gelesen und danach wieder aufgebaut.
import { bildLaden, bildSpeichern, loeschen, speichern } from './speicher.js';
import { bildHolen, einrichtungLaden } from './abgleich.js';
import { kontaktName, vcard, visitenkarteLesen } from './kontakte.js';
import { textErkennen } from './ocr.js';
import { zuschneiden } from './zuschnitt.js';
import { uhrzeit } from './zeit.js';

const TIPP = 'Tipp: ins Feld tippen, gedrückt halten, Text scannen.';
const BILD_AUSWAHL = 'image/*,.heic,.heif';
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Felder des Formulars in der Reihenfolge der Anzeige, je Zeile eine Gruppe
const FELD = {
  titel: { name: 'Titel', ac: 'honorific-prefix' },
  vorname: { name: 'Vorname', ac: 'given-name' },
  nachname: { name: 'Nachname', ac: 'family-name' },
  firma: { name: 'Firma', ac: 'organization' },
  position: { name: 'Position', ac: 'organization-title' },
  telefon: { name: 'Telefon', typ: 'tel', ac: 'work tel' },
  mobil: { name: 'Mobil', typ: 'tel', ac: 'mobile tel' },
  email: { name: 'E-Mail', typ: 'email', ac: 'work email' },
  web: { name: 'Web', ac: 'url' },
  strasse: { name: 'Straße', ac: 'street-address' },
  plz: { name: 'PLZ', ac: 'postal-code', modus: 'numeric' },
  ort: { name: 'Ort', ac: 'address-level2' },
  land: { name: 'Land', ac: 'country-name' },
};
const FELDNAMEN = Object.keys(FELD);
const SPALTEN = [['titel'], ['vorname', 'nachname'], ['firma'], ['position'], ['telefon', 'mobil'], ['email'], ['web'], ['strasse'], ['plz', 'ort'], ['land']];

const leereFelder = () => Object.fromEntries(FELDNAMEN.map((k) => [k, '']));

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

function einrichtungVollstaendig(e) {
  return Boolean(e && e.repo && e.token && e.passwort && e.pfad);
}

// Outlook-Zustand für Liste und Detail: Art (offen, ok, fehler) und Text für Screenreader
export function outlookZustand(k) {
  const status = k?.outlook?.status;
  if (status === 'angelegt' || status === 'ergaenzt') return { art: 'ok', text: 'In Outlook', meldung: '' };
  if (status === 'fehler') return { art: 'fehler', text: 'Outlook-Fehler', meldung: k.outlook.meldung || '' };
  return { art: 'offen', text: 'Outlook ausstehend', meldung: '' };
}

// „27.10. um 10:42“ aus einem Zeitstempel in ms
function zeitText(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getDate()}.${d.getMonth() + 1}. um ${uhrzeit(d.getHours() * 60 + d.getMinutes())}`;
}

// Ein Satz für das Detail: Zustand, Meldung und Zeit
function outlookSatz(k) {
  const o = k.outlook ?? {};
  let satz;
  if (o.status === 'angelegt') satz = 'In Outlook angelegt';
  else if (o.status === 'ergaenzt') satz = 'In Outlook ergänzt';
  else if (o.status === 'fehler') satz = 'Outlook-Fehler';
  else satz = 'Outlook ausstehend, wird am Laptop beim nächsten Abgleich angelegt';
  return [satz, o.meldung, o.zeit ? `Stand ${zeitText(o.zeit)}` : ''].filter(Boolean).join('. ');
}

// Bild aus dem Speicher; fehlt es hier, aus dem Abgleich, wenn er eingerichtet ist. Sonst null.
async function bildBlob(id) {
  if (!id) return null;
  const lokal = await bildLaden(id);
  if (lokal) return lokal;
  const e = einrichtungLaden();
  if (!einrichtungVollstaendig(e)) return null;
  try {
    return await bildHolen(id, e);
  } catch (err) {
    console.warn('Bild nicht geholt', err?.message);
    return null;
  }
}

// Foto klein, Antippen vergrößert es an Ort und Stelle (kein Sheet-Wechsel, Eingaben bleiben)
function vorschau(quelle, alt) {
  const knopf = el('button', 'kontakt-vorschau');
  knopf.type = 'button';
  knopf.setAttribute('aria-expanded', 'false');
  knopf.setAttribute('aria-label', `${alt}, antippen zum Vergrößern`);
  const platz = el('span', 'kontakt-platzhalter', 'Wird geladen …');
  knopf.append(platz);
  knopf.addEventListener('click', () => {
    const gross = knopf.classList.toggle('gross');
    knopf.setAttribute('aria-expanded', String(gross));
  });
  (async () => {
    const blob = quelle.blob ?? await bildBlob(quelle.id);
    if (!blob) {
      platz.textContent = 'Auf diesem Gerät nicht vorhanden.';
      return;
    }
    const img = new Image();
    img.alt = alt;
    img.decoding = 'async';
    img.src = URL.createObjectURL(blob);
    knopf.replaceChildren(img);
  })().catch(() => {
    platz.textContent = 'Das Foto konnte nicht geladen werden.';
  });
  return knopf;
}

// Datei-Auswahl als Knopf: das Eingabefeld steckt im Label und ist für Screenreader und Tastatur erreichbar
function dateiKnopf(text, accept, onDatei, { haupt = false, kamera = false } = {}) {
  const label = el('label', `knopf kontakt-datei${haupt ? ' haupt' : ''}`);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.className = 'nur-sr';
  if (kamera) input.setAttribute('capture', 'environment');
  input.addEventListener('change', () => {
    const datei = input.files?.[0];
    input.value = '';
    if (datei) onDatei(datei);
  });
  label.append(input, document.createTextNode(text));
  return label;
}

// Gruppe mit Überschrift (fieldset), Inhalt untereinander
function gruppe(titel, inhalt, id) {
  const fs = el('fieldset', 'kontakt-gruppe');
  const legende = el('legend', 'kontakt-legende', titel);
  if (id) legende.id = id;
  fs.append(legende, ...inhalt);
  return fs;
}

function fehlerSetzen(feld, text) {
  feld.fehler.textContent = text ?? '';
  feld.fehler.hidden = !text;
  if (text) feld.input.setAttribute('aria-invalid', 'true');
  else feld.input.removeAttribute('aria-invalid');
}

function feldBauen(key, wert) {
  const def = FELD[key];
  const id = `kontakt-${key}`;
  const box = el('div', 'feld');
  const label = el('label', null, def.name);
  label.htmlFor = id;
  const input = document.createElement('input');
  input.type = def.typ ?? 'text';
  input.id = id;
  input.name = key;
  input.value = wert ?? '';
  input.autocomplete = def.ac;
  if (def.modus) input.inputMode = def.modus;
  if (def.typ === 'email') {
    input.autocapitalize = 'off';
    input.spellcheck = false;
  }
  const fehler = el('p', 'notiz fehler');
  fehler.id = `${id}-fehler`;
  fehler.hidden = true;
  input.setAttribute('aria-describedby', fehler.id);
  box.append(label, input, fehler);
  return { box, input, fehler };
}

// Formular für Erfassen und Bearbeiten. stand: { titel, id, erstellt, felder, rohText, notiz,
// bildKarte: {id} | {blob} | null, bildNotiz: {id} | {blob} | null, hinweis }.
function formularOeffnen(stand, kontext) {
  const felder = {};
  const werte = { ...leereFelder(), ...(stand.felder ?? {}) };
  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'formular-stapel kontakt-form';

  const hinweis = el('p', 'notiz kontakt-hinweis', stand.hinweis ?? '');
  hinweis.setAttribute('role', 'status');
  hinweis.hidden = !stand.hinweis;

  const kartenFoto = stand.bildKarte
    ? gruppe('Foto der Karte', [vorschau(stand.bildKarte, 'Foto der Visitenkarte')])
    : null;

  const feldTeile = SPALTEN.map((keys) => {
    const boxen = keys.map((k) => {
      const f = feldBauen(k, werte[k]);
      felder[k] = f;
      return f.box;
    });
    if (boxen.length === 1) return boxen[0];
    const zeile = el('div', 'kontakt-zwei');
    zeile.append(...boxen);
    return zeile;
  });

  // Text der Karte: Rohtext der Texterkennung, „Felder neu füllen“ ergänzt nur leere Felder
  const rohFeld = document.createElement('textarea');
  rohFeld.id = 'kontakt-rohtext';
  rohFeld.name = 'rohtext';
  rohFeld.rows = 4;
  rohFeld.spellcheck = false;
  rohFeld.value = stand.rohText ?? '';
  const rohTipp = el('p', 'notiz kontakt-tipp', TIPP);
  rohTipp.id = 'kontakt-rohtext-tipp';
  rohFeld.setAttribute('aria-describedby', rohTipp.id);
  rohFeld.setAttribute('aria-labelledby', 'kontakt-rohtext-titel');
  const fuellStatus = el('p', 'notiz kontakt-status');
  fuellStatus.setAttribute('role', 'status');
  const fuellKnopf = el('button', 'knopf kontakt-knopf-klein', 'Felder neu füllen');
  fuellKnopf.type = 'button';
  fuellKnopf.addEventListener('click', () => {
    const text = rohFeld.value.trim();
    if (!text) {
      fuellStatus.textContent = 'Im Text der Karte steht nichts.';
      return;
    }
    const gelesen = visitenkarteLesen(text);
    let anzahl = 0;
    for (const k of FELDNAMEN) {
      const feld = felder[k];
      if (feld.input.value.trim() === '' && (gelesen[k] ?? '').trim() !== '') {
        feld.input.value = gelesen[k];
        anzahl += 1;
      }
    }
    fuellStatus.textContent = anzahl === 0
      ? 'Keine leeren Felder zum Ergänzen.'
      : `${anzahl} ${anzahl === 1 ? 'Feld' : 'Felder'} ergänzt.`;
  });
  const rohGruppe = gruppe('Text der Karte', [rohFeld, rohTipp, fuellKnopf, fuellStatus], 'kontakt-rohtext-titel');

  // Notiz mit optionalem Foto (gleiche Auswahl wie bei der Karte, mit Zuschnitt)
  const notizFeld = document.createElement('textarea');
  notizFeld.id = 'kontakt-notiz';
  notizFeld.name = 'notiz';
  notizFeld.rows = 4;
  notizFeld.value = stand.notiz ?? '';
  const notizTipp = el('p', 'notiz kontakt-tipp', TIPP);
  notizTipp.id = 'kontakt-notiz-tipp';
  notizFeld.setAttribute('aria-describedby', notizTipp.id);
  notizFeld.setAttribute('aria-labelledby', 'kontakt-notiz-titel');

  // Liest den aktuellen Stand aus den Feldern, bevor das Sheet neu aufgebaut wird
  const lesen = () => ({
    ...stand,
    felder: Object.fromEntries(FELDNAMEN.map((k) => [k, felder[k].input.value])),
    rohText: rohFeld.value,
    notiz: notizFeld.value,
    hinweis: '',
  });

  // Zuschnitt ersetzt das Sheet; danach wird das Formular mit dem gemerkten Stand neu aufgebaut
  const notizFoto = async (datei) => {
    const vorher = lesen();
    let blob = null;
    try {
      blob = await zuschneiden(datei, kontext);
    } catch (e) {
      formularOeffnen({ ...vorher, hinweis: e?.message || 'Das Foto konnte nicht geöffnet werden.' }, kontext);
      return;
    }
    formularOeffnen({ ...vorher, bildNotiz: blob ? { blob } : vorher.bildNotiz }, kontext);
  };
  const notizBilder = [];
  if (stand.bildNotiz) notizBilder.push(vorschau(stand.bildNotiz, 'Foto der Notiz'));
  const notizGruppe = gruppe('Notiz', [
    notizFeld,
    notizTipp,
    ...notizBilder,
    dateiKnopf('Foto der Notiz hinzufügen', BILD_AUSWAHL, notizFoto),
  ], 'kontakt-notiz-titel');

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

  form.replaceChildren(
    hinweis,
    ...(kartenFoto ? [kartenFoto] : []),
    ...feldTeile,
    rohGruppe,
    notizGruppe,
    gesamtFehler,
    fuss,
  );

  let beschaeftigt = false;

  async function absenden() {
    if (beschaeftigt) return;
    gesamtFehler.hidden = true;
    gesamtFehler.textContent = '';
    for (const k of FELDNAMEN) fehlerSetzen(felder[k], '');

    const v = (k) => felder[k].input.value.trim();
    let ersterFehler = null;
    if (!v('vorname') && !v('nachname') && !v('firma')) {
      fehlerSetzen(felder.nachname, 'Bitte mindestens Name oder Firma angeben.');
      ersterFehler = felder.nachname.input;
    }
    if (v('email') && !MAIL.test(v('email'))) {
      fehlerSetzen(felder.email, 'Bitte eine E-Mail-Adresse angeben, zum Beispiel name@firma.de.');
      ersterFehler ??= felder.email.input;
    }
    if (ersterFehler) {
      ersterFehler.focus();
      return;
    }

    beschaeftigt = true;
    sichernKnopf.disabled = true;
    try {
      const daten = {};
      for (const k of FELDNAMEN) daten[k] = v(k);
      daten.notiz = notizFeld.value.trim();
      // Neue Fotos jetzt ablegen, vorhandene Ids bleiben
      let bildKarte = stand.bildKarte?.id ?? null;
      if (stand.bildKarte?.blob) bildKarte = await bildSpeichern(stand.bildKarte.blob);
      let bildNotiz = stand.bildNotiz?.id ?? null;
      if (stand.bildNotiz?.blob) bildNotiz = await bildSpeichern(stand.bildNotiz.blob);
      await speichern('kontakte', {
        ...daten,
        id: stand.id ?? null,
        bildKarte,
        bildNotiz,
        erstellt: stand.erstellt ?? Date.now(),
        outlook: { status: 'offen' },
      });
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

  kontext.sheet.oeffnen(stand.titel, form);
  return form;
}

// Kontakt erfassen: Auswahl, Foto, Zuschnitt, Texterkennung, Formular
export function kontaktErfassen(kontext) {
  const huelle = el('div', 'kontakt-auswahl');
  const erklaerung = el('p', 'notiz', 'Fotografiere die Visitenkarte oder wähle ein Foto. Die Schrift wird auf diesem Gerät erkannt, nichts geht in eine Cloud.');
  const status = el('p', 'notiz kontakt-status');
  status.setAttribute('role', 'status');
  status.hidden = true;
  const meldung = (text) => {
    status.textContent = text;
    status.classList.add('fehler');
    status.hidden = false;
  };

  const ohneFoto = el('button', 'knopf', 'Ohne Foto eingeben');
  ohneFoto.type = 'button';
  ohneFoto.addEventListener('click', () => {
    formularOeffnen({ titel: 'Kontakt erfassen', felder: leereFelder(), rohText: '', notiz: '', bildKarte: null, bildNotiz: null }, kontext);
  });

  const kamera = dateiKnopf('Visitenkarte fotografieren', 'image/*', (datei) => kartenFoto(datei), { haupt: true, kamera: true });
  const fotos = dateiKnopf('Bild aus Fotos wählen', BILD_AUSWAHL, (datei) => kartenFoto(datei));

  // Zuschnitt, dann Texterkennung mit Fortschritt, dann das Formular mit den erkannten Feldern
  async function kartenFoto(datei) {
    status.hidden = true;
    let blob = null;
    try {
      blob = await zuschneiden(datei, kontext);
    } catch (e) {
      meldung(e?.message || 'Das Foto konnte nicht verarbeitet werden.');
      return;
    }
    if (!blob) return;
    await textLesen(blob);
  }

  async function textLesen(blob) {
    const titel = el('p', 'kontakt-fortschritt-titel', 'Text wird erkannt …');
    titel.id = 'kontakt-ocr-titel';
    const balken = document.createElement('progress');
    balken.className = 'kontakt-fortschritt';
    balken.max = 100;
    balken.value = 0;
    balken.setAttribute('aria-labelledby', titel.id);
    const prozent = el('p', 'notiz zahl', '0 %');
    const huelle2 = el('div', 'kontakt-fortschritt-huelle');
    huelle2.append(titel, balken, prozent);
    kontext.sheet.oeffnen('Visitenkarte lesen', huelle2);

    let text = '';
    let hinweis = '';
    try {
      text = await textErkennen(blob, (p) => {
        const wert = Math.round(Math.min(Math.max(Number.isFinite(p) ? p : 0, 0), 1) * 100);
        balken.value = wert;
        prozent.textContent = `${wert} %`;
      });
    } catch (e) {
      console.error(e);
      hinweis = `${e?.message || 'Die Texterkennung hat nicht geklappt.'} Bitte die Felder von Hand ausfüllen.`;
    }
    const gelesen = text ? visitenkarteLesen(text) : leereFelder();
    formularOeffnen({
      titel: 'Kontakt erfassen',
      felder: { ...leereFelder(), ...gelesen },
      rohText: text,
      notiz: '',
      bildKarte: { blob },
      bildNotiz: null,
      hinweis,
    }, kontext);
  }

  huelle.append(erklaerung, kamera, fotos, ohneFoto, status);
  kontext.sheet.oeffnen('Kontakt erfassen', huelle);
}

// Bearbeiten: Formular mit den Werten des Kontakts (Outlook-Zustand wird beim Sichern zurückgesetzt)
function kontaktBearbeiten(k, kontext) {
  formularOeffnen({
    titel: 'Kontakt bearbeiten',
    id: k.id,
    erstellt: k.erstellt,
    felder: Object.fromEntries(FELDNAMEN.map((key) => [key, k[key] ?? ''])),
    rohText: '',
    notiz: k.notiz ?? '',
    bildKarte: k.bildKarte ? { id: k.bildKarte } : null,
    bildNotiz: k.bildNotiz ? { id: k.bildNotiz } : null,
    hinweis: '',
  }, kontext);
}

// Dateiname für die vCard: Name ohne Zeichen, die Dateisysteme nicht mögen
function vcardDateiname(k) {
  const name = kontaktName(k).replace(/[\\/:*?"<>|]/g, '').trim();
  return `${name || 'Kontakt'}.vcf`;
}

// Detail: Kopf, Aktionen, Angaben, Notiz, Fotos, Outlook-Zustand, Löschen mit Rückfrage
export function kontaktOeffnen(kontakt, kontext) {
  const k = kontakt;
  const name = kontaktName(k);
  let beschaeftigt = false;

  const huelle = el('div', 'kontakt-detail');
  const kopf = el('div', 'kontakt-detail-kopf');
  if (k.firma) kopf.append(el('p', 'kontakt-firma', k.firma));
  if (k.position) kopf.append(el('p', 'notiz', k.position));

  const status = el('p', 'notiz kontakt-status');
  status.setAttribute('role', 'status');
  const statusSetzen = (text, fehler = false) => {
    status.textContent = text;
    status.classList.toggle('fehler', fehler);
  };

  // Aktionen
  const aktionen = el('div', 'kontakt-aktionen');
  const hinzu = el('button', 'knopf haupt kontakt-breit', 'Zu Kontakten hinzufügen');
  hinzu.type = 'button';
  hinzu.addEventListener('click', () => vcardTeilen());

  const nummer = k.telefon || k.mobil;
  if (nummer) {
    const anruf = el('a', 'knopf', 'Anrufen');
    anruf.href = `tel:${nummer.replace(/[^\d+]/g, '')}`;
    aktionen.append(anruf);
  }
  if (k.email) {
    const mail = el('a', 'knopf', 'E-Mail');
    mail.href = `mailto:${k.email}`;
    aktionen.append(mail);
  }
  const bearbeiten = el('button', 'knopf', 'Bearbeiten');
  bearbeiten.type = 'button';
  bearbeiten.addEventListener('click', () => kontaktBearbeiten(k, kontext));
  const loeschStart = el('button', 'knopf gefahr', 'Löschen');
  loeschStart.type = 'button';
  loeschStart.addEventListener('click', () => rueckfrageZeigen());
  aktionen.append(hinzu, bearbeiten, loeschStart);

  // Angaben als Liste
  const adresse = [k.strasse, [k.plz, k.ort].filter(Boolean).join(' '), k.land].filter(Boolean).join(', ');
  const angaben = [
    ['Telefon', k.telefon],
    ['Mobil', k.mobil],
    ['E-Mail', k.email],
    ['Web', k.web],
    ['Adresse', adresse],
  ].filter(([, wert]) => wert);
  const liste = el('dl', 'liste kontakt-angaben');
  for (const [bezeichnung, wert] of angaben) {
    const zeile = el('div', 'kontakt-angabe');
    zeile.append(el('dt', null, bezeichnung), el('dd', null, wert));
    liste.append(zeile);
  }

  // Notiz und Fotos
  const bloecke = [];
  if (k.notiz) {
    const notizKarte = el('section', 'karte kontakt-block');
    notizKarte.append(el('h2', null, 'Notiz'), el('p', 'kontakt-notiz-text', k.notiz));
    bloecke.push(notizKarte);
  }
  if (k.bildKarte || k.bildNotiz) {
    const fotos = el('section', 'karte kontakt-block');
    fotos.append(el('h2', null, 'Fotos'));
    const reihe = el('div', 'kontakt-bilder');
    if (k.bildKarte) reihe.append(vorschau({ id: k.bildKarte }, 'Foto der Visitenkarte'));
    if (k.bildNotiz) reihe.append(vorschau({ id: k.bildNotiz }, 'Foto der Notiz'));
    fotos.append(reihe);
    bloecke.push(fotos);
  }

  const outlook = el('section', 'karte kontakt-block');
  outlook.append(el('h2', null, 'Outlook'), el('p', 'notiz', outlookSatz(k)));
  bloecke.push(outlook);

  // Löschen: Rückfrage in der Zone unten, der Kontakt bleibt in Outlook
  const loeschZone = el('div', 'kontakt-loeschen');
  loeschZone.hidden = true;

  function rueckfrageZeigen() {
    const frage = el('p', 'notiz', `„${name}“ wirklich löschen? Der Eintrag in Outlook bleibt unberührt.`);
    frage.id = 'kontakt-loeschen-frage';
    const nein = el('button', 'knopf', 'Nein, behalten');
    nein.type = 'button';
    nein.addEventListener('click', () => {
      loeschZone.replaceChildren();
      loeschZone.hidden = true;
      loeschStart.focus();
    });
    const ja = el('button', 'knopf gefahr', 'Ja, löschen');
    ja.type = 'button';
    ja.addEventListener('click', () => loeschenBestaetigt());
    const reihe = el('div', 'kontakt-fuss');
    reihe.append(nein, ja);
    loeschZone.replaceChildren(frage, reihe);
    loeschZone.hidden = false;
    nein.focus();
  }

  async function loeschenBestaetigt() {
    if (beschaeftigt) return;
    beschaeftigt = true;
    try {
      await loeschen('kontakte', k.id);
      kontext.sheet.schliessen();
    } catch (e) {
      console.error(e);
      statusSetzen('Löschen hat nicht geklappt. Bitte noch einmal versuchen.', true);
      beschaeftigt = false;
    }
  }

  // vCard als Datei: Web Share, sonst Download
  async function vcardTeilen() {
    if (beschaeftigt) return;
    statusSetzen('');
    const datei = new File([vcard(k)], vcardDateiname(k), { type: 'text/vcard' });
    try {
      if (navigator.canShare?.({ files: [datei] }) && navigator.share) {
        await navigator.share({ files: [datei], title: name });
        return;
      }
      const url = URL.createObjectURL(datei);
      const a = document.createElement('a');
      a.href = url;
      a.download = datei.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      statusSetzen(`Die Datei ${datei.name} ist geladen. Öffne sie, um den Kontakt anzulegen.`);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.error(e);
      statusSetzen('Die Datei konnte nicht weitergegeben werden.', true);
    }
  }

  huelle.append(kopf, aktionen, status, liste, ...bloecke, loeschZone);
  kontext.sheet.oeffnen(name, huelle);
}
