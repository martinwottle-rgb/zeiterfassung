// Ansicht Einstellungen: Gruppen wie in iOS. Jede Änderung wird sofort gespeichert.
// Vor jedem Speichern wird der aktuelle Stand gelesen, damit schnelle Folgeänderungen sich nicht überschreiben.
import { aktiv } from './rechnen.js';
import { dauer, minutenAusUhrzeit } from './zeit.js';
import { einstellungenLaden, einstellungenSpeichern, exportieren, importieren, alle as alleEintraege, bildLaden, speichern } from './speicher.js';
import { einrichtungLaden, einrichtungSpeichern, einrichtungLoeschen, bildHolen } from './abgleich.js';
import { kontaktAusBild } from './kontakt_erkennung.js';

const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DARSTELLUNGEN = [['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']];
// Gespeicherte Werte aus älteren Versionen (hell, dunkel) auf die neuen abbilden.
const ALTE_DARSTELLUNG = { hell: 'light', dunkel: 'dark' };

// 'JJJJ-MM-TT' zu 'TT.MM.JJJJ'.
function datumDeutsch(text) {
  const [j, m, t] = text.split('-');
  return `${t}.${m}.${j}`;
}

// Halbe Tage ab 0: 30, 21,5. Ungültig zu NaN.
function tageAusEingabe(eingabe) {
  const wert = eingabe.value === '' ? NaN : Number(eingabe.value);
  return Number.isFinite(wert) && wert >= 0 && Number.isInteger(wert * 2) ? wert : NaN;
}
const MINUS = '−';

// Zustand der Anzeige: bleibt beim Neuzeichnen erhalten.
let gesichertFeld = null;
let gesichertTimer = null;
let datenMeldung = null;

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

// 480 zu '08:00' (Format des Zeitfelds), 0 zu '00:00'.
function hhmm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// -120 zu '−2:00', 750 zu '+12:30', 0 zu '0:00'.
function saldoText(min) {
  if (min === 0) return '0:00';
  const betrag = Math.abs(min);
  const zeichen = min > 0 ? '+' : MINUS;
  return `${zeichen}${Math.floor(betrag / 60)}:${String(betrag % 60).padStart(2, '0')}`;
}

