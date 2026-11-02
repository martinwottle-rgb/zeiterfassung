// Auswertungen: ohne Parameter die Liste der Läufe (Messe-Pakete), mit Lauf-Id die Prioritätenliste eines Laufs.
// Antippen eines Kontakts öffnet ein Sheet mit Recherche, Maschinen, nächstem Schritt, Plan und Mailentwurf.
import { alle, bildLaden, einstellungenLaden, speichern } from './speicher.js';
import { kontaktName } from './kontakte.js';
import { auswertungStarten, ergebnisEinlesen, paketErneutKopieren, textKopieren } from './auswertung_sheet.js';
// Namensraum statt benannter Importe: fehlt eine Funktion, bricht so nicht das ganze Modul
import * as lead from './lead.js';

const text = (s) => String(s ?? '').trim();

function el(tag, klasse, t) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (t !== undefined) e.textContent = t;
  return e;
}

// 'YYYY-MM-DD' wird zu 'TT.MM.JJJJ'
function datumDe(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(iso));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

// Zeitraum als Text: „TT.MM.JJJJ bis TT.MM.JJJJ“
function zeitraumText(lauf) {
  return [datumDe(lauf.von), datumDe(lauf.bis)].filter(Boolean).join(' bis ');
}

// Ids aller Kontakte eines Laufs (eindeutig): aus den Gruppen, sonst aus den Nummern älterer Läufe
function kontaktIdsVon(lauf) {
  const ausGruppen = Object.values(lauf.gruppen ?? {}).flat();
  const quelle = ausGruppen.length ? ausGruppen : Object.values(lauf.nummern ?? {});
  return [...new Set(quelle.map(String))];
}

// Anzahl der Kontakte eines Laufs
function anzahlKontakte(lauf) {
  return kontaktIdsVon(lauf).length;
}

function anzahlText(n) {
  return `${n} ${n === 1 ? 'Kontakt' : 'Kontakte'}`;
}

// Punktzahl eines Kontakts, sonst null
function punkte(k) {
  if (!k.auswertung) return null;
  const p = Number(lead.punktzahl(k.auswertung, k.lead));
  return Number.isFinite(p) ? p : null;
}

// Priorität als Eintrag aus LEAD_PRIORITAET: erst am Kontakt, sonst aus dem Vorschlag von Claude
function prioritaetVon(k) {
  const wert = text(k.lead?.prioritaet) || text(k.auswertung?.prioritaet);
  return (lead.LEAD_PRIORITAET ?? []).find((p) => p.wert === wert) ?? null;
}

// Reiner Text ohne Markdown-Sterne (Kopieren, Mail-App, Anzeige, Excel). Outlook bekommt die Sterne, der Server macht daraus HTML.
const ohneSterne = (t) => String(t ?? '').replace(/\*\*/g, '');

// Mailtext aus dem Ergebnis, sonst null
function mailVon(k) {
  if (!k.auswertung) return null;
  try {
    return lead.mailVollText(k.auswertung, k, lead.spracheVon(k));
  } catch (e) {
    console.warn('Mail nicht gebildet', e?.message);
    return null;
  }
}

// Maschinen als Text, egal ob Liste oder Text
function maschinenText(a) {
  return Array.isArray(a?.maschinen) ? a.maschinen.map(text).filter(Boolean).join(', ') : text(a?.maschinen);
}

