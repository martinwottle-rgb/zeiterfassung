// Ansicht Papierkorb (#papierkorb): alles, was in den letzten 30 Tagen gelöscht wurde, neueste zuerst.
// Wiederherstellen setzt den Grabstein zurück (geloescht: false). Auswertungen liegen in den Einstellungen,
// dort ist geloescht ein Zeitstempel (ms). Reisen werden über reiseId gruppiert; eine Reise erscheint nur,
// wenn alle ihre Tage gelöscht sind.
import { alle, einstellungenLaden, einstellungenSpeichern, speichern } from './speicher.js';
import { kontaktName } from './kontakte.js';
import { reisenGruppieren } from './reisen.js';
import { betragText } from './belege.js';
import { landAnzeige } from './reise_sheet.js';
import { uhrzeit } from './zeit.js';

const TAGE_HALTEN = 30;
const TAG_MS = 24 * 60 * 60 * 1000;

// Abschnitte in dieser Reihenfolge; leere entfallen
const ABSCHNITTE = [
  ['kontakte', 'Kontakte'],
  ['belege', 'Belege'],
  ['reisen', 'Reisen'],
  ['abwesenheiten', 'Abwesenheiten'],
  ['bloecke', 'Zeiteinträge'],
  ['auswertungen', 'Auswertungen'],
  ['ablage', 'Ablage'],
];

const ABWESENHEIT_ART = {
  urlaub: 'Urlaub',
  krank: 'Krank',
  ueberstunden: 'Überstunden',
  sonstiges: 'Sonstiges',
};

// Rückmeldung nach dem Wiederherstellen; wird beim nächsten Zeichnen angezeigt und dann geleert
let meldung = null;

const text = (s) => String(s ?? '').trim();
const zahl = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

