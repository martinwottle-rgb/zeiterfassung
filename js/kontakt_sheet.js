// Kontakte in Sheets: erfassen (Foto, Zuschnitt, Erkennung, Formular), bearbeiten und ansehen.
// Neue Fotos werden erst beim Sichern im Speicher abgelegt, damit Abbrechen keine Bilder ohne Kontakt hinterlässt.
// Beim Zuschneiden ersetzt das Zuschnitt-Sheet den Inhalt des Sheets; der Stand des Formulars wird deshalb
// vorher gelesen und danach wieder aufgebaut.
import { bildLaden, bildSpeichern, loeschen, speichern } from './speicher.js';
import { bildHolen, einrichtungLaden } from './abgleich.js';
import { kontaktName, vcard, visitenkarteLesen } from './kontakte.js';
import { kontaktAusBild } from './kontakt_erkennung.js';
import { zuschneiden } from './zuschnitt.js';
import { uhrzeit } from './zeit.js';

const TIPP = 'Tipp: ins Feld tippen, gedrückt halten, Text scannen.';
const ANLEITUNG = 'Tippe ins Feld, dann auf das Kamera-Symbol über der Tastatur oder halte gedrückt und wähle ‚Text scannen‘. Halte die Kamera auf die Karte und tippe ‚Einsetzen‘.';
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

// Nur von Martin geprüfte Kontakte gehen an Outlook; ungeprüfte (z. B. vom iPhone) bleiben in der Liste markiert
export function istUngeprueft(k) {
  return !k.geloescht && k.geprueft !== true;
}

