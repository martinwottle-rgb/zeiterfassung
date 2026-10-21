// Tag bearbeiten: Blöcke eines Tages im Sheet ändern, anlegen und löschen.
// Kopfzeile mit Arbeitszeit, Pause und Saldo; die Werte rechnen aus den aktuellen Feldwerten.
import { alle, speichern, loeschen } from './speicher.js';
import { bloeckeAm, istMinuten, pauseGesamt, pausenRegel, tagesSaldo } from './rechnen.js';
import { verpflegung } from './reisen.js';
import {
  euro, betragAusText, feldFehler, kurzesDatum, landAnzeige, landAusEingabe, landListe, reiseFeld, reiseSchalter,
} from './reise_sheet.js';
import {
  minutenAusUhrzeit, pauseAusText, uhrzeit, langesDatum, dauer, dauerMitVorzeichen,
} from './zeit.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let zaehler = 0;

// Minuten als Feldwert 'HH:MM'. Das Zeitfeld kennt 24:00 nicht, daher zeigt es 23:59.
function feldWert(min) {
  if (min === 1440) return '23:59';
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// Betrag als Feldwert: 26,4 wird 26,40, 0 wird leer
function betragText(x) {
  return x ? Number(x).toFixed(2).replace('.', ',') : '';
}

// Zeitfeld. Die Beschriftung ist nur für Screenreader sichtbar, die Zeile zeigt Block-Nummer und „bis“.
function zeitFeld(beschriftung, id, wert) {
  const feld = document.createElement('div');
  feld.className = 'feld';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.className = 'nur-sr';
  label.textContent = beschriftung;

  const input = document.createElement('input');
  input.type = 'time';
  input.step = '60';
  input.id = id;
  input.name = id;
  input.value = wert;

  feld.append(label, input);
  return { feld, label, input };
}

// Papierkorb-Symbol (Linie, wie die übrigen Symbole)
function papierkorbSymbol() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const pfad = document.createElementNS(SVG_NS, 'path');
  pfad.setAttribute('d', 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3');
  svg.append(pfad);
  return svg;
}

// Kennzahl: Name oben, Wert darunter
function kennzahl(name) {
  const box = document.createElement('div');
  box.className = 'tag-kennzahl';
  const titel = document.createElement('p');
  titel.className = 'tag-kennzahl-name';
  titel.textContent = name;
  const wert = document.createElement('p');
  wert.className = 'tag-kennzahl-wert';
  box.append(titel, wert);
  return { box, wert };
}

// Zeitangabe einer Zeile lesen: Beginn und Ende in Minuten, Ende null für einen offenen Block.
function zeileLesen(z) {
  const beginn = minutenAusUhrzeit(z.beginn.input.value);
  if (beginn === null) return null;
  const wert = z.ende.input.value;
  let ende;
  if (wert === '') {
    ende = null;
  } else if (z.block && z.block.ende === 1440 && wert === feldWert(1440)) {
    ende = 1440; // unverändert: 24:00 bleibt erhalten
  } else {
    ende = minutenAusUhrzeit(wert);
  }
  return { beginn, ende };
}

// Fehler an einer Zeile: Text unter der Zeile, das betroffene Feld bekommt aria-invalid
function zeilenFehler(z, input, text) {
  z.fehler.textContent = text;
  z.fehler.hidden = false;
  z.beginn.input.removeAttribute('aria-invalid');
  z.ende.input.removeAttribute('aria-invalid');
  input.setAttribute('aria-invalid', 'true');
}

function zeilenFehlerAus(z) {
  z.fehler.textContent = '';
  z.fehler.hidden = true;
  z.beginn.input.removeAttribute('aria-invalid');
  z.ende.input.removeAttribute('aria-invalid');
}

export async function tagOeffnen(datum, kontext) {
  const istHeute = datum === kontext.heute;
  const einst = kontext.daten.einstellungen;
  const abwesenheiten = kontext.daten.abwesenheiten;
  const urspruenglich = bloeckeAm(kontext.daten.bloecke, datum);
  const reiseBestand = (await alle('reisen')).filter((r) => !r.geloescht && r.datum === datum);
  const urIds = new Set(urspruenglich.map(b => b.id));
  let beschaeftigt = false;

  // Eine Zeile je Block. Bestehende Blöcke merken sich ihren Originalzustand.
  let zeilen = [];

  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'formular-stapel tag-form';

  // Kopfzeile: Arbeitszeit, Pause, Saldo
  const kennzahlen = document.createElement('div');
  kennzahlen.className = 'karte tag-kennzahlen';
  const kzArbeit = kennzahl('Arbeitszeit');
  const kzPause = kennzahl('Pause');
  const kzSaldo = kennzahl('Saldo');
  kennzahlen.append(kzArbeit.box, kzPause.box, kzSaldo.box);

  // Blöcke
  const liste = document.createElement('div');
  liste.className = 'liste tag-liste';

  const leerZeile = document.createElement('p');
  leerZeile.className = 'notiz tag-leer';
  leerZeile.textContent = 'Noch keine Blöcke an diesem Tag.';

  const hinzuKnopf = document.createElement('button');
  hinzuKnopf.type = 'button';
  hinzuKnopf.className = 'tag-hinzu';
  hinzuKnopf.textContent = '+ Block hinzufügen';

  const heuteHinweis = document.createElement('p');
  heuteHinweis.className = 'notiz tag-hinweis';
  heuteHinweis.textContent = 'Leer lassen, solange der Block läuft.';
  heuteHinweis.hidden = !istHeute;

  // Aktuelle Zeile aus dem Feld, plus Dauer (offener Block bis kontext.jetzt)
  function zeilenDauer(z) {
    const lesen = zeileLesen(z);
    if (!lesen) return '';
    const ende = lesen.ende ?? (istHeute ? kontext.jetzt : null);
    if (ende === null || ende <= lesen.beginn) return '';
    return dauer(ende - lesen.beginn);
  }

  // Zeile bauen: Block (oder null für neu)
  function zeileBauen(block) {
    const nr = ++zaehler;
    const zeile = document.createElement('div');
    zeile.className = 'tag-block';

    const nrText = document.createElement('p');
    nrText.className = 'tag-nr';

    const beginn = zeitFeld('Beginn', `tag-${nr}-beginn`, block ? feldWert(block.beginn) : '');
    const ende = zeitFeld('Ende', `tag-${nr}-ende`, block && block.ende !== null ? feldWert(block.ende) : '');

    const bis = document.createElement('span');
    bis.className = 'tag-bis';
    bis.textContent = 'bis';

    const zeit = document.createElement('div');
    zeit.className = 'tag-zeit';
    zeit.append(beginn.feld, bis, ende.feld);

    const dauerText = document.createElement('p');
    dauerText.className = 'tag-dauer';

    const loeschKnopf = document.createElement('button');
    loeschKnopf.type = 'button';
    loeschKnopf.className = 'knopf tag-loeschen';
    loeschKnopf.append(papierkorbSymbol());

    const fehler = document.createElement('p');
    fehler.className = 'notiz fehler tag-fehler';
    fehler.id = `tag-${nr}-fehler`;
    fehler.hidden = true;
    beginn.input.setAttribute('aria-describedby', fehler.id);
    ende.input.setAttribute('aria-describedby', fehler.id);

    zeile.append(nrText, zeit, dauerText, loeschKnopf, fehler);
    const z = { nr, block, zeile, nrText, beginn, ende, dauer: dauerText, loeschen: loeschKnopf, fehler };

    loeschKnopf.addEventListener('click', () => {
      zeilen = zeilen.filter(x => x !== z);
      rendern();
      hinzuKnopf.focus();
    });
    return z;
  }

  // Zeilen in der Reihenfolge der Liste einsetzen, Nummern und Beschriftungen aktualisieren
  function rendern() {
    liste.replaceChildren();
    if (zeilen.length === 0) liste.append(leerZeile);
    zeilen.forEach((z, i) => {
      z.nrText.textContent = `Block ${i + 1}`;
      z.beginn.label.textContent = `Beginn Block ${i + 1}`;
      z.ende.label.textContent = `Ende Block ${i + 1}`;
      z.loeschen.setAttribute('aria-label', `Block ${i + 1} löschen`);
      liste.append(z.zeile);
    });
    aktualisieren();
  }

  // Pause: Schalter „Gesetzliche Pause abziehen“ und Feld „Pause“
  const regel = pausenRegel(urspruenglich, datum, einst);
  let schalterAn = regel === 'auto' || (typeof regel === 'number' && einst?.pauseAuto === true);

  const pauseGruppe = document.createElement('div');
  pauseGruppe.className = 'gruppe tag-pause';
  pauseGruppe.setAttribute('role', 'group');
  pauseGruppe.setAttribute('aria-labelledby', 'tag-pause-titel');

  const pauseTitel = document.createElement('p');
  pauseTitel.className = 'eyebrow tag-gruppen-titel';
  pauseTitel.id = 'tag-pause-titel';
  pauseTitel.textContent = 'Pause';

  const pauseListe = document.createElement('div');
  pauseListe.className = 'liste';

  const schalterZeile = document.createElement('div');
  schalterZeile.className = 'liste-zeile tag-pause-zeile';
  const schalterText = document.createElement('div');
  schalterText.className = 'liste-text';
  const schalterName = document.createElement('span');
  schalterName.className = 'liste-titel';
  schalterName.id = 'tag-schalter-name';
  schalterName.textContent = 'Gesetzliche Pause abziehen';
  const schalterHinweis = document.createElement('span');
  schalterHinweis.className = 'liste-unter';
  schalterHinweis.id = 'tag-schalter-hinweis';
  schalterHinweis.textContent = 'ab 6 h 30 Minuten, ab 9 h 45 Minuten';
  schalterText.append(schalterName, schalterHinweis);
  const pauseSchalter = document.createElement('input');
  pauseSchalter.type = 'checkbox';
  pauseSchalter.setAttribute('role', 'switch');
  pauseSchalter.id = 'tag-pause-schalter';
  pauseSchalter.name = 'tag-pause-schalter';
  pauseSchalter.setAttribute('aria-labelledby', 'tag-schalter-name');
  pauseSchalter.setAttribute('aria-describedby', 'tag-schalter-hinweis');
  schalterZeile.append(schalterText, pauseSchalter);

  const feldZeile = document.createElement('div');
  feldZeile.className = 'liste-zeile tag-pause-zeile';
  const pauseLabel = document.createElement('label');
  pauseLabel.className = 'liste-titel';
  pauseLabel.htmlFor = 'tag-pause-feld';
  pauseLabel.textContent = 'Pause';
  const pauseFeld = document.createElement('input');
  pauseFeld.type = 'text';
  pauseFeld.inputMode = 'decimal';
  pauseFeld.autocomplete = 'off';
  pauseFeld.id = 'tag-pause-feld';
  pauseFeld.name = 'tag-pause-feld';
  pauseFeld.placeholder = 'z. B. 30 oder 0,5';
  pauseFeld.className = 'tag-pause-eingabe';
  if (typeof regel === 'number') pauseFeld.value = String(regel);
  const erkennung = document.createElement('p');
  erkennung.className = 'tag-pause-erkennung';
  erkennung.id = 'tag-pause-erkennung';
  erkennung.setAttribute('aria-live', 'polite');
  pauseFeld.setAttribute('aria-describedby', 'tag-pause-erkennung tag-pause-fehler');
  feldZeile.append(pauseLabel, pauseFeld, erkennung);

  pauseListe.append(schalterZeile, feldZeile);

  const pauseFehler = document.createElement('p');
  pauseFehler.className = 'notiz fehler tag-fehler';
  pauseFehler.id = 'tag-pause-fehler';
  pauseFehler.hidden = true;

  pauseGruppe.append(pauseTitel, pauseListe, pauseFehler);

  // Feldwert der Pause: Zahl in Minuten, 'auto' oder 'keine'. null bei nicht erkannter Eingabe.
  function pauseWert() {
    const text = pauseFeld.value;
    if (text.trim() === '') return schalterAn ? 'auto' : 'keine';
    const min = pauseAusText(text);
    if (min === null || Number.isNaN(min)) return null;
    return min;
  }

  // Schalter und Erkennung an das Feld anpassen
  function pauseAnzeigen() {
    const text = pauseFeld.value;
    const leer = text.trim() === '';
    pauseSchalter.disabled = !leer;
    pauseSchalter.checked = leer && schalterAn;
    if (leer) {
      erkennung.textContent = '';
      erkennung.classList.remove('fehler');
      pauseFeld.removeAttribute('aria-invalid');
    } else {
      const min = pauseAusText(text);
      if (Number.isNaN(min)) {
        erkennung.textContent = 'nicht erkannt';
        erkennung.classList.add('fehler');
      } else {
        erkennung.textContent = `= ${dauer(min)}`;
        erkennung.classList.remove('fehler');
      }
    }
    if (!pauseFehler.hidden && pauseWert() !== null) {
      pauseFehler.textContent = '';
      pauseFehler.hidden = true;
      pauseFeld.removeAttribute('aria-invalid');
    }
  }

  pauseSchalter.checked = schalterAn;
  pauseSchalter.addEventListener('change', () => {
    schalterAn = pauseSchalter.checked;
  });

  // Vorläufige Blockliste aus den gültigen Zeilen, für die Kennzahlen
  function vorlaeufigeBloecke() {
    const liste2 = [];
    for (const z of zeilen) {
      const lesen = zeileLesen(z);
      if (!lesen) continue;
      if (lesen.ende === null ? !istHeute : lesen.ende <= lesen.beginn) continue;
      liste2.push({
        id: z.block ? z.block.id : `neu-${z.nr}`,
        datum,
        beginn: lesen.beginn,
        ende: lesen.ende,
        gehen: false,
        notiz: '',
      });
    }
    liste2.sort((a, b) => a.beginn - b.beginn);
    if (liste2.length > 0) {
      const wert = pauseWert();
      if (wert !== null) liste2[0].pause = wert;
    }
    return liste2;
  }

  // Kennzahlen und Zeilendauern neu berechnen
  function aktualisieren() {
    pauseAnzeigen();
    const vorlaeufig = vorlaeufigeBloecke();
    const jetzt = istHeute ? kontext.jetzt : undefined;
    kzArbeit.wert.textContent = dauer(istMinuten(vorlaeufig, datum, jetzt, einst));
    kzPause.wert.textContent = dauer(pauseGesamt(vorlaeufig, datum, jetzt, einst));
    kzSaldo.wert.textContent = dauerMitVorzeichen(tagesSaldo(vorlaeufig, abwesenheiten, einst, datum, jetzt));
    for (const z of zeilen) z.dauer.textContent = zeilenDauer(z);
    for (const e of reiseEintraege) if (!e.geloescht) reiseKopfAktualisieren(e);
  }

  // Bestehende Blöcke in zeitlicher Reihenfolge anlegen
  for (const b of urspruenglich) zeilen.push(zeileBauen(b));

  hinzuKnopf.addEventListener('click', () => {
    const z = zeileBauen(null);
    zeilen.push(z);
    rendern();
    z.beginn.input.focus();
  });

  // Dienstreise: Reisetage dieses Tages als aufklappbare Einträge. Gespeichert wird erst mit „Sichern“.
  const reiseEintraege = [];
  let reiseNr = 0;

  const reiseGruppe = document.createElement('div');
  reiseGruppe.className = 'gruppe tag-reise';
  reiseGruppe.setAttribute('role', 'group');
  reiseGruppe.setAttribute('aria-labelledby', 'tag-reise-titel');

  const reiseTitel = document.createElement('p');
  reiseTitel.className = 'eyebrow tag-gruppen-titel';
  reiseTitel.id = 'tag-reise-titel';
  reiseTitel.textContent = 'Dienstreise';

  const reiseListe = document.createElement('div');
  reiseListe.className = 'liste reise-liste';

  const reiseMarkierenKnopf = document.createElement('button');
  reiseMarkierenKnopf.type = 'button';
  reiseMarkierenKnopf.className = 'knopf klein reise-markieren';
  reiseMarkierenKnopf.textContent = 'Als Dienstreise markieren';

  const outlookBox = document.createElement('div');
  outlookBox.className = 'reise-outlook';
  outlookBox.hidden = true;

  reiseGruppe.append(reiseTitel, reiseListe, reiseMarkierenKnopf, outlookBox, landListe('tag-laender'));

  function reiseAktive() {
    return reiseEintraege.filter((e) => !e.geloescht);
  }

  // Sichtbarkeit von Liste und Knopf: der Knopf nur, solange kein Reisetag da ist
  function reiseAnsicht() {
    const aktive = reiseAktive();
    reiseListe.hidden = aktive.length === 0;
    reiseMarkierenKnopf.hidden = aktive.length > 0;
    for (const e of aktive) reiseKopfAktualisieren(e);
  }

  // Fehler aller Felder eines Eintrags entfernen
  function reiseFehlerAus(e) {
    for (const feld of Object.values(e.felder)) if (feld.fehler) feldFehler(feld, '');
  }

  // Eingaben eines Eintrags prüfen. Liefert {werte} oder {feld, text}.
  function reiseLesen(e) {
    const f = e.felder;
    const exakt = landAusEingabe(f.land.input.value);
    if (!exakt) return { feld: f.land, text: 'Dieses Land steht nicht in der Länderliste.' };
    const beginn = minutenAusUhrzeit(f.beginn.input.value);
    if (beginn === null) return { feld: f.beginn, text: 'Bitte eine Uhrzeit für den Beginn angeben.' };
    // Leeres Ende heißt 24:00
    const ende = f.ende.input.value === '' ? 1440 : minutenAusUhrzeit(f.ende.input.value);
    if (ende === null) return { feld: f.ende, text: 'Diese Uhrzeit kann ich nicht lesen.' };
    if (ende <= beginn) return { feld: f.ende, text: 'Das Ende muss nach dem Beginn liegen.' };
    const werte = {
      datum,
      land: exakt,
      beginn,
      ende,
      anlass: f.anlass.input.value.trim(),
      zusatz: f.zusatz.input.value.trim(),
      anreise: f.anreise.input.checked,
      fruehstueck: f.fruehstueck.input.checked,
      mittag: f.mittag.input.checked,
      abend: f.abend.input.checked,
    };
    for (const k of ['uebernachtung', 'fahrt', 'neben']) {
      const betrag = betragAusText(f[k].input.value);
      if (Number.isNaN(betrag)) return { feld: f[k], text: 'Bitte einen Betrag in Euro angeben, zum Beispiel 25,50.' };
      werte[k] = betrag;
    }
    return { werte };
  }

  // Kopfzeile eines Eintrags: Land, Anlass, Zeit und Verpflegung, auch bei unvollständigen Feldern
  function reiseKopfAktualisieren(e) {
    const f = e.felder;
    const exakt = landAusEingabe(f.land.input.value);
    const landText = exakt ? landAnzeige(exakt) : (f.land.input.value.trim() || 'Land fehlt');
    const anlass = f.anlass.input.value.trim();
    e.kopfTitel.textContent = anlass ? `${landText}, ${anlass}` : landText;

    const beginn = minutenAusUhrzeit(f.beginn.input.value);
    const ende = f.ende.input.value === '' ? 1440 : minutenAusUhrzeit(f.ende.input.value);
    if (beginn === null || ende === null) {
      e.kopfUnter.textContent = 'Zeit fehlt';
      e.kopfWert.textContent = 'offen';
      return;
    }
    e.kopfUnter.textContent = `${uhrzeit(beginn)} bis ${uhrzeit(ende)}`;
    const v = exakt ? verpflegung({
      land: exakt,
      beginn,
      ende,
      anreise: f.anreise.input.checked,
      fruehstueck: f.fruehstueck.input.checked,
      mittag: f.mittag.input.checked,
      abend: f.abend.input.checked,
    }) : null;
    e.kopfWert.textContent = v === null ? 'offen' : euro(v);
  }

  // Eintrag bauen: werte ist der Reisetag (neu oder gespeichert), orig der gespeicherte Eintrag oder null
  function reiseEintragBauen(werte, orig) {
    const nr = ++reiseNr;
    const id = `tag-reise-${nr}`;

    const details = document.createElement('details');
    details.className = 'reise-eintrag';

    const kopf = document.createElement('summary');
    kopf.className = 'reise-kopf';
    const kopfText = document.createElement('span');
    kopfText.className = 'liste-text';
    const kopfTitel = document.createElement('span');
    kopfTitel.className = 'liste-titel';
    const kopfUnter = document.createElement('span');
    kopfUnter.className = 'liste-unter';
    kopfText.append(kopfTitel, kopfUnter);
    const kopfWert = document.createElement('span');
    kopfWert.className = 'liste-wert';
    kopf.append(kopfText, kopfWert);

    const f = {
      land: reiseFeld(`${id}-land`, 'Land', 'text', landAnzeige(werte.land)),
      anlass: reiseFeld(`${id}-anlass`, 'Anlass und Ort', 'text', werte.anlass ?? ''),
      zusatz: reiseFeld(`${id}-zusatz`, 'Zusatz', 'text', werte.zusatz ?? ''),
      beginn: reiseFeld(`${id}-beginn`, 'Beginn', 'time', feldWert(werte.beginn)),
      ende: reiseFeld(`${id}-ende`, 'Ende (leer heißt 24:00)', 'time', werte.ende === 1440 ? '' : feldWert(werte.ende)),
      anreise: reiseSchalter(`${id}-anreise`, 'An- oder Rückreisetag', !!werte.anreise),
      fruehstueck: reiseSchalter(`${id}-fruehstueck`, 'Frühstück gestellt', !!werte.fruehstueck),
      mittag: reiseSchalter(`${id}-mittag`, 'Mittag gestellt', !!werte.mittag),
      abend: reiseSchalter(`${id}-abend`, 'Abend gestellt', !!werte.abend),
      uebernachtung: reiseFeld(`${id}-uebernachtung`, 'Übernachtung (Euro)', 'text', betragText(werte.uebernachtung)),
      fahrt: reiseFeld(`${id}-fahrt`, 'Fahrt (Euro)', 'text', betragText(werte.fahrt)),
      neben: reiseFeld(`${id}-neben`, 'Nebenkosten (Euro)', 'text', betragText(werte.neben)),
    };
    f.land.input.setAttribute('list', 'tag-laender');
    f.land.input.autocomplete = 'off';
    f.anlass.input.autocomplete = 'off';
    f.zusatz.input.autocomplete = 'off';
    for (const k of ['uebernachtung', 'fahrt', 'neben']) {
      f[k].input.inputMode = 'decimal';
      f[k].input.autocomplete = 'off';
      f[k].input.placeholder = '0,00';
    }

    const zeiten = document.createElement('div');
    zeiten.className = 'reise-zeiten';
    zeiten.append(f.beginn.box, f.ende.box);

    const schalter = document.createElement('div');
    schalter.className = 'reise-schalter-gruppe';
    schalter.append(f.anreise.box, f.fruehstueck.box, f.mittag.box, f.abend.box);

    const betraege = document.createElement('div');
    betraege.className = 'reise-betraege';
    betraege.append(f.uebernachtung.box, f.fahrt.box, f.neben.box);

    const loeschKnopf = document.createElement('button');
    loeschKnopf.type = 'button';
    loeschKnopf.className = 'knopf gefahr klein';
    loeschKnopf.textContent = 'Löschen';

    const body = document.createElement('div');
    body.className = 'reise-felder';
    body.append(f.land.box, f.anlass.box, f.zusatz.box, zeiten, schalter, betraege);

    const fuss = document.createElement('div');
    fuss.className = 'reise-eintrag-fuss';
    fuss.append(loeschKnopf);
    body.append(fuss);

    details.append(kopf, body);
    const e = { orig, geloescht: false, details, felder: f, kopfTitel, kopfUnter, kopfWert, loeschKnopf };

    loeschKnopf.addEventListener('click', () => {
      e.geloescht = true;
      details.remove();
      reiseAnsicht();
      reiseMarkierenKnopf.focus();
    });
    return e;
  }

  // Neuer Reisetag: Land Deutschland, Beginn und Ende aus den Blöcken, sonst 8:00 bis 16:00. Erst Sichern speichert.
  function reiseNeuAnlegen() {
    const gelesen = zeilen.map(zeileLesen).filter(Boolean);
    let beginn = 480;
    let ende = 960;
    if (gelesen.length > 0) {
      beginn = Math.min(...gelesen.map((l) => l.beginn));
      const enden = gelesen.map((l) => l.ende ?? (istHeute ? kontext.jetzt : null)).filter((x) => x !== null);
      if (enden.length > 0) ende = Math.max(...enden);
      if (ende <= beginn) ende = Math.min(1440, beginn + 60);
    }
    const e = reiseEintragBauen({
      datum,
      land: 'Deutschland',
      beginn,
      ende,
      anlass: '',
      zusatz: '',
      anreise: true,
      fruehstueck: false,
      mittag: false,
      abend: false,
      uebernachtung: 0,
      fahrt: 0,
      neben: 0,
    }, null);
    reiseEintraege.push(e);
    reiseListe.append(e.details);
    e.details.open = true;
    reiseAnsicht();
    return e;
  }

  reiseMarkierenKnopf.addEventListener('click', () => {
    reiseNeuAnlegen().felder.anlass.input.focus();
  });

  // Outlook-Termine des Tages (nur am Laptop). Fehler werden still ignoriert.
  async function outlookLaden() {
    if (!kontext.laptop) return;
    let termine = [];
    try {
      const antwort = await fetch(`/api/termine?von=${datum}&bis=${datum}`, { cache: 'no-store' });
      if (!antwort.ok) return;
      const daten = await antwort.json();
      termine = Array.isArray(daten) ? daten : [];
    } catch {
      return;
    }
    if (termine.length === 0) return;

    const titel = document.createElement('p');
    titel.className = 'eyebrow';
    titel.textContent = 'Outlook an diesem Tag';
    const liste = document.createElement('div');
    liste.className = 'liste';
    for (const t of termine) {
      const betreff = String(t.betreff ?? '').trim();
      const ort = String(t.ort ?? '').trim();
      const zeile = document.createElement('div');
      zeile.className = 'liste-zeile';
      const text = document.createElement('span');
      text.className = 'liste-text';
      const titelZeile = document.createElement('span');
      titelZeile.className = 'liste-titel';
      titelZeile.textContent = betreff || '(ohne Betreff)';
      const unter = document.createElement('span');
      unter.className = 'liste-unter';
      const zeit = t.ganztag ? 'ganztägig' : `${uhrzeit(t.beginn)} bis ${uhrzeit(t.ende)}`;
      unter.textContent = ort ? `${zeit}, ${ort}` : zeit;
      text.append(titelZeile, unter);
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'knopf klein';
      knopf.textContent = 'übernehmen';
      knopf.setAttribute('aria-label', `Termin ${betreff || 'ohne Betreff'} übernehmen`);
      knopf.addEventListener('click', () => terminUebernehmen(betreff, ort));
      zeile.append(text, knopf);
      liste.append(zeile);
    }
    outlookBox.replaceChildren(titel, liste);
    outlookBox.hidden = false;
  }

  // Anlass = Betreff, Ort als „Betreff, Ort“. Gibt es keinen Reisetag, wird er angelegt.
  function terminUebernehmen(betreff, ort) {
    const e = reiseAktive()[0] ?? reiseNeuAnlegen();
    e.details.open = true;
    e.felder.anlass.input.value = [betreff, ort].filter(Boolean).join(', ');
    reiseAnsicht();
    e.felder.anlass.input.focus();
  }

  // Bestehende Reisetage des Tages
  const reiseEintraegeBestand = reiseBestand.map((r) => reiseEintragBauen(r, r));
  for (const e of reiseEintraegeBestand) {
    reiseEintraege.push(e);
    reiseListe.append(e.details);
  }
  reiseAnsicht();
  outlookLaden();

  // Notiz gehört zum ersten Block des Tages
  const notizId = 'tag-notiz';
  const notizFeld = document.createElement('div');
  notizFeld.className = 'feld';
  const notizLabel = document.createElement('label');
  notizLabel.htmlFor = notizId;
  notizLabel.textContent = 'Notiz';
  const notizInput = document.createElement('textarea');
  notizInput.id = notizId;
  notizInput.name = notizId;
  notizInput.value = urspruenglich[0]?.notiz ?? '';
  const notizFehler = document.createElement('p');
  notizFehler.className = 'notiz fehler';
  notizFehler.id = notizId + '-fehler';
  notizFehler.hidden = true;
  notizInput.setAttribute('aria-describedby', notizFehler.id);
  notizFeld.append(notizLabel, notizInput, notizFehler);

  // Fußleiste: bleibt beim Scrollen unten im Sheet sichtbar
  const fuss = document.createElement('div');
  fuss.className = 'tag-fuss';

  const gesamtFehler = document.createElement('p');
  gesamtFehler.className = 'notiz fehler tag-fuss-fehler';
  gesamtFehler.setAttribute('role', 'alert');
  gesamtFehler.hidden = true;

  const knoepfe = document.createElement('div');
  knoepfe.className = 'tag-fuss-knoepfe';

  const abbrechenKnopf = document.createElement('button');
  abbrechenKnopf.type = 'button';
  abbrechenKnopf.className = 'knopf';
  abbrechenKnopf.textContent = 'Abbrechen';
  abbrechenKnopf.addEventListener('click', () => kontext.sheet.schliessen());

  const sichernKnopf = document.createElement('button');
  sichernKnopf.type = 'submit';
  sichernKnopf.className = 'knopf haupt';
  sichernKnopf.textContent = 'Sichern';

  knoepfe.append(abbrechenKnopf, sichernKnopf);
  fuss.append(gesamtFehler, knoepfe);

  // Liste der Blöcke, dann Hinzufügen, Hinweis, Pause, Notiz, Fußleiste
  form.replaceChildren(kennzahlen, liste, hinzuKnopf, heuteHinweis, pauseGruppe, reiseGruppe, notizFeld, fuss);
  rendern();

  // Prüfen und speichern
  async function absenden() {
    if (beschaeftigt) return;
    gesamtFehler.hidden = true;
    gesamtFehler.textContent = '';
    for (const z of zeilen) zeilenFehlerAus(z);
    pauseFehler.hidden = true;
    pauseFehler.textContent = '';
    pauseFeld.removeAttribute('aria-invalid');
    notizFehler.hidden = true;
    notizFehler.textContent = '';
    notizInput.removeAttribute('aria-invalid');
    for (const e of reiseEintraege) reiseFehlerAus(e);

    const gueltig = [];
    let ersterFehler = null;
    const melde = (z, input, text) => {
      zeilenFehler(z, input, text);
      if (!ersterFehler) ersterFehler = input;
    };

    let offeneZahl = 0;
    for (const z of zeilen) {
      const lesen = zeileLesen(z);
      if (!lesen) {
        melde(z, z.beginn.input, 'Beginn fehlt.');
        continue;
      }
      const { beginn, ende } = lesen;
      if (ende === null) {
        if (!istHeute) {
          melde(z, z.ende.input, 'Nur heute darf ein Block noch laufen.');
          continue;
        }
        offeneZahl++;
        if (offeneZahl > 1) {
          melde(z, z.ende.input, 'Nur ein Block darf noch laufen.');
          continue;
        }
      } else if (ende < beginn) {
        melde(z, z.ende.input, 'Ende liegt vor dem Beginn.');
        continue;
      } else if (ende === beginn) {
        melde(z, z.ende.input, 'Ende muss nach dem Beginn liegen.');
        continue;
      }
      gueltig.push({ z, beginn, ende });
    }

    // Überschneidungen in zeitlicher Reihenfolge prüfen
    const sortiert = [...gueltig].sort((a, b) => a.beginn - b.beginn);
    for (let i = 1; i < sortiert.length; i++) {
      const vorher = sortiert[i - 1];
      const jetzt = sortiert[i];
      const vorherEnde = vorher.ende ?? 1440;
      if (jetzt.beginn < vorherEnde) {
        const bis = vorher.ende === null ? 'jetzt' : uhrzeit(vorher.ende);
        melde(jetzt.z, jetzt.z.beginn.input, `Überschneidet sich mit ${uhrzeit(vorher.beginn)} bis ${bis}.`);
      }
    }

    if (zeilen.length === 0 && notizInput.value.trim() !== '') {
      notizFehler.textContent = 'Eine Notiz braucht mindestens einen Block.';
      notizFehler.hidden = false;
      notizInput.setAttribute('aria-invalid', 'true');
      if (!ersterFehler) ersterFehler = notizInput;
    }

    // Pausenfeld: nicht erkannt verhindert das Sichern
    const pauseNeu = pauseWert();
    if (pauseNeu === null) {
      pauseFehler.textContent = 'Pause nicht erkannt. Zum Beispiel 30, 0,5 oder 1:15.';
      pauseFehler.hidden = false;
      pauseFeld.setAttribute('aria-invalid', 'true');
      if (!ersterFehler) ersterFehler = pauseFeld;
    }

    // Dienstreise: aktive Einträge prüfen, Fehler öffnen den Eintrag
    const reiseGueltig = [];
    for (const e of reiseAktive()) {
      const r = reiseLesen(e);
      if (r.feld) {
        feldFehler(r.feld, r.text);
        e.details.open = true;
        if (!ersterFehler) ersterFehler = r.feld.input;
      } else {
        reiseGueltig.push({ e, werte: r.werte });
      }
    }

    if (ersterFehler) {
      ersterFehler.focus();
      return;
    }

    // Speichern: entfernte löschen, geänderte und neue schreiben.
    // Die Pause steht nur im ersten aktiven Block des Tages.
    beschaeftigt = true;
    sichernKnopf.disabled = true;
    try {
      const sortierte = [...gueltig].sort((a, b) => a.beginn - b.beginn);
      const behalten = new Set(zeilen.filter(z => z.block).map(z => z.block.id));
      for (const id of urIds) {
        if (!behalten.has(id)) await loeschen('bloecke', id);
      }
      for (let i = 0; i < sortierte.length; i++) {
        const { z, beginn, ende } = sortierte[i];
        const notiz = i === 0 ? notizInput.value.trim() : '';
        if (z.block) {
          const alt = z.block;
          const geaendert = beginn !== alt.beginn || ende !== alt.ende || notiz !== (alt.notiz ?? '')
            || (i === 0 && pauseNeu !== (alt.pause ?? null));
          if (geaendert) {
            const neu = { ...alt, beginn, ende, notiz };
            if (i === 0) neu.pause = pauseNeu;
            await speichern('bloecke', neu);
          }
        } else {
          const neu = { datum, beginn, ende, gehen: false, notiz };
          if (i === 0) neu.pause = pauseNeu;
          await speichern('bloecke', neu);
        }
      }
      // Dienstreise: gelöschte Reisetage entfernen, geänderte und neue speichern
      for (const e of reiseEintraege) {
        if (e.geloescht && e.orig) await loeschen('reisen', e.orig.id);
      }
      for (const { e, werte } of reiseGueltig) {
        if (!e.orig) {
          await speichern('reisen', werte);
        } else if (Object.keys(werte).some((k) => (e.orig[k] ?? null) !== (werte[k] ?? null))) {
          await speichern('reisen', { ...e.orig, ...werte });
        }
      }
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

  // Jede Eingabe: Kennzahlen, Dauer und Pausenschalter aktualisieren
  form.addEventListener('input', aktualisieren);
  form.addEventListener('change', aktualisieren);

  kontext.sheet.oeffnen(langesDatum(datum), form);
  return form;
}