// 'JJJJ-MM-TT' zu 'TT.MM.JJJJ'; anderes unverändert
function datumDe(s) {
  const t = text(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : t;
}

// Zeitstempel (ms) zu 'TT.MM.JJJJ' in Ortszeit
function datumVonMs(ms) {
  const d = new Date(ms);
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getDate())}.${z(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// Zeitraum von bis; ein Tag nur einmal
function zeitraumVonBis(von, bis) {
  const a = datumDe(von);
  const b = datumDe(bis);
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a} bis ${b}`;
}

// Zeitpunkt der Löschung in ms: Reisen und Auswertungen haben eigene Felder, sonst geaendert
function loeschZeit(art, e) {
  if (art === 'reisen') return zahl(e.geloeschtAm);
  if (art === 'auswertungen') return zahl(e.geloescht);
  return zahl(e.geaendert);
}

// Gelöschte Einträge der letzten 30 Tage, je Art neueste zuerst.
// Reisen: Gruppen über reiseId (bzw. Kalenderkette wie reisenGruppieren); eine Gruppe ist gelöscht,
// wenn alle ihre Tage gelöscht sind. Die Gruppe trägt geloeschtAm (Zeit des jüngsten Tags) und tage (Originale).
// jetzt: Zeitpunkt in ms (Vorgabe: jetzt).
export function papierkorbEintraege({ kontakte = [], belege = [], reisen = [], abwesenheiten = [], bloecke = [], auswertungen = [], ablage = [] }, jetzt = Date.now()) {
  const grenze = jetzt - TAGE_HALTEN * TAG_MS;
  const nachZeit = (liste) => liste
    .filter((e) => e && e.geloescht === true && zahl(e.geaendert) >= grenze)
    .sort((a, b) => zahl(b.geaendert) - zahl(a.geaendert));

  // Alle Tage (auch gelöschte) als aktiv gruppieren, damit Reisen zusammenbleiben; danach die Originale nehmen
  const original = new Map(reisen.map((r) => [r.id, r]));
  const aktivKopien = reisen
    .filter((r) => r && typeof r.datum === 'string')
    .map((r) => ({ ...r, geloescht: false }));
  const gruppen = reisenGruppieren(aktivKopien)
    .map((g) => ({ ...g, tage: g.tage.map((t) => original.get(t.id)).filter(Boolean) }))
    .filter((g) => g.tage.length > 0 && g.tage.every((t) => t.geloescht === true))
    .map((g) => ({ ...g, geloeschtAm: Math.max(...g.tage.map((t) => zahl(t.geaendert))) }))
    .filter((g) => g.geloeschtAm >= grenze)
    .sort((a, b) => b.geloeschtAm - a.geloeschtAm);

  const auswertungenGeloescht = auswertungen
    .filter((a) => a && typeof a.geloescht === 'number' && a.geloescht >= grenze)
    .sort((a, b) => b.geloescht - a.geloescht);

  return {
    kontakte: nachZeit(kontakte),
    belege: nachZeit(belege),
    reisen: gruppen,
    abwesenheiten: nachZeit(abwesenheiten),
    bloecke: nachZeit(bloecke),
    auswertungen: auswertungenGeloescht,
    ablage: nachZeit(ablage),
  };
}

// Titel und Kurzinfo einer Zeile je Art
function beschreibe(art, e) {
  switch (art) {
    case 'kontakte':
      return {
        titel: kontaktName(e),
        info: [text(e.firma), text(e.ort)].filter(Boolean).join(' · '),
      };
    case 'belege':
      return {
        titel: text(e.haendler) || text(e.kategorie) || 'Beleg',
        info: [datumDe(e.datum), betragText(e.betrag, e.waehrung)].filter(Boolean).join(' · '),
      };
    case 'reisen': {
      const tage = e.tage.length;
      return {
        titel: text(e.anlass) || 'Ohne Anlass',
        info: [landAnzeige(e.land), zeitraumVonBis(e.von, e.bis), `${tage} ${tage === 1 ? 'Tag' : 'Tage'}`].filter(Boolean).join(' · '),
      };
    }
    case 'abwesenheiten':
      return {
        titel: ABWESENHEIT_ART[e.art] ?? (text(e.art) || 'Abwesenheit'),
        info: [zeitraumVonBis(e.von, e.bis), e.halbtag ? 'halbtags' : '', text(e.notiz)].filter(Boolean).join(' · '),
      };
    case 'bloecke': {
      const ende = typeof e.ende === 'number' ? uhrzeit(e.ende) : 'laufend';
      const beginn = typeof e.beginn === 'number' ? uhrzeit(e.beginn) : '';
      return {
        titel: [datumDe(e.datum), [beginn, ende].filter(Boolean).join(' bis ')].filter(Boolean).join(', '),
        info: text(e.notiz),
      };
    }
    case 'auswertungen':
      return {
        titel: text(e.anlass) || 'Auswertung',
        info: zeitraumVonBis(e.von, e.bis),
      };
    case 'ablage': {
      const n = (e.dateien ?? []).length;
      return {
        titel: [text(e.firma) || 'Ohne Zuordnung', text(e.art)].filter(Boolean).join(' · '),
        info: `${n} ${n === 1 ? 'Datei' : 'Dateien'}`,
      };
    }
    default:
      return { titel: 'Eintrag', info: '' };
  }
}

// Stellt einen Eintrag wieder her. Jede Speicherung meldet daten-geaendert, die Ansicht zeichnet sich danach neu.
async function wiederherstellen(art, e) {
  if (art === 'reisen') {
    for (const tag of e.tage) await speichern('reisen', { ...tag, geloescht: false });
    return;
  }
  if (art === 'auswertungen') {
    const einst = await einstellungenLaden();
    const liste = (einst.auswertungen ?? []).map((l) => {
      if (String(l.id) !== String(e.id)) return l;
      const frei = { ...l };
      delete frei.geloescht;
      return frei;
    });
    await einstellungenSpeichern({ ...einst, auswertungen: liste });
    return;
  }
  await speichern(art, { ...e, geloescht: false });
}

function el(tag, klasse = null, inhalt = null) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (inhalt != null) e.textContent = inhalt;
  return e;
}

// Eine Zeile: Titel, darunter „gelöscht am“ und Kurzinfo, rechts der Knopf
function zeileBauen(art, e, kontext) {
  const { titel, info } = beschreibe(art, e);
  const zeit = loeschZeit(art, e);
  const zeile = el('div', 'liste-zeile papierkorb-zeile');
  const textBlock = el('span', 'liste-text');
  textBlock.append(
    el('span', 'liste-titel', titel),
    el('span', 'liste-unter', [`gelöscht am ${datumVonMs(zeit)}`, info].filter(Boolean).join(' · ')),
  );
  const knopf = el('button', 'knopf knopf-klein', 'Wiederherstellen');
  knopf.type = 'button';
  knopf.setAttribute('aria-label', `Wiederherstellen: ${titel}`);
  knopf.addEventListener('click', async () => {
    knopf.disabled = true;
    try {
      await wiederherstellen(art, e);
      meldung = 'Wiederhergestellt';
      await kontext.neuZeichnen();
    } catch (err) {
      console.error(err);
      knopf.disabled = false;
      const status = document.querySelector('#ansicht [data-status]');
      if (status) status.textContent = 'Das konnte nicht wiederhergestellt werden.';
    }
  });
  zeile.append(textBlock, knopf);
  const li = el('li');
  li.append(zeile);
  return li;
}

export async function zeigen(ziel, kontext) {
  const [kontakte, belege, reisen, abwesenheiten, bloecke, einst, ablage] = await Promise.all([
    alle('kontakte'),
    alle('belege'),
    alle('reisen'),
    alle('abwesenheiten'),
    alle('bloecke'),
    einstellungenLaden(),
    alle('ablage'),
  ]);
  const eintraege = papierkorbEintraege({
    ablage,
    kontakte,
    belege,
    reisen,
    abwesenheiten,
    bloecke,
    auswertungen: einst.auswertungen ?? [],
  });
  const gesamt = ABSCHNITTE.reduce((n, [art]) => n + eintraege[art].length, 0);

  ziel.innerHTML = `
    <header class="kopf glas">
      <div>
        <h1>Papierkorb</h1>
        <p class="notiz zahl">Gelöschtes der letzten 30 Tage</p>
      </div>
    </header>
  `;
  const status = el('p', 'notiz papierkorb-status');
  status.setAttribute('role', 'status');
  status.setAttribute('data-status', '');
  status.textContent = meldung ?? '';
  meldung = null;
  ziel.append(status);

  if (gesamt === 0) {
    ziel.append(el('p', 'leer', 'Der Papierkorb ist leer.'));
    return;
  }

  for (const [art, titel] of ABSCHNITTE) {
    const liste = eintraege[art];
    if (liste.length === 0) continue;
    const kopf = el('h2', 'papierkorb-abschnitt', titel);
    const ul = el('ul', 'liste papierkorb-liste');
    for (const e of liste) ul.append(zeileBauen(art, e, kontext));
    ziel.append(kopf, ul);
  }
}