// '+12:30', '−2:00' oder '-2:00' zu Minuten. Ohne Vorzeichen positiv. Ungültig zu null.
function saldoAusText(text) {
  const treffer = /^([+\-−]?)(\d{1,4}):([0-5]\d)$/.exec(text.trim());
  if (!treffer) return null;
  const min = Number(treffer[2]) * 60 + Number(treffer[3]);
  return treffer[1] === '' || treffer[1] === '+' ? min : -min;
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

// „Gesichert“ neben dem Feld, zunächst nur wenn es zum letzten Speichern gehört.
function hinweisFuer(feldId) {
  return el('span', {
    klasse: 'notiz gesichert gesichert-hinweis',
    id: `gesichert-${feldId}`,
    'aria-live': 'polite',
    hidden: gesichertFeld !== feldId,
    text: 'Gesichert',
  });
}

// Zeigt „Gesichert“ bei genau diesem Feld und blendet es nach 1,5 s wieder aus.
function gesichertZeigen(feldId) {
  gesichertFeld = feldId;
  const hinweise = () => document.querySelectorAll('.gesichert-hinweis');
  hinweise().forEach(h => { h.hidden = h.id !== `gesichert-${feldId}`; });
  clearTimeout(gesichertTimer);
  gesichertTimer = setTimeout(() => {
    gesichertFeld = null;
    hinweise().forEach(h => { h.hidden = true; });
  }, 1500);
}

// Liest den aktuellen Stand, ändert die genannten Angaben und speichert sofort.
async function sichern(feldId, aendern) {
  const aktuell = await einstellungenLaden();
  await einstellungenSpeichern({ ...aktuell, ...aendern(aktuell) });
  gesichertZeigen(feldId);
}

// Eine Zeile der Gruppe: Titel links, Eingabe rechts, darunter Fehler.
function zeile(feldId, titel, eingabe) {
  const fehler = el('p', {
    klasse: 'notiz fehler',
    id: `fehler-${feldId}`,
    hidden: true,
  });
  const wert = el('div', { klasse: 'einstellung-wert' }, [
    el('div', { klasse: 'einstellung-reihe' }, [eingabe, hinweisFuer(feldId)]),
    fehler,
  ]);
  return {
    element: el('div', { klasse: 'liste-zeile' }, [el('label', { klasse: 'liste-titel', for: feldId, text: titel }), wert]),
    fehler,
  };
}

// Eine Gruppe: kleine Überschrift über einer Liste, optional mit Fußnote.
function gruppe(titel, zeilen, fuss = []) {
  return el('section', { klasse: 'gruppe' }, [
    el('h2', { klasse: 'eyebrow', text: titel }),
    el('div', { klasse: 'liste' }, zeilen),
    ...fuss,
  ]);
}

// Meldung unter „Daten“. Bleibt beim Neuzeichnen erhalten.
function meldungSetzen(text, fehler = false) {
  datenMeldung = { text, fehler };
  const p = document.getElementById('daten-meldung');
  if (p) {
    p.textContent = text;
    p.classList.toggle('fehler', fehler);
    p.hidden = false;
  }
}

// Sicherungsdatei: Objekt mit version 1 und den Listen.
function istSicherung(daten) {
  return daten?.version === 1 && Array.isArray(daten.bloecke) && Array.isArray(daten.abwesenheiten);
}

// Abgleich: Statustext aus dem Zustand von app.js (laeuft, fehler, zuletzt).
function abgleichText(z) {
  const e = einrichtungLaden();
  if (z.laeuft) return 'Abgleich läuft …';
  if (!e || !e.repo || !e.token || !e.passwort) return 'Noch nicht eingerichtet';
  if (z.fehler) return z.fehler;
  if (z.zuletzt) {
    const zeit = new Date(z.zuletzt);
    return `Zuletzt abgeglichen um ${hhmm(zeit.getHours() * 60 + zeit.getMinutes())}`;
  }
  return 'Noch nicht abgeglichen';
}

// Der Status aktualisiert sich bei jedem Ereignis, auch ohne neues Zeichnen der Ansicht.
window.addEventListener('abgleich-status', (ereignis) => {
  const feld = document.getElementById('abgleich-status');
  if (feld) feld.textContent = abgleichText(ereignis.detail ?? {});
});

// Eine Einstellung des Abgleichs speichern. Die übrigen Felder bleiben, wie sie sind.
function einrichtungFeldSichern(feldId, schluessel, wert, fehler, eingabe) {
  try {
    const alt = einrichtungLaden() ?? {};
    einrichtungSpeichern({
      repo: alt.repo ?? '', token: alt.token ?? '', passwort: alt.passwort ?? '', pfad: 'daten.json.enc',
      [schluessel]: wert,
    });
    fehlerSetzen(eingabe, fehler, '');
    gesichertZeigen(feldId);
  } catch {
    fehlerSetzen(eingabe, fehler, 'Die Einrichtung konnte nicht gespeichert werden.');
  }
}

// Kontakte neu einlesen: Zustand im Modul, damit ein Neuzeichnen (daten-geaendert nach jedem Speichern) den Fortschritt nicht verliert.
const KONTAKT_FELDER = ['titel', 'vorname', 'nachname', 'firma', 'position', 'telefon', 'mobil', 'email', 'web', 'strasse', 'plz', 'ort', 'land'];
let kontakteNeu = { laeuft: false, abbruch: false, nr: 0, gesamt: 0, anteil: 0, ergebnis: '' };
let neuKontext = null;

// Ungeprüfte Kontakte mit Kartenfoto, nicht gelöscht. Geprüfte (von Hand gesichert) werden nie überschrieben.
async function kontakteMitFoto() {
  const liste = await alleEintraege('kontakte');
  return liste.filter((k) => !k.geloescht && k.bildKarte && k.geprueft !== true);
}

function kontakteStatusText() {
  if (kontakteNeu.laeuft) {
    return kontakteNeu.abbruch
      ? `Kontakt ${kontakteNeu.nr} von ${kontakteNeu.gesamt} …, stoppt danach`
      : `Kontakt ${kontakteNeu.nr} von ${kontakteNeu.gesamt} …`;
  }
  return kontakteNeu.ergebnis;
}

function kontakteKnopf() {
  if (kontakteNeu.laeuft) {
    const abbrechen = el('button', { type: 'button', klasse: 'knopf', id: 'kontakte-neu-knopf', text: 'Abbrechen' });
    abbrechen.addEventListener('click', () => {
      kontakteNeu.abbruch = true;
      kontakteAktualisieren();
    });
    return abbrechen;
  }
  const start = el('button', { type: 'button', klasse: 'knopf', id: 'kontakte-neu-knopf', text: 'Neu einlesen' });
  start.addEventListener('click', () => kontakteBestaetigen());
  return start;
}

// Zeile in place aktualisieren, damit das Sheet und der aria-live-Bereich bestehen bleiben
function kontakteAktualisieren() {
  const status = document.getElementById('kontakte-neu-status');
  if (status) {
    status.textContent = kontakteStatusText();
  }
  const balken = document.getElementById('kontakte-neu-balken');
  if (balken) {
    balken.value = Math.round(kontakteNeu.anteil * 100);
    balken.hidden = !kontakteNeu.laeuft;
  }
  const alt = document.getElementById('kontakte-neu-knopf');
  if (alt && neuKontext) {
    const neu = kontakteKnopf();
    if (alt.textContent !== neu.textContent) {
      const fokus = document.activeElement === alt;
      alt.replaceWith(neu);
      if (fokus) neu.focus({ preventScroll: true });
    }
  }
}

// Rückfrage im Sheet, danach der Lauf
async function kontakteBestaetigen() {
  if (kontakteNeu.laeuft || !neuKontext) return;
  let liste;
  try {
    liste = await kontakteMitFoto();
  } catch (e) {
    console.error(e);
    kontakteNeu.ergebnis = 'Die Kontakte konnten nicht gelesen werden.';
    kontakteAktualisieren();
    return;
  }
  if (!liste.length) {
    kontakteNeu.ergebnis = 'Alle Kontakte sind geprüft. Sie bleiben, wie du sie gesichert hast.';
    kontakteAktualisieren();
    return;
  }
  const anzahl = liste.length;
  const abbrechen = el('button', { type: 'button', klasse: 'knopf', text: 'Abbrechen' });
  abbrechen.addEventListener('click', () => neuKontext.sheet.schliessen());
  const start = el('button', { type: 'button', klasse: 'knopf haupt', text: 'Neu einlesen' });
  start.addEventListener('click', () => {
    neuKontext.sheet.schliessen();
    kontakteLauf(liste);
  });
  const inhalt = el('div', { klasse: 'formular-stapel' }, [
    el('p', { klasse: 'notiz', text: `${anzahl} ${anzahl === 1 ? 'ungeprüften Kontakt' : 'ungeprüfte Kontakte'} neu einlesen? Geprüfte bleiben unverändert.` }),
    el('div', { klasse: 'aktionen' }, [abbrechen, start]),
  ]);
  neuKontext.sheet.oeffnen('Kontakte neu einlesen', inhalt);
}

// Liest jeden Kontakt neu ein: Felder ersetzen, Notiz und Bilder bleiben
async function kontakteLauf(liste) {
  kontakteNeu = { laeuft: true, abbruch: false, nr: 0, gesamt: liste.length, anteil: 0, ergebnis: '' };
  kontakteAktualisieren();
  let neu = 0;
  let ohneFoto = 0;
  let fehler = 0;
  for (let i = 0; i < liste.length; i++) {
    if (kontakteNeu.abbruch) break;
    const k = liste[i];
    kontakteNeu.nr = i + 1;
    kontakteNeu.anteil = i / liste.length;
    kontakteAktualisieren();
    try {
      let blob = await bildLaden(k.bildKarte);
      if (!blob) blob = await bildHolen(k.bildKarte, einrichtungLaden());
      if (!blob) {
        ohneFoto += 1;
        continue;
      }
      const erg = await kontaktAusBild(blob, (p) => {
        const teil = Math.min(Math.max(Number.isFinite(p) ? p : 0, 0), 1);
        kontakteNeu.anteil = (i + teil) / liste.length;
        kontakteAktualisieren();
      });
      const felder = Object.fromEntries(KONTAKT_FELDER.map((f) => [f, erg?.felder?.[f] ?? '']));
      let notiz = k.notiz ?? '';
      const link = String(erg?.qrLink ?? '').trim();
      if (link && !notiz.includes(link)) notiz = notiz ? `${notiz}\nQR-Link: ${link}` : `QR-Link: ${link}`;
      // Wie beim Neu einlesen im Sheet: der bisherige Status merkt sich in vorher
      const alt = k.outlook ?? {};
      const vorher = alt.status === 'offen' ? (alt.vorher ?? '') : (alt.status ?? '');
      await speichern('kontakte', {
        ...k,
        ...felder,
        notiz,
        // Bleibt ungeprüft: erst Sichern von Hand macht ihn geprüft (dann geht er nach Outlook und ist geschützt)
        geprueft: false,
        outlook: { status: 'offen', vorher, entryId: alt.entryId ?? '' },
      });
      neu += 1;
    } catch (e) {
      console.error(e);
      fehler += 1;
    }
  }
  const verarbeitet = neu + ohneFoto + fehler;
  const offen = liste.length - verarbeitet;
  const abgebrochen = kontakteNeu.abbruch;
  const teile = [`${neu} neu eingelesen`];
  if (ohneFoto) teile.push(`${ohneFoto} ohne Foto übersprungen`);
  if (fehler) teile.push(`${fehler} mit Fehler übersprungen`);
  if (abgebrochen && offen > 0) teile.push(`${offen} nicht mehr bearbeitet`);
  let ergebnis;
  if (!abgebrochen && !ohneFoto && !fehler) {
    ergebnis = `${neu} ${neu === 1 ? 'Kontakt' : 'Kontakte'} neu eingelesen`;
  } else {
    ergebnis = (abgebrochen ? 'Abgebrochen. ' : '') + teile.join(', ');
  }
  kontakteNeu = { laeuft: false, abbruch: false, nr: 0, gesamt: 0, anteil: 0, ergebnis };
  kontakteAktualisieren();
}

// Gruppe „Kontakte“: Zeile mit Knopf, Fortschritt und Ergebnis
function kontakteGruppe() {
  const balken = el('progress', {
    klasse: 'kontakt-fortschritt',
    id: 'kontakte-neu-balken',
    max: 100,
    value: Math.round(kontakteNeu.anteil * 100),
    hidden: !kontakteNeu.laeuft,
  });
  balken.setAttribute('aria-labelledby', 'kontakte-neu-status');
  const status = el('p', {
    klasse: 'notiz',
    id: 'kontakte-neu-status',
    'aria-live': 'polite',
    text: kontakteStatusText(),
  });
  const wert = el('div', { klasse: 'einstellung-wert' }, [kontakteKnopf(), balken, status]);
  const zeile = el('div', { klasse: 'liste-zeile' }, [el('span', { klasse: 'liste-titel', text: 'Ungeprüfte Kontakte neu einlesen' }), wert]);
  return el('section', { klasse: 'gruppe' }, [
    el('h2', { klasse: 'eyebrow', text: 'Kontakte' }),
    el('div', { klasse: 'liste' }, [zeile]),
    el('p', { klasse: 'gruppe-fuss', text: 'Liest die Visitenkartenfotos ungeprüfter Kontakte mit der aktuellen Erkennung neu. Kontakte, die du geprüft und gesichert hast, werden nie überschrieben.' }),
  ]);
}

export async function zeigen(ziel, kontext) {
  neuKontext = kontext;
  const einst = kontext.daten.einstellungen;

  // Fokus merken, falls er im Bereich liegt, und nach dem Zeichnen zurücksetzen
  const merkeFokus = ziel.contains(document.activeElement) ? document.activeElement.id : '';

  // Allgemein
  const nameEingabe = el('input', {
    type: 'text',
    id: 'ein-name',
    name: 'name',
    autocomplete: 'name',
    value: einst.name ?? '',
    klasse: 'einstellung-eingabe',
  });
  const nameZeile = zeile('ein-name', 'Name', nameEingabe);
  nameEingabe.addEventListener('change', () => {
    sichern('ein-name', () => ({ name: nameEingabe.value.trim() }));
  });

  // Arbeitsort: Termine außerhalb schlägt die App als Dienstreise vor
  const arbeitsortEingabe = el('input', {
    type: 'text',
    id: 'ein-arbeitsort',
    name: 'arbeitsort',
    autocomplete: 'off',
    value: einst.arbeitsort ?? '',
    klasse: 'einstellung-eingabe',
  });
  const arbeitsortZeile = zeile('ein-arbeitsort', 'Arbeitsort', arbeitsortEingabe);
  arbeitsortEingabe.addEventListener('change', () => {
    sichern('ein-arbeitsort', () => ({ arbeitsort: arbeitsortEingabe.value.trim() }));
  });

  // Pause: gesetzliche Pause abziehen (Schalter)
  const pauseSchalter = el('input', {
    type: 'checkbox',
    role: 'switch',
    id: 'ein-pause-auto',
    name: 'pauseAuto',
    checked: einst.pauseAuto === true,
  });
  const pauseZeile = zeile('ein-pause-auto', 'Gesetzliche Pause automatisch abziehen', pauseSchalter);
  pauseSchalter.addEventListener('change', () => {
    sichern('ein-pause-auto', () => ({ pauseAuto: pauseSchalter.checked }));
  });

  // Sollzeit je Wochentag
  const sollZeilen = WOCHENTAGE.map((tag, i) => {
    const eingabe = el('input', {
      type: 'time',
      id: `ein-soll-${i}`,
      name: `soll${i}`,
      value: hhmm(einst.sollMinuten[i]),
      klasse: 'einstellung-eingabe',
    });
    const z = zeile(`ein-soll-${i}`, tag, eingabe);
    eingabe.addEventListener('change', () => {
      const min = eingabe.value === '' ? 0 : minutenAusUhrzeit(eingabe.value);
      if (min === null) {
        fehlerSetzen(eingabe, z.fehler, 'Bitte eine Uhrzeit wie 8:00 eingeben.');
        return;
      }
      fehlerSetzen(eingabe, z.fehler, '');
      sichern(`ein-soll-${i}`, (akt) => {
        const soll = [...akt.sollMinuten];
        soll[i] = min;
        return { sollMinuten: soll };
      });
    });
    return z.element;
  });
  const summe = einst.sollMinuten.reduce((a, b) => a + b, 0);
  const sollFuss = el('p', { klasse: 'gruppe-fuss', text: `${dauer(summe)} pro Woche` });

  // Urlaub
  const urlaubEingabe = el('input', {
    type: 'number',
    id: 'ein-urlaub',
    name: 'urlaubstage',
    min: '0',
    step: '0.5',
    inputmode: 'decimal',
    value: String(einst.urlaubstage),
    klasse: 'einstellung-eingabe',
  });
  const urlaubZeile = zeile('ein-urlaub', 'Urlaubstage pro Jahr', urlaubEingabe);
  urlaubEingabe.addEventListener('change', () => {
    const wert = tageAusEingabe(urlaubEingabe);
    if (Number.isNaN(wert)) {
      fehlerSetzen(urlaubEingabe, urlaubZeile.fehler, 'Bitte Tage in halben Schritten eingeben, etwa 30 oder 21,5.');
      return;
    }
    fehlerSetzen(urlaubEingabe, urlaubZeile.fehler, '');
    sichern('ein-urlaub', () => ({ urlaubstage: wert }));
  });

  // Resturlaub am Beginn der Erfassung: leer heißt null (nicht angegeben)
  const startRestEingabe = el('input', {
    type: 'number',
    id: 'ein-urlaub-start',
    name: 'urlaubStartRest',
    min: '0',
    step: '0.5',
    inputmode: 'decimal',
    value: einst.urlaubStartRest == null ? '' : String(einst.urlaubStartRest),
    klasse: 'einstellung-eingabe',
  });
  const startRestZeile = zeile('ein-urlaub-start', 'Resturlaub am Beginn der Erfassung', startRestEingabe);
  startRestEingabe.addEventListener('change', () => {
    const wert = startRestEingabe.value === '' ? null : tageAusEingabe(startRestEingabe);
    if (wert !== null && Number.isNaN(wert)) {
      fehlerSetzen(startRestEingabe, startRestZeile.fehler, 'Bitte Tage in halben Schritten eingeben, etwa 30 oder 21,5.');
      return;
    }
    fehlerSetzen(startRestEingabe, startRestZeile.fehler, '');
    sichern('ein-urlaub-start', () => ({ urlaubStartRest: wert }));
  });
  const urlaubZeilen = [urlaubZeile.element, startRestZeile.element];

  // Übertrag aus dem Vorjahr: nur, wenn das laufende Jahr nicht das Startjahr ist
  const jahr = Number(kontext.heute.slice(0, 4));
  if (kontext.heute.slice(0, 4) !== einst.start.slice(0, 4)) {
    const uebertrag = (einst.urlaubUebertrag ?? {})[jahr];
    const uebertragEingabe = el('input', {
      type: 'number',
      id: 'ein-uebertrag',
      name: 'urlaubUebertrag',
      min: '0',
      step: '0.5',
      inputmode: 'decimal',
      value: uebertrag == null ? '' : String(uebertrag),
      klasse: 'einstellung-eingabe',
    });
    const uebertragZeile = zeile('ein-uebertrag', 'Übertrag aus dem Vorjahr', uebertragEingabe);
    uebertragEingabe.addEventListener('change', () => {
      const wert = uebertragEingabe.value === '' ? null : tageAusEingabe(uebertragEingabe);
      if (wert !== null && Number.isNaN(wert)) {
        fehlerSetzen(uebertragEingabe, uebertragZeile.fehler, 'Bitte Tage in halben Schritten eingeben, etwa 3 oder 1,5.');
        return;
      }
      fehlerSetzen(uebertragEingabe, uebertragZeile.fehler, '');
      sichern('ein-uebertrag', (akt) => {
        const alle = { ...(akt.urlaubUebertrag ?? {}) };
        if (wert === null) delete alle[jahr];
        else alle[jahr] = wert;
        return { urlaubUebertrag: alle };
      });
    });
    urlaubZeilen.push(uebertragZeile.element);
  }
  const startRestHinweis = el('p', {
    klasse: 'gruppe-fuss',
    text: `Für das erste Jahr: so viele Tage hattest du am ${datumDeutsch(einst.start)} noch übrig.`,
  });

  // Überstundenkonto
  const startEingabe = el('input', { type: 'date', id: 'ein-start', name: 'start', value: einst.start, klasse: 'einstellung-eingabe' });
  const startZeile = zeile('ein-start', 'Beginn der Erfassung', startEingabe);
  startEingabe.addEventListener('change', () => {
    if (!startEingabe.value) {
      fehlerSetzen(startEingabe, startZeile.fehler, 'Bitte ein Datum eintragen.');
      return;
    }
    fehlerSetzen(startEingabe, startZeile.fehler, '');
    sichern('ein-start', () => ({ start: startEingabe.value }));
  });

  const saldoEingabe = el('input', {
    type: 'text',
    id: 'ein-saldo',
    name: 'startSaldo',
    autocomplete: 'off',
    value: saldoText(einst.startSaldo),
    klasse: 'einstellung-eingabe',
  });
  const saldoZeile = zeile('ein-saldo', 'Anfangssaldo', saldoEingabe);
  saldoEingabe.addEventListener('change', () => {
    const min = saldoAusText(saldoEingabe.value);
    if (min === null) {
      fehlerSetzen(saldoEingabe, saldoZeile.fehler, `Bitte so eingeben: +12:30 oder ${MINUS}2:00.`);
      return;
    }
    fehlerSetzen(saldoEingabe, saldoZeile.fehler, '');
    sichern('ein-saldo', () => ({ startSaldo: min }));
  });

  // Darstellung: Segment, wirkt sofort über kontext.darstellungSetzen
  const aktuelleDarstellung = ALTE_DARSTELLUNG[einst.darstellung] ?? einst.darstellung ?? 'system';
  const darstellung = el('div', { klasse: 'segment', role: 'radiogroup', 'aria-label': 'Darstellung' },
    DARSTELLUNGEN.map(([wert, name]) => {
      const eingabe = el('input', { type: 'radio', name: 'darstellung', value: wert, checked: aktuelleDarstellung === wert });
      eingabe.addEventListener('change', () => {
        if (!eingabe.checked) return;
        kontext.darstellungSetzen(wert);
        sichern('ein-darstellung', () => ({ darstellung: wert }));
      });
      return el('label', { klasse: 'segment-teil' }, [eingabe, el('span', { text: name })]);
    }));
  const darstellungZeile = el('div', { klasse: 'liste-zeile liste-zentriert' }, [
    darstellung,
    hinweisFuer('ein-darstellung'),
  ]);

  // Daten: Export und Import
  const exportKnopf = el('button', { type: 'button', klasse: 'liste-zeile' }, [
    el('span', { klasse: 'liste-titel', text: 'Sicherung exportieren' }),
  ]);
  exportKnopf.addEventListener('click', async () => {
    try {
      const daten = await exportieren();
      const blob = new Blob([JSON.stringify(daten, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `zeiterfassung-${kontext.heute}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      meldungSetzen('Sicherung exportiert.');
    } catch {
      meldungSetzen('Die Sicherung konnte nicht exportiert werden.', true);
    }
  });

  const dateiEingabe = el('input', { type: 'file', id: 'ein-datei', accept: 'application/json,.json', klasse: 'datei-eingabe' });
  const dateiZeile = el('div', { klasse: 'liste-zeile' }, [
    el('label', { klasse: 'liste-titel', for: 'ein-datei', text: 'Sicherung einlesen' }),
    dateiEingabe,
  ]);
  dateiEingabe.addEventListener('change', async () => {
    const datei = dateiEingabe.files?.[0];
    if (!datei) return;
    let daten = null;
    try {
      daten = JSON.parse(await datei.text());
    } catch {
      daten = null;
    }
    dateiEingabe.value = '';
    if (!istSicherung(daten)) {
      meldungSetzen('Diese Datei ist keine Sicherung der Zeiterfassung.', true);
      return;
    }
    try {
      await importieren(daten);
      const anzahlBloecke = aktiv(daten.bloecke).length;
      const anzahlAbw = aktiv(daten.abwesenheiten).length;
      meldungSetzen(`Sicherung eingelesen: ${anzahlBloecke} ${anzahlBloecke === 1 ? 'Block' : 'Blöcke'}, ${anzahlAbw} ${anzahlAbw === 1 ? 'Abwesenheit' : 'Abwesenheiten'}.`);
    } catch {
      meldungSetzen('Die Sicherung konnte nicht eingelesen werden.', true);
    }
  });

  const meldung = el('p', {
    klasse: datenMeldung?.fehler ? 'gruppe-fuss fehler' : 'gruppe-fuss',
    id: 'daten-meldung',
    'aria-live': 'polite',
    hidden: !datenMeldung,
    text: datenMeldung?.text ?? '',
  });

  // Abgleich mit dem iPhone: Repo, Token, Passwort. Nur auf diesem Gerät gespeichert.
  const einrichtung = einrichtungLaden() ?? {};
  const repoEingabe = el('input', {
    type: 'text',
    id: 'abgleich-repo',
    name: 'repo',
    placeholder: 'name/zeiterfassung-daten',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    value: einrichtung.repo ?? '',
    klasse: 'einstellung-eingabe',
  });
  const repoZeile = zeile('abgleich-repo', 'Repository', repoEingabe);
  repoEingabe.addEventListener('change', () => {
    einrichtungFeldSichern('abgleich-repo', 'repo', repoEingabe.value.trim(), repoZeile.fehler, repoEingabe);
  });

  const tokenEingabe = el('input', {
    type: 'password',
    id: 'abgleich-token',
    name: 'token',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    value: einrichtung.token ?? '',
    klasse: 'einstellung-eingabe',
  });
  const tokenZeile = zeile('abgleich-token', 'Token', tokenEingabe);
  tokenEingabe.addEventListener('change', () => {
    einrichtungFeldSichern('abgleich-token', 'token', tokenEingabe.value.trim(), tokenZeile.fehler, tokenEingabe);
  });

  const passwortEingabe = el('input', {
    type: 'password',
    id: 'abgleich-passwort',
    name: 'passwort',
    autocomplete: 'new-password',
    value: einrichtung.passwort ?? '',
    klasse: 'einstellung-eingabe',
  });
  const passwortZeile = zeile('abgleich-passwort', 'Passwort für die Verschlüsselung', passwortEingabe);
  passwortEingabe.addEventListener('change', () => {
    einrichtungFeldSichern('abgleich-passwort', 'passwort', passwortEingabe.value, passwortZeile.fehler, passwortEingabe);
  });

  const jetztKnopf = el('button', { type: 'button', klasse: 'knopf', text: 'Jetzt abgleichen' });
  jetztKnopf.addEventListener('click', () => kontext.abgleichJetzt());
  const abgleichStatus = el('p', {
    klasse: 'notiz',
    id: 'abgleich-status',
    'aria-live': 'polite',
    text: abgleichText(kontext.abgleichStatus()),
  });
  const jetztZeile = el('div', { klasse: 'liste-zeile' }, [jetztKnopf, abgleichStatus]);

  // Entfernen: Rückfrage im Sheet, dann nur die Einrichtung auf diesem Gerät löschen
  const entfernenKnopf = el('button', { type: 'button', klasse: 'knopf gefahr klein', text: 'Abgleich auf diesem Gerät entfernen' });
  entfernenKnopf.addEventListener('click', () => {
    const abbrechen = el('button', { type: 'button', klasse: 'knopf', text: 'Abbrechen' });
    abbrechen.addEventListener('click', () => kontext.sheet.schliessen());
    const endgueltig = el('button', { type: 'button', klasse: 'knopf gefahr', text: 'Entfernen' });
    endgueltig.addEventListener('click', () => {
      einrichtungLoeschen();
      kontext.sheet.schliessen();
      kontext.neuZeichnen();
    });
    const inhalt = el('div', { klasse: 'formular-stapel' }, [
      el('p', { klasse: 'notiz', text: 'Repository, Token und Passwort werden von diesem Gerät gelöscht. Deine Einträge bleiben hier und im Repository.' }),
      el('div', { klasse: 'aktionen' }, [abbrechen, endgueltig]),
    ]);
    kontext.sheet.oeffnen('Abgleich entfernen?', inhalt);
  });
  const entfernenZeile = el('div', { klasse: 'liste-zeile' }, [entfernenKnopf]);

  // Erinnerung: Schalter mit Erlaubnis für Benachrichtigungen
  const ohneBenachrichtigung = typeof Notification === 'undefined';
  const erinnerungHinweis = el('p', {
    klasse: ohneBenachrichtigung ? 'gruppe-fuss' : 'gruppe-fuss fehler',
    id: 'erinnerung-hinweis',
    'aria-live': 'polite',
    hidden: !ohneBenachrichtigung,
    text: ohneBenachrichtigung ? 'Auf dem iPhone geht das erst, wenn die App auf dem Home-Bildschirm liegt.' : '',
  });
  const erinnerungSchalter = el('input', {
    type: 'checkbox',
    role: 'switch',
    id: 'ein-erinnerung',
    name: 'erinnerung',
    checked: einst.erinnerung === true,
  });
  const erinnerungZeile = zeile('ein-erinnerung', 'Erinnern, wenn ich vergesse zu stempeln', erinnerungSchalter);
  erinnerungSchalter.addEventListener('change', async () => {
    if (!erinnerungSchalter.checked) {
      erinnerungHinweis.hidden = true;
      sichern('ein-erinnerung', () => ({ erinnerung: false }));
      return;
    }
    const ablehnen = (text) => {
      erinnerungSchalter.checked = false;
      erinnerungHinweis.textContent = text;
      erinnerungHinweis.className = ohneBenachrichtigung ? 'gruppe-fuss' : 'gruppe-fuss fehler';
      erinnerungHinweis.hidden = false;
    };
    if (ohneBenachrichtigung) {
      ablehnen('Auf dem iPhone geht das erst, wenn die App auf dem Home-Bildschirm liegt.');
      return;
    }
    let erlaubt = Notification.permission === 'granted';
    if (Notification.permission === 'default') {
      try {
        erlaubt = (await Notification.requestPermission()) === 'granted';
      } catch {
        erlaubt = false;
      }
    }
    if (!erlaubt) {
      ablehnen('Benachrichtigungen sind für die App nicht erlaubt.');
      return;
    }
    erinnerungHinweis.hidden = true;
    sichern('ein-erinnerung', () => ({ erinnerung: true }));
  });

  const kopf = el('header', { klasse: 'kopf glas' }, [el('h1', { text: 'Einstellungen' })]);

  ziel.replaceChildren(
    kopf,
    gruppe('Allgemein', [nameZeile.element, arbeitsortZeile.element], [
      el('p', { klasse: 'gruppe-fuss', text: 'Termine außerhalb dieses Orts schlägt die App als Dienstreise vor.' }),
    ]),
    gruppe('Abgleich mit dem iPhone', [repoZeile.element, tokenZeile.element, passwortZeile.element, jetztZeile, entfernenZeile], [
      el('p', {
        klasse: 'gruppe-fuss',
        text: 'Token und Passwort bleiben nur auf diesem Gerät. Auf jedem Gerät dasselbe Passwort eintragen. Geht das Passwort verloren, sind die Daten im Repository nicht mehr lesbar.',
      }),
    ]),
    kontakteGruppe(),
    gruppe('Sollzeit', sollZeilen, [sollFuss]),
    gruppe('Pause', [pauseZeile.element], [
      el('p', {
        klasse: 'gruppe-fuss',
        text: 'Ab 6 h 30 Minuten, ab 9 h 45 Minuten. Gestempelte Pausen werden angerechnet. Einzelne Tage lassen sich abweichend einstellen.',
      }),
    ]),
    gruppe('Urlaub', urlaubZeilen, [startRestHinweis]),
    gruppe('Überstundenkonto', [startZeile.element, saldoZeile.element], [
      el('p', { klasse: 'gruppe-fuss', text: 'Überstunden vor dem Beginn der Erfassung.' }),
    ]),
    gruppe('Darstellung', [darstellungZeile]),
    gruppe('Erinnerung', [erinnerungZeile.element], [
      el('p', { klasse: 'gruppe-fuss', text: 'Erinnert um 18 Uhr, wenn heute noch nichts eingetragen ist, und um 20 Uhr, wenn du noch eingestempelt bist.' }),
      erinnerungHinweis,
    ]),
    gruppe('Daten', [exportKnopf, dateiZeile], [meldung]),
  );

  if (merkeFokus && merkeFokus !== 'ansicht') {
    document.getElementById(merkeFokus)?.focus({ preventScroll: true });
  }
}
