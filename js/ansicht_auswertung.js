// Auswertungen: ohne Parameter die Liste der Läufe (Messe-Pakete), mit Lauf-Id die Prioritätenliste eines Laufs.
// Antippen eines Kontakts öffnet ein Sheet mit Recherche, Maschinen, nächstem Schritt, Plan und Mailentwurf.
import { alle, bildLaden, einstellungenLaden } from './speicher.js';
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

// Anzahl der Kontakte eines Laufs
function anzahlKontakte(lauf) {
  return Object.keys(lauf.nummern ?? {}).length;
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
    huelle.append(el('pre', 'auswertung-text auswertung-mail', mail.text ?? ''));

    const aktionen = el('div', 'auswertung-fuss');
    const kopierKnopf = el('button', 'knopf', 'Mail kopieren');
    kopierKnopf.type = 'button';
    kopierKnopf.addEventListener('click', async () => {
      const ok = await textKopieren([mail.betreff, '', mail.text].join('\n'));
      kopierKnopf.textContent = ok ? 'Kopiert' : 'Kopieren hat nicht geklappt';
    });
    aktionen.append(kopierKnopf);
    if (text(k.email)) {
      const mailLink = el('a', 'knopf', 'In Mail öffnen');
      mailLink.href = `mailto:${k.email}?subject=${encodeURIComponent(mail.betreff ?? '')}&body=${encodeURIComponent(mail.text ?? '')}`;
      aktionen.append(mailLink);
    }
    huelle.append(aktionen);
  }

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
  zeile.addEventListener('click', () => detailOeffnen(k, kontext));

  const block = el('span', 'liste-text');
  const p = prioritaetVon(k);
  if (p) {
    const kopf = el('span', 'auswertung-zeile-kopf');
    kopf.append(el('span', `lead-prio lead-prio-${p.wert.toLowerCase()}`, `${p.wert} ${p.text}`));
    if (!text(k.lead?.prioritaet) && text(a?.prioritaet)) kopf.append(el('span', 'auswertung-vorschlag', 'Vorschlag'));
    block.append(kopf);
  }
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

// Prioritätenliste eines Laufs
async function laufZeigen(ziel, kontext, lauf) {
  const alleKontakte = (await alle('kontakte')).filter((k) => !k.geloescht);
  const ids = new Set(Object.values(lauf.nummern ?? {}).map(String));
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

  const zeitraum = zeitraumText(lauf);
  const { linkZeile, kopf } = kopfBauen(
    { text: '‹ Auswertungen', href: '#auswertung' },
    text(lauf.anlass) || 'Auswertung',
    [zeitraum, anzahlText(kontakte.length)].filter(Boolean).join(' · '),
    [paketKnopf, einlesenKnopf],
  );
  ziel.replaceChildren(linkZeile, kopf);

  if (!lauf.eingelesen) {
    ziel.append(el('p', 'notiz auswertung-hinweis',
      'Noch kein Ergebnis eingelesen. Kopiere das Paket in einen Claude-Chat und lies die Antwort ein.'));
  }
  if (kontakte.length === 0) {
    ziel.append(el('p', 'leer', 'Zu dieser Auswertung gibt es keine Kontakte mehr.'));
    return;
  }
  const liste = el('ul', 'liste auswertung-liste');
  liste.setAttribute('aria-label', 'Prioritätenliste');
  for (const k of kontakte) liste.append(kontaktZeile(k, kontext));
  ziel.append(liste);
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