// Outlook-Zustand für Liste und Detail: Art (offen, ok, fehler) und Text für Screenreader
export function outlookZustand(k) {
  const status = k?.outlook?.status;
  if (status === 'angelegt' || status === 'ergaenzt' || status === 'aktualisiert') return { art: 'ok', text: 'In Outlook', meldung: '' };
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
  if (k.geprueft !== true) satz = 'Noch nicht geprüft: neu einlesen oder bearbeiten und sichern, dann geht er nach Outlook';
  else if (o.status === 'angelegt') satz = 'In Outlook angelegt';
  else if (o.status === 'ergaenzt') satz = 'In Outlook ergänzt';
  else if (o.status === 'aktualisiert') satz = 'In Outlook aktualisiert';
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

// Hinweis „bitte prüfen“ für ein aus dem Foto gelesenes Feld
function unsicherSetzen(feld, an) {
  feld.box.classList.toggle('kontakt-unsicher', an);
  feld.unsicher.hidden = !an;
  feld.input.setAttribute('aria-describedby', an ? `${feld.fehler.id} ${feld.unsicher.id}` : feld.fehler.id);
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
  const unsicher = el('p', 'notiz kontakt-unsicher-hinweis', 'bitte prüfen');
  unsicher.id = `${id}-unsicher`;
  unsicher.hidden = true;
  const fehler = el('p', 'notiz fehler');
  fehler.id = `${id}-fehler`;
  fehler.hidden = true;
  input.setAttribute('aria-describedby', fehler.id);
  box.append(label, input, unsicher, fehler);
  return { box, input, fehler, unsicher };
}

// Quelle der Erkennung als Satz für das Formular
function quelleText(quelle) {
  if (quelle === 'qr') return 'Aus dem QR-Code übernommen';
  if (quelle === 'qr+ocr') return 'Aus dem QR-Code übernommen, der Rest aus dem Foto gelesen, bitte prüfen';
  if (quelle === 'ocr') return 'Aus dem Foto gelesen, bitte prüfen';
  return '';
}

// Fortschritt der Erkennung im Sheet. Liefert die Rückruffunktion für kontaktAusBild.
function fortschrittZeigen(kontext) {
  const titel = el('p', 'kontakt-fortschritt-titel', 'Text wird erkannt …');
  titel.id = 'kontakt-ocr-titel';
  const balken = document.createElement('progress');
  balken.className = 'kontakt-fortschritt';
  balken.max = 100;
  balken.value = 0;
  balken.setAttribute('aria-labelledby', titel.id);
  const prozent = el('p', 'notiz zahl', '0 %');
  const huelle = el('div', 'kontakt-fortschritt-huelle');
  huelle.append(titel, balken, prozent);
  kontext.sheet.oeffnen('Visitenkarte lesen', huelle);
  return (p) => {
    const wert = Math.round(Math.min(Math.max(Number.isFinite(p) ? p : 0, 0), 1) * 100);
    balken.value = wert;
    prozent.textContent = `${wert} %`;
  };
}

// Foto lesen (mit Fortschrittsanzeige). Fehler werden als Hinweis zurückgegeben, nie geworfen.
async function bildLesen(blob, kontext) {
  const zeigen = fortschrittZeigen(kontext);
  try {
    const erg = await kontaktAusBild(blob, zeigen);
    return {
      felder: erg?.felder ?? {},
      quelle: erg?.quelle ?? '',
      unsicher: erg?.unsicher ?? [],
      text: erg?.text ?? '',
      fehler: '',
    };
  } catch (e) {
    console.error(e);
    return {
      felder: {},
      quelle: '',
      unsicher: [],
      text: '',
      fehler: `${e?.message || 'Die Texterkennung hat nicht geklappt.'} Bitte die Felder von Hand ausfüllen.`,
    };
  }
}

// Formular für Erfassen und Bearbeiten. stand: { titel, id, erstellt, felder, rohText, notiz,
// bildKarte: {id} | {blob} | null, bildNotiz: {id} | {blob} | null, hinweis, quelle, unsicher,
// outlook, anleitung (Anleitung für „Text scannen“), fokus (Feld „Text der Karte“ fokussieren) }.
function formularOeffnen(stand, kontext) {
  const felder = {};
  const werte = { ...leereFelder(), ...(stand.felder ?? {}) };
  const offen = new Set((stand.unsicher ?? []).filter((k) => FELD[k]));
  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'formular-stapel kontakt-form';

  const hinweis = el('p', 'notiz kontakt-hinweis', stand.hinweis ?? '');
  hinweis.setAttribute('role', 'status');
  hinweis.hidden = !stand.hinweis;

  const quelleZeile = el('p', 'notiz kontakt-quelle', stand.quelle ?? '');
  quelleZeile.hidden = !stand.quelle;

  const kartenFoto = stand.bildKarte
    ? gruppe('Foto der Karte', [vorschau(stand.bildKarte, 'Foto der Visitenkarte')])
    : null;

  const feldTeile = SPALTEN.map((keys) => {
    const boxen = keys.map((k) => {
      const f = feldBauen(k, werte[k]);
      felder[k] = f;
      if (offen.has(k)) unsicherSetzen(f, true);
      // Wer das Feld ändert, hat es geprüft: der Hinweis verschwindet
      f.input.addEventListener('input', () => {
        if (!offen.has(k)) return;
        offen.delete(k);
        unsicherSetzen(f, false);
      });
      return f.box;
    });
    if (boxen.length === 1) return boxen[0];
    const zeile = el('div', 'kontakt-zwei');
    zeile.append(...boxen);
    return zeile;
  });

  // Text der Karte: Rohtext der Erkennung oder eines iPhone-Scans. Eingabe füllt leere Felder,
  // „Alle Felder neu füllen“ überschreibt alle.
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

  // Werte aus dem Text in die Felder. nurLeere: bestehende Angaben bleiben.
  const einfuellen = (nurLeere) => {
    const gelesen = visitenkarteLesen(rohFeld.value.trim());
    let anzahl = 0;
    for (const k of FELDNAMEN) {
      const feld = felder[k];
      const neu = (gelesen[k] ?? '').trim();
      if (nurLeere && (feld.input.value.trim() !== '' || neu === '')) continue;
      if (feld.input.value === neu) continue;
      feld.input.value = neu;
      offen.delete(k);
      unsicherSetzen(feld, false);
      anzahl += 1;
    }
    return anzahl;
  };

  // Eingabe in den Text: entprellt 400 ms, nur leere Felder werden gefüllt
  let entprellt = null;
  rohFeld.addEventListener('input', () => {
    clearTimeout(entprellt);
    entprellt = setTimeout(() => {
      if (!rohFeld.value.trim()) return;
      const anzahl = einfuellen(true);
      fuellStatus.textContent = anzahl === 0
        ? 'Keine leeren Felder zum Ergänzen.'
        : `${anzahl} ${anzahl === 1 ? 'Feld' : 'Felder'} ergänzt.`;
    }, 400);
  });

  const alleKnopf = el('button', 'knopf kontakt-knopf-klein', 'Alle Felder neu füllen');
  alleKnopf.type = 'button';
  alleKnopf.addEventListener('click', () => {
    if (!rohFeld.value.trim()) {
      fuellStatus.textContent = 'Im Text der Karte steht nichts.';
      return;
    }
    einfuellen(false);
    fuellStatus.textContent = 'Alle Felder neu gefüllt.';
  });

  const anleitung = el('p', 'notiz kontakt-anleitung', ANLEITUNG);
  anleitung.hidden = !stand.anleitung;
  const rohGruppe = gruppe(
    'Text der Karte',
    [anleitung, rohFeld, rohTipp, alleKnopf, fuellStatus],
    'kontakt-rohtext-titel',
  );

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
    unsicher: [...offen],
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
    quelleZeile,
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
      // Outlook: der bisherige Status merkt sich in vorher, damit eigene Outlook-Kontakte korrigiert werden
      const alt = stand.outlook ?? {};
      const vorher = alt.status === 'offen' ? (alt.vorher ?? '') : (alt.status ?? '');
      await speichern('kontakte', {
        ...daten,
        id: stand.id ?? null,
        bildKarte,
        bildNotiz,
        erstellt: stand.erstellt ?? Date.now(),
        geprueft: true,
        outlook: { status: 'offen', vorher, entryId: alt.entryId ?? '' },
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
  if (stand.fokus) setTimeout(() => rohFeld.focus(), 0);
  return form;
}

// Kontakt erfassen: Auswahl, Foto, Zuschnitt, Erkennung, Formular; oder direkt „Text scannen“ (iPhone)
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

  const textScan = el('button', 'knopf', 'Text scannen (iPhone)');
  textScan.type = 'button';
  textScan.addEventListener('click', () => {
    formularOeffnen({
      titel: 'Kontakt erfassen',
      felder: leereFelder(),
      rohText: '',
      notiz: '',
      bildKarte: null,
      bildNotiz: null,
      anleitung: true,
      fokus: true,
    }, kontext);
  });

  const kamera = dateiKnopf('Visitenkarte fotografieren', 'image/*', (datei) => kartenFoto(datei), { haupt: true, kamera: true });
  const fotos = dateiKnopf('Bild aus Fotos wählen', BILD_AUSWAHL, (datei) => kartenFoto(datei));

  // Zuschnitt, dann Erkennung mit Fortschritt, dann das Formular mit den erkannten Feldern
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
    const erg = await bildLesen(blob, kontext);
    formularOeffnen({
      titel: 'Kontakt erfassen',
      felder: { ...leereFelder(), ...erg.felder },
      rohText: erg.text,
      notiz: '',
      bildKarte: { blob },
      bildNotiz: null,
      hinweis: erg.fehler,
      quelle: quelleText(erg.quelle),
      unsicher: erg.unsicher,
    }, kontext);
  }

  huelle.append(erklaerung, kamera, fotos, textScan, ohneFoto, status);
  kontext.sheet.oeffnen('Kontakt erfassen', huelle);
}

// Bearbeiten: Formular mit den Werten des Kontakts (Outlook-Stand wird beim Sichern neu gesetzt)
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
    outlook: k.outlook,
  }, kontext);
}