// Zeitpunkt als 'TT.MM. um HH:MM'
function zeitpunktText(ms) {
  const d = new Date(ms);
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getDate())}.${z(d.getMonth() + 1)}. um ${z(d.getHours())}:${z(d.getMinutes())}`;
}

// In Bearbeitung: Bearbeitungszeitpunkt gesetzt oder noch der ältere Entwurf
const inBearbeitung = (k) => Boolean(k.auswertung?.bearbeitet || k.auswertung?.entwurf);

// Setzt bearbeitet auf jetzt, überschreibt aber keinen vorhandenen Zeitpunkt
const bearbeitetSetzen = (alt) => (alt.bearbeitet ? {} : { bearbeitet: Date.now() });

// Speichert den Bearbeitungsstand am frischen Kontakt (wie beim Entwurf), damit keine Änderungen verloren gehen.
// aenderung(alt) liefert die Felder, die gesetzt werden sollen.
async function auswertungSpeichern(k, aenderung) {
  const frisch = (await alle('kontakte')).find((x) => String(x.id) === String(k.id)) ?? k;
  const alt = frisch.auswertung ?? {};
  const neu = { ...alt, ...aenderung(alt) };
  await speichern('kontakte', { ...frisch, auswertung: neu });
  k.auswertung = neu;
}

// Am Laptop: Knopf „Als Entwurf in Outlook“ mit Meldung und Stand des letzten Entwurfs
function outlookBlock(k, mail, bearbeitung) {
  const block = el('div', 'auswertung-outlook');
  const status = el('p', 'notiz auswertung-entwurf-status');
  const meldung = el('p', 'auswertung-meldung');
  meldung.setAttribute('role', 'status');
  const knopf = el('button', 'knopf', 'Als Entwurf in Outlook');
  knopf.type = 'button';

  const stand = (ms) => {
    if (ms) {
      status.textContent = `Entwurf angelegt am ${zeitpunktText(ms)}`;
      knopf.textContent = 'Erneut als Entwurf anlegen';
    } else {
      status.textContent = '';
      knopf.textContent = 'Als Entwurf in Outlook';
    }
  };
  stand(k.auswertung?.entwurf);
  block.aktualisieren = () => stand(k.auswertung?.entwurf);

  knopf.addEventListener('click', async () => {
    knopf.disabled = true;
    knopf.textContent = 'Wird angelegt …';
    meldung.textContent = '';
    try {
      const antwort = await fetch('/api/outlook-entwurf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ an: k.email || '', betreff: mail.betreff, text: mail.text }),
      });
      const daten = await antwort.json();
      meldung.textContent = daten?.meldung || (daten?.ok ? 'Entwurf angelegt.' : 'Entwurf konnte nicht angelegt werden.');
      if (daten?.ok) {
        // Entwurf merken, dazu den Bearbeitungsbeginn, falls noch keiner gesetzt ist
        const jetzt = Date.now();
        await auswertungSpeichern(k, (alt) => ({ entwurf: jetzt, ...(alt.bearbeitet ? {} : { bearbeitet: jetzt }) }));
        bearbeitung.aktualisieren();
      }
    } catch (e) {
      console.warn('Outlook-Entwurf nicht angelegt', e?.message);
      meldung.textContent = 'Entwurf konnte nicht angelegt werden.';
    } finally {
      knopf.disabled = false;
      stand(k.auswertung?.entwurf);
    }
  });

  block.append(knopf, status, meldung);
  return block;
}

// Schalter „Als in Bearbeitung markieren“ bzw. „Wieder auf offen setzen“, darunter der Stand.
// nachAenderung zeigt die übrigen Teile des Sheets (Outlook-Block) neu an.
function bearbeitungBlock(k, nachAenderung) {
  const block = el('div', 'auswertung-bearbeitung');
  const knopf = el('button', 'knopf');
  knopf.type = 'button';
  const status = el('p', 'notiz auswertung-bearbeitung-status');

  const stand = () => {
    knopf.textContent = inBearbeitung(k) ? 'Wieder auf offen setzen' : 'Als in Bearbeitung markieren';
    status.textContent = k.auswertung?.bearbeitet ? `In Bearbeitung seit ${zeitpunktText(k.auswertung.bearbeitet)}` : '';
  };
  block.aktualisieren = stand;
  stand();

  knopf.addEventListener('click', async () => {
    knopf.disabled = true;
    try {
      if (inBearbeitung(k)) {
        await auswertungSpeichern(k, () => ({ bearbeitet: null, entwurf: null }));
      } else {
        await auswertungSpeichern(k, bearbeitetSetzen);
      }
      nachAenderung?.();
    } catch (e) {
      console.warn('Bearbeitungsstand nicht gespeichert', e?.message);
    } finally {
      knopf.disabled = false;
      stand();
    }
  });

  block.append(knopf, status);
  return block;
}

// Listenzeile eines Laufs als Link auf #auswertung/<id>
function laufZeile(lauf) {
  const a = el('a', 'liste-zeile auswertung-lauf');
  a.href = '#auswertung/' + encodeURIComponent(lauf.id);
  const block = el('span', 'liste-text');
  block.append(el('span', 'liste-titel', text(lauf.anlass) || 'Auswertung'));
  block.append(el('span', 'liste-unter', [zeitraumText(lauf), anzahlText(anzahlKontakte(lauf))].filter(Boolean).join(' · ')));
  const status = lauf.eingelesen
    ? el('span', 'auswertung-status auswertung-status-ja', 'eingelesen')
    : el('span', 'auswertung-status', 'wartet auf Ergebnis');
  a.append(block, status);
  return a;
}

// Sheet zu einem Kontakt: Name, Kartenfoto, Notiz, Abschnitte und Mail
async function detailOeffnen(k, kontext) {
  const a = k.auswertung ?? {};
  const huelle = el('div', 'auswertung-detail');
  const name = kontaktName(k);

  // Outlook-Block und Schalter zeigen den Stand neu, wenn sich der Bearbeitungsstand ändert
  let outlook = null;
  const bearbeitung = bearbeitungBlock(k, () => outlook?.aktualisieren?.());
  // Mail kopiert oder geöffnet: Bearbeitung merken, der Schalter zeigt es sofort
  const merken = () => auswertungSpeichern(k, bearbeitetSetzen)
    .then(() => bearbeitung.aktualisieren())
    .catch((e) => console.warn('Bearbeitung nicht gemerkt', e?.message));

  huelle.append(el('p', 'auswertung-detail-name', name));
  if (text(k.firma)) huelle.append(el('p', 'notiz', text(k.firma)));

  const kontaktLink = el('a', 'knopf knopf-klein', 'Kontakt öffnen');
  kontaktLink.href = '#kontakte/' + encodeURIComponent(k.id);
  kontaktLink.addEventListener('click', () => kontext.sheet.schliessen());
  huelle.append(kontaktLink);

  // Kartenfoto wird nachgeladen; fehlt es, bleibt der Platz frei
  const bildPlatz = el('div', 'auswertung-detail-bild');
  huelle.append(bildPlatz);

  if (!k.auswertung) {
    huelle.append(el('p', 'notiz', 'Noch kein Ergebnis für diesen Kontakt.'));
  }

  const abschnitt = (titel, inhalt) => {
    if (!text(inhalt)) return;
    huelle.append(el('h3', 'auswertung-abschnitt', titel), el('div', 'auswertung-text', text(inhalt)));
  };

  if (text(k.notiz)) abschnitt('Notiz', k.notiz);
  abschnitt('Recherche', a.recherche);
  const maschinen = Array.isArray(a.maschinen) ? a.maschinen.filter(Boolean).join(', ') : a.maschinen;
  abschnitt('Passende Maschinen', maschinen);
  if (text(a.schritt) || text(a.schrittText)) {
    huelle.append(el('h3', 'auswertung-abschnitt', 'Nächster Schritt'));
    if (text(a.schritt)) huelle.append(el('p', 'auswertung-schritt', text(a.schritt)));
    if (text(a.schrittText)) huelle.append(el('div', 'auswertung-text', text(a.schrittText)));
  }
  abschnitt('Plan', a.plan);

  // Mail: Betreff und Text, Zeilenumbrüche bleiben erhalten
  const mail = mailVon(k);
  if (mail && (text(mail.betreff) || text(mail.text))) {
    huelle.append(el('h3', 'auswertung-abschnitt', 'Mail'));
    if (text(mail.betreff)) huelle.append(el('p', 'auswertung-betreff', text(mail.betreff)));
    huelle.append(el('pre', 'auswertung-text auswertung-mail', ohneSterne(mail.text)));

    const aktionen = el('div', 'auswertung-fuss');
    const kopierKnopf = el('button', 'knopf', 'Mail kopieren');
    kopierKnopf.type = 'button';
    kopierKnopf.addEventListener('click', async () => {
      const ok = await textKopieren([mail.betreff, '', ohneSterne(mail.text)].join('\n'));
      kopierKnopf.textContent = ok ? 'Kopiert' : 'Kopieren hat nicht geklappt';
      if (ok) merken();
    });
    aktionen.append(kopierKnopf);
    if (text(k.email)) {
      const mailLink = el('a', 'knopf', 'In Mail öffnen');
      mailLink.href = `mailto:${k.email}?subject=${encodeURIComponent(mail.betreff ?? '')}&body=${encodeURIComponent(ohneSterne(mail.text))}`;
      mailLink.addEventListener('click', merken);
      aktionen.append(mailLink);
    }
    huelle.append(aktionen);
    if (kontext?.laptop === true) {
      outlook = outlookBlock(k, mail, bearbeitung);
      huelle.append(outlook);
    }
  }

  // Schalter nur bei vorhandenem Ergebnis, sonst wäre der Kontakt ohne Ergebnis als bearbeitet einsortiert
  if (k.auswertung) huelle.append(bearbeitung);

  kontext.sheet.oeffnen(name, huelle, { ohneRueckfrage: true });

  // Bild erst nach dem Öffnen einsetzen
  if (k.bildKarte) {
    try {
      const blob = await bildLaden(k.bildKarte);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const img = el('img', 'auswertung-bild');
        img.alt = `Kartenfoto von ${name}`;
        img.onload = () => URL.revokeObjectURL(url);
        img.src = url;
        bildPlatz.append(img);
      }
    } catch (e) {
      console.warn('Kartenfoto nicht geladen', e?.message);
    }
  }
}

// Zeile eines Kontakts im Lauf: Priorität, Firma, Name, nächster Schritt, Passung und Punktzahl
function kontaktZeile(k, kontext) {
  const a = k.auswertung;
  const li = el('li');
  const zeile = el('button', 'liste-zeile auswertung-zeile');
  zeile.type = 'button';
  if (inBearbeitung(k)) zeile.classList.add('auswertung-zeile-bearbeitet');
  zeile.addEventListener('click', () => detailOeffnen(k, kontext));

  const block = el('span', 'liste-text');
  const p = prioritaetVon(k);
  const kopf = el('span', 'auswertung-zeile-kopf');
  if (p) {
    kopf.append(el('span', `lead-prio lead-prio-${p.wert.toLowerCase()}`, `${p.wert} ${p.text}`));
    if (!text(k.lead?.prioritaet) && text(a?.prioritaet)) kopf.append(el('span', 'auswertung-vorschlag', 'Vorschlag'));
  }
  if (a?.entwurf) kopf.append(el('span', 'auswertung-entwurf', 'Entwurf'));
  else if (a?.bearbeitet) kopf.append(el('span', 'auswertung-entwurf', 'in Bearbeitung'));
  if (p || a?.entwurf || a?.bearbeitet) block.append(kopf);
  block.append(el('span', 'liste-titel', text(k.firma) || kontaktName(k)));
  const unter = [];
  if (text(k.firma)) unter.push(kontaktName(k));
  if (a) unter.push(text(a.schritt) || 'Schritt offen');
  else unter.push('noch kein Ergebnis');
  block.append(el('span', 'liste-unter', unter.filter(Boolean).join(' · ')));

  const wert = el('span', 'auswertung-wert');
  if (a) {
    if (Number.isFinite(Number(a.passung)) && text(a.passung) !== '') {
      wert.append(el('span', 'auswertung-passung', `${a.passung}/5`));
    }
    const p2 = punkte(k);
    if (p2 !== null) wert.append(el('span', 'auswertung-punkte', p2.toLocaleString('de-DE', { maximumFractionDigits: 1 })));
  }

  zeile.append(block, wert);
  li.append(zeile);
  return li;
}

// Kopf mit Zurück-Link, Titel und optionalen Knöpfen
function kopfBauen(zurueck, titel, notiz, knoepfe = []) {
  const kopf = el('header', 'kopf glas');
  const linkZeile = el('p', 'auswertung-zurueck');
  const link = el('a', 'knopf knopf-klein', zurueck.text);
  link.href = zurueck.href;
  linkZeile.append(link);
  const info = el('div');
  info.append(el('h1', null, titel));
  if (notiz) info.append(el('p', 'notiz zahl', notiz));
  kopf.append(info);
  if (knoepfe.length) {
    const nav = el('nav', 'aktionen');
    nav.setAttribute('aria-label', 'Auswertung');
    nav.append(...knoepfe);
    kopf.append(nav);
  }
  return { linkZeile, kopf };
}

// Liste der Läufe, neueste oben
async function listeZeigen(ziel, kontext, auswertungen) {
  const { linkZeile, kopf } = kopfBauen({ text: '‹ Kontakte', href: '#kontakte' }, 'Auswertungen', '');
  const neu = el('button', 'knopf haupt', 'Neue Auswertung');
  neu.type = 'button';
  neu.addEventListener('click', () => auswertungStarten(kontext));
  kopf.querySelector('div').append(el('p', 'notiz zahl', auswertungen.length
    ? `${auswertungen.length} ${auswertungen.length === 1 ? 'Auswertung' : 'Auswertungen'}`
    : 'Noch keine Auswertung'));
  const nav = el('nav', 'aktionen');
  nav.setAttribute('aria-label', 'Auswertungen');
  nav.append(neu);
  kopf.append(nav);

  ziel.replaceChildren(linkZeile, kopf);
  if (auswertungen.length === 0) {
    ziel.append(el('p', 'leer', 'Noch keine Auswertung. Starte sie über Kontakte, Auswerten.'));
    return;
  }
  const liste = el('ul', 'liste auswertung-liste');
  liste.setAttribute('aria-label', 'Auswertungen');
  for (const lauf of auswertungen) {
    const li = el('li');
    li.append(laufZeile(lauf));
    liste.append(li);
  }
  ziel.append(liste);
}

// Excel aus den Kontakten mit Ergebnis erstellen; danach Meldung mit Knopf „Ordner öffnen“
async function excelErstellen(lauf, kontakte, knopf, meldung) {
  const eintraege = kontakte.filter((k) => k.auswertung).map((k, i) => {
    const a = k.auswertung;
    const m = mailVon(k);
    return {
      rang: i + 1,
      prioritaet: text(k.lead?.prioritaet) || text(a.prioritaet),
      prioQuelle: text(k.lead?.prioritaet) ? 'Martin' : 'Claude',
      firma: text(k.firma),
      name: kontaktName(k),
      position: text(k.position),
      ort: text(k.ort),
      land: text(k.land),
      telefon: text(k.telefon),
      mobil: text(k.mobil),
      email: text(k.email),
      web: text(k.web),
      passung: text(a.passung),
      punktzahl: punkte(k) ?? '',
      schritt: text(a.schritt),
      schrittText: text(a.schrittText),
      recherche: text(a.recherche),
      maschinen: maschinenText(a),
      plan: text(a.plan),
      betreff: text(m?.betreff),
      mail: ohneSterne(text(m?.text)),
      notiz: text(k.notiz),
      lead: lead.leadText(k.lead) || '',
    };
  });

  const alt = knopf.textContent;
  knopf.disabled = true;
  knopf.textContent = 'Wird erstellt …';
  meldung.replaceChildren();
  let daten = null;
  try {
    const antwort = await fetch('/api/auswertung-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anlass: text(lauf.anlass), von: text(lauf.von), bis: text(lauf.bis), eintraege }),
    });
    daten = await antwort.json();
  } catch (e) {
    console.warn('Excel nicht erstellt', e?.message);
  }
  knopf.disabled = false;
  knopf.textContent = alt;

  if (daten?.ok) {
    const ordner = daten.ordner;
    const ordnerKnopf = el('button', 'knopf knopf-klein', 'Ordner öffnen');
    ordnerKnopf.type = 'button';
    ordnerKnopf.addEventListener('click', async () => {
      try {
        await fetch('/api/ordner-oeffnen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pfad: ordner }),
        });
      } catch (e) {
        console.warn('Ordner nicht geöffnet', e?.message);
      }
    });
    meldung.append(el('span', null, `Gespeichert: ${text(daten.datei)}`), ' ', ordnerKnopf);
  } else {
    meldung.textContent = text(daten?.fehler) || 'Excel konnte nicht erstellt werden.';
  }
}

let abschnittFolge = 0;

// Abschnitt mit klebender Überschrift „Titel (N)“ und den Zeilen; die Liste ist per aria-labelledby benannt
function abschnittBauen(titel, zeilen, kontext) {
  abschnittFolge += 1;
  const id = `auswertung-liste-kopf-${abschnittFolge}`;
  const box = el('div', 'auswertung-liste-abschnitt');
  const kopf = el('h2', 'auswertung-liste-kopf', `${titel} (${zeilen.length})`);
  kopf.id = id;
  const ul = el('ul', 'liste auswertung-liste');
  ul.setAttribute('aria-labelledby', id);
  for (const k of zeilen) ul.append(kontaktZeile(k, kontext));
  box.append(kopf, ul);
  return box;
}

// Die klebenden Abschnittsköpfe sitzen direkt unter dem Kopf der Seite
function klebeOffenSetzen(ziel, kopf) {
  const oben = parseFloat(getComputedStyle(kopf).top) || 0;
  ziel.style.setProperty('--auswertung-oben', `${oben + kopf.offsetHeight + 8}px`);
}

// Prioritätenliste eines Laufs
async function laufZeigen(ziel, kontext, lauf) {
  const alleKontakte = (await alle('kontakte')).filter((k) => !k.geloescht);
  const ids = new Set(kontaktIdsVon(lauf));
  const kontakte = alleKontakte.filter((k) => ids.has(String(k.id)));

  // Mit Punktzahl absteigend, ohne Ergebnis ganz hinten, sonst nach Name
  const nachName = (a, b) => kontaktName(a).localeCompare(kontaktName(b), 'de');
  kontakte.sort((a, b) => {
    const pa = punkte(a);
    const pb = punkte(b);
    if (pa === null && pb === null) return nachName(a, b);
    if (pa === null) return 1;
    if (pb === null) return -1;
    return (pb - pa) || nachName(a, b);
  });

  const paketKnopf = el('button', 'knopf', 'Paket kopieren');
  paketKnopf.type = 'button';
  paketKnopf.addEventListener('click', async () => {
    const ok = await paketErneutKopieren(lauf, kontext);
    if (ok) paketKnopf.textContent = 'Kopiert';
  });
  const einlesenKnopf = el('button', 'knopf haupt', 'Ergebnis einlesen');
  einlesenKnopf.type = 'button';
  einlesenKnopf.addEventListener('click', () => ergebnisEinlesen(lauf, kontext));

  // Am Laptop, nur wenn mindestens ein Kontakt ein Ergebnis hat
  const knoepfe = [paketKnopf, einlesenKnopf];
  const meldung = el('p', 'auswertung-meldung');
  meldung.setAttribute('role', 'status');
  if (kontext?.laptop === true && kontakte.some((k) => k.auswertung)) {
    const excelKnopf = el('button', 'knopf', 'Excel erstellen');
    excelKnopf.type = 'button';
    excelKnopf.addEventListener('click', () => excelErstellen(lauf, kontakte, excelKnopf, meldung));
    knoepfe.push(excelKnopf);
  }

  const zeitraum = zeitraumText(lauf);
  const { linkZeile, kopf } = kopfBauen(
    { text: '‹ Auswertungen', href: '#auswertung' },
    text(lauf.anlass) || 'Auswertung',
    [zeitraum, anzahlText(kontakte.length)].filter(Boolean).join(' · '),
    knoepfe,
  );
  ziel.replaceChildren(linkZeile, kopf, meldung);

  if (!lauf.eingelesen) {
    ziel.append(el('p', 'notiz auswertung-hinweis',
      'Noch kein Ergebnis eingelesen. Kopiere das Paket in einen Claude-Chat und lies die Antwort ein.'));
  }
  if (kontakte.length === 0) {
    ziel.append(el('p', 'leer', 'Zu dieser Auswertung gibt es keine Kontakte mehr.'));
    return;
  }
  // Zwei Abschnitte: offen oben, in Bearbeitung darunter. Innen bleibt die Punktzahl-Reihenfolge.
  // Leere Abschnitte entfallen. Die Excel-Datei nimmt weiter alle Kontakte in ihrer Reihenfolge.
  const offen = kontakte.filter((k) => !inBearbeitung(k));
  const laufend = kontakte.filter((k) => inBearbeitung(k));
  if (offen.length) ziel.append(abschnittBauen('Offen', offen, kontext));
  if (laufend.length) ziel.append(abschnittBauen('In Bearbeitung', laufend, kontext));
  klebeOffenSetzen(ziel, kopf);
}

export async function zeigen(ziel, kontext) {
  const auswertungen = (await einstellungenLaden()).auswertungen ?? [];

  if (kontext?.parameter) {
    const id = String(kontext.parameter);
    const lauf = auswertungen.find((l) => String(l.id) === id);
    if (!lauf) {
      const { linkZeile, kopf } = kopfBauen({ text: '‹ Auswertungen', href: '#auswertung' }, 'Auswertung', '');
      ziel.replaceChildren(linkZeile, kopf, el('p', 'leer', 'Diese Auswertung gibt es nicht (mehr).'));
      return;
    }
    await laufZeigen(ziel, kontext, lauf);
    return;
  }

  const sortiert = [...auswertungen].sort((a, b) => (b.erstellt ?? 0) - (a.erstellt ?? 0));
  await listeZeigen(ziel, kontext, sortiert);
}