// Dateiname für die vCard: Name ohne Zeichen, die Dateisysteme nicht mögen
function vcardDateiname(k) {
  const name = kontaktName(k).replace(/[\\/:*?"<>|]/g, '').trim();
  return `${name || 'Kontakt'}.vcf`;
}

// Symbole der Aktionsreihe (Linien, wie die übrigen Symbole der App)
const SYMBOL = {
  anruf: '<path d="M6.6 3.5h2.4l1.4 3.8-1.8 1.4a11 11 0 0 0 5.7 5.7l1.4-1.8 3.8 1.4v2.4a2 2 0 0 1-2.2 2A16 16 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/>',
  mobil: '<rect x="7" y="2.8" width="10" height="18.4" rx="2.4"/><path d="M11 17.6h2"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/>',
  zuKontakten: '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 19.5c.8-3 3.3-4.6 6.5-4.6s5.7 1.6 6.5 4.6M18 8v6M15 11h6"/>',
  einlesen: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7"/>',
};

function symbol(name) {
  const huelle = document.createElement('div');
  huelle.innerHTML = `<svg class="kontakt-seite-symbol" viewBox="0 0 24 24" aria-hidden="true">${SYMBOL[name]}</svg>`;
  return huelle.firstElementChild;
}

// Runder Knopf mit Beschriftung darunter (wie die Aktionsreihe in iOS). Mit href ein Link, sonst ein Knopf.
function aktion(symbolName, text, { href = null, klick = null } = {}) {
  const knopf = el(href ? 'a' : 'button', 'kontakt-seite-aktion');
  if (href) {
    knopf.href = href;
  } else {
    knopf.type = 'button';
    knopf.addEventListener('click', klick);
  }
  const rund = el('span', 'kontakt-seite-rund');
  rund.setAttribute('aria-hidden', 'true');
  rund.append(symbol(symbolName));
  knopf.append(rund, el('span', 'kontakt-seite-aktion-text', text));
  return knopf;
}

const telLink = (nummer) => `tel:${String(nummer).replace(/[^\d+]/g, '')}`;
const webLink = (web) => (/^https?:\/\//i.test(web) ? web : `https://${web}`);

// Abschnitt mit Überschrift und abgerundeter Liste. zeilen: [Bezeichnung, Wert, Link oder null]
function gruppeListe(titel, zeilen) {
  const abschnitt = el('section', 'kontakt-seite-abschnitt');
  abschnitt.append(el('h2', 'kontakt-seite-ueberschrift', titel));
  const karte = el('dl', 'kontakt-seite-karte');
  for (const [bezeichnung, wert, link] of zeilen) {
    const zeile = el('div', 'kontakt-seite-angabe');
    const dd = el('dd');
    if (link) {
      const a = el('a', null, wert);
      a.href = link;
      dd.append(a);
    } else {
      dd.textContent = wert;
    }
    zeile.append(el('dt', null, bezeichnung), dd);
    karte.append(zeile);
  }
  abschnitt.append(karte);
  return abschnitt;
}

// Abschnitt mit Überschrift und einer Karte für freien Text oder Fotos
function abschnittKarte(titel, inhalt, klasse = 'kontakt-seite-text') {
  const abschnitt = el('section', 'kontakt-seite-abschnitt');
  abschnitt.append(el('h2', 'kontakt-seite-ueberschrift', titel));
  const karte = el('div', 'kontakt-seite-karte');
  const huelle = el('div', klasse);
  huelle.append(...inhalt);
  karte.append(huelle);
  abschnitt.append(karte);
  return abschnitt;
}

// Detailseite eines Kontakts in ziel (bildschirmfüllend, mit Zurück links). kontakt null: nicht (mehr) vorhanden.
export async function kontaktSeiteZeichnen(ziel, kontakt, kontext) {
  const seite = el('div', 'kontakt-seite');
  const kopf = el('header', 'kontakt-seite-kopf');
  const zurueck = el('a', 'kontakt-seite-zurueck');
  zurueck.href = '#kontakte';
  zurueck.setAttribute('aria-label', 'Zurück zu den Kontakten');
  const pfeil = el('span', null, '‹');
  pfeil.setAttribute('aria-hidden', 'true');
  zurueck.append(pfeil, el('span', null, 'Kontakte'));
  kopf.append(zurueck);
  const inhalt = el('div', 'kontakt-seite-inhalt');
  seite.append(kopf, inhalt);

  if (!kontakt) {
    const titel = el('h1', null, 'Kontakt');
    titel.tabIndex = -1;
    const hinweis = el('p', 'notiz kontakt-seite-fehlt', 'Diesen Kontakt gibt es nicht mehr.');
    const zurueckKnopf = el('a', 'knopf', 'Zu den Kontakten');
    zurueckKnopf.href = '#kontakte';
    inhalt.append(titel, hinweis, zurueckKnopf);
    ziel.replaceChildren(seite);
    titel.focus({ preventScroll: true });
    return;
  }

  const k = kontakt;
  const name = kontaktName(k);
  let beschaeftigt = false;

  const bearbeiten = el('button', 'kontakt-seite-kopf-knopf', 'Bearbeiten');
  bearbeiten.type = 'button';
  bearbeiten.addEventListener('click', () => kontaktBearbeiten(k, kontext));
  kopf.append(bearbeiten);

  // Name groß, darunter Position und Firma
  const namen = el('div', 'kontakt-seite-namen');
  const titel = el('h1', null, name);
  titel.tabIndex = -1;
  namen.append(titel);
  if (k.position) namen.append(el('p', 'kontakt-seite-zeile', k.position));
  if (k.firma) namen.append(el('p', 'kontakt-seite-zeile kontakt-seite-firma', k.firma));

  const status = el('p', 'notiz kontakt-status');
  status.setAttribute('role', 'status');
  const statusSetzen = (text, fehler = false) => {
    status.textContent = text;
    status.classList.toggle('fehler', fehler);
  };

  // Aktionsreihe
  const aktionen = el('div', 'kontakt-seite-aktionen');
  if (k.telefon) aktionen.append(aktion('anruf', 'Anrufen', { href: telLink(k.telefon) }));
  if (k.mobil) aktionen.append(aktion('mobil', 'Mobil', { href: telLink(k.mobil) }));
  if (k.email) aktionen.append(aktion('mail', 'E-Mail', { href: `mailto:${k.email}` }));
  aktionen.append(aktion('zuKontakten', 'Zu Kontakten', { klick: () => vcardTeilen() }));
  if (k.bildKarte) aktionen.append(aktion('einlesen', 'Neu einlesen', { klick: () => neuEinlesen() }));

  inhalt.append(namen, aktionen, status);

  // Gruppen: Telefon, E-Mail, Web, Adresse, Notiz
  const telefon = [];
  if (k.telefon) telefon.push(['Telefon', k.telefon, telLink(k.telefon)]);
  if (k.mobil) telefon.push(['Mobil', k.mobil, telLink(k.mobil)]);
  if (telefon.length) inhalt.append(gruppeListe('Telefon', telefon));
  if (k.email) inhalt.append(gruppeListe('E-Mail', [['E-Mail', k.email, `mailto:${k.email}`]]));
  if (k.web) inhalt.append(gruppeListe('Web', [['Web', k.web, webLink(k.web)]]));
  const adresse = [];
  if (k.strasse) adresse.push(['Straße', k.strasse, null]);
  const ortZeile = [k.plz, k.ort].filter(Boolean).join(' ');
  if (ortZeile) adresse.push(['Ort', ortZeile, null]);
  if (k.land) adresse.push(['Land', k.land, null]);
  if (adresse.length) inhalt.append(gruppeListe('Adresse', adresse));
  if (k.notiz) inhalt.append(abschnittKarte('Notiz', [el('p', null, k.notiz)]));

  // Fotos antippen vergrößert an Ort und Stelle
  const bilder = [];
  if (k.bildKarte) bilder.push(vorschau({ id: k.bildKarte }, 'Foto der Visitenkarte'));
  if (k.bildNotiz) bilder.push(vorschau({ id: k.bildNotiz }, 'Foto der Notiz'));
  if (bilder.length) {
    const reihe = el('div', 'kontakt-bilder');
    reihe.append(...bilder);
    inhalt.append(abschnittKarte('Fotos', [reihe], 'kontakt-seite-fotos'));
  }

  inhalt.append(abschnittKarte('Outlook', [el('p', 'notiz', outlookSatz(k))]));

  // Löschen ganz unten, Rückfrage in der Zone darunter. Der Eintrag in Outlook bleibt unberührt.
  const loeschZone = el('div', 'kontakt-loeschen');
  loeschZone.hidden = true;
  const loeschStart = el('button', 'kontakt-seite-loeschen', 'Kontakt löschen');
  loeschStart.type = 'button';
  loeschStart.addEventListener('click', () => rueckfrageZeigen());
  inhalt.append(loeschStart, loeschZone);

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
      location.hash = '#kontakte';
    } catch (e) {
      console.error(e);
      statusSetzen('Löschen hat nicht geklappt. Bitte noch einmal versuchen.', true);
      beschaeftigt = false;
    }
  }

  // Foto der Karte erneut lesen; Notiz und Bilder bleiben. Ergebnis im Bearbeiten-Formular, bitte prüfen.
  async function neuEinlesen() {
    if (beschaeftigt) return;
    beschaeftigt = true;
    statusSetzen('');
    try {
      const blob = await bildBlob(k.bildKarte);
      if (!blob) {
        statusSetzen('Das Foto der Karte ist auf diesem Gerät nicht vorhanden.', true);
        return;
      }
      const erg = await bildLesen(blob, kontext);
      formularOeffnen({
        titel: 'Kontakt bearbeiten',
        id: k.id,
        erstellt: k.erstellt,
        felder: Object.fromEntries(FELDNAMEN.map((key) => [key, erg.felder[key] ?? ''])),
        rohText: erg.text,
        notiz: k.notiz ?? '',
        bildKarte: { id: k.bildKarte },
        bildNotiz: k.bildNotiz ? { id: k.bildNotiz } : null,
        hinweis: erg.fehler || 'Mit neuer Erkennung gelesen, bitte prüfen',
        quelle: quelleText(erg.quelle),
        unsicher: erg.unsicher,
        outlook: k.outlook,
      }, kontext);
    } catch (e) {
      console.error(e);
      statusSetzen('Neu einlesen hat nicht geklappt. Bitte noch einmal versuchen.', true);
    } finally {
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

  ziel.replaceChildren(seite);
  titel.focus({ preventScroll: true });
}

// Route #kontakte/<id>: die Detailseite öffnet sich über den Hash, damit Zurück im Browser funktioniert
export function kontaktOeffnen(kontakt) {
  location.hash = '#kontakte/' + encodeURIComponent(kontakt.id);
}
