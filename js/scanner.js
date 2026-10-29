// Vollbild-Scanner für Visitenkarten, wie „Dokumente scannen“: Kamera mit erkanntem Rahmen, Auslösen von Hand
// oder automatisch nach 0,8 s Ruhe, Vorschau-Streifen für Vorderseite, Rückseite und Notiz.
// Ohne Kamera (oder bei Ablehnung) wird ein Foto gewählt; es wird genauso erkannt und entzerrt.
// Die Ebene liegt über allen Sheets. Fertig liefert [{rolle, blob}], Abbrechen null.
import { entzerren, zuschneiden } from './zuschnitt.js';

const ROLLEN = ['Vorderseite', 'Rückseite', 'Notiz'];
const TAKT_MS = 150; // Erkennung alle 150 ms
const DETEKTION_BREITE = 640; // Einzelbild für die Erkennung, in px
const RUHE_MS = 800; // so lange der Rahmen stillhalten muss, bevor automatisch ausgelöst wird
const RUHE_ANTEIL = 0.02; // Eckenbewegung je Takt, bezogen auf die Bildgröße, die noch als ruhig gilt
const FEHLT_MAX = 4; // so viele Takte ohne Karte, dann gilt die Karte als weggenommen
const AUSGABE_MAX = 2400; // längste Seite des Ergebnisses in px
const EINGANG_MAX = 3200; // Fotos aus der Auswahl werden höchstens so groß gerechnet
const QUALITAET = 0.9;
const MELDUNG_MS = 2500;
const KAMERA = { video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } } };
const FEHLER_FORMAT = 'Dieses Bildformat kann der Browser nicht öffnen.';

// Erkennung aus kantenerkennung.js, erst beim ersten Scannen geladen. Fehlt das Modul,
// läuft der Scanner ohne automatischen Rahmen weiter; das Foto wird dann als Ganzes übernommen.
let erkennungModul = null;
function erkennung() {
  erkennungModul ??= import('./kantenerkennung.js').catch(() => null);
  return erkennungModul;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Die vier Ecken in der Reihenfolge oben links, oben rechts, unten rechts, unten links
function ordnen(punkte) {
  if (!Array.isArray(punkte) || punkte.length !== 4) return null;
  if (!punkte.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))) return null;
  const summe = punkte.map((p) => p.x + p.y);
  const differenz = punkte.map((p) => p.x - p.y);
  const reihenfolge = [
    summe.indexOf(Math.min(...summe)),
    differenz.indexOf(Math.max(...differenz)),
    summe.indexOf(Math.max(...summe)),
    differenz.indexOf(Math.min(...differenz)),
  ];
  if (new Set(reihenfolge).size !== 4) return null;
  return reihenfolge.map((i) => ({ x: punkte[i].x, y: punkte[i].y }));
}

const abstand = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// Zielgröße der Entzerrung aus den Kantenlängen, längste Seite höchstens AUSGABE_MAX
function zielMasse(e) {
  const breite = Math.max(abstand(e[0], e[1]), abstand(e[3], e[2]));
  const hoehe = Math.max(abstand(e[0], e[3]), abstand(e[1], e[2]));
  const f = Math.min(1, AUSGABE_MAX / Math.max(breite, hoehe, 1));
  return { breite: Math.max(1, Math.round(breite * f)), hoehe: Math.max(1, Math.round(hoehe * f)) };
}

// Leinwand als JPEG. Mit Ecken wird perspektivisch entzerrt, sonst das ganze Bild.
async function jpeg(leinwand, ecken) {
  let ausgabe = leinwand;
  if (ecken) {
    try {
      const m = zielMasse(ecken);
      const daten = leinwand.getContext('2d').getImageData(0, 0, leinwand.width, leinwand.height);
      const bild = entzerren(daten, ecken, m.breite, m.hoehe);
      ausgabe = document.createElement('canvas');
      ausgabe.width = m.breite;
      ausgabe.height = m.hoehe;
      ausgabe.getContext('2d').putImageData(bild, 0, 0);
    } catch (e) {
      console.warn('Entzerren nicht möglich, es wird das ganze Bild genommen', e);
      ausgabe = leinwand;
    }
  }
  const blob = await new Promise((r) => ausgabe.toBlob(r, 'image/jpeg', QUALITAET));
  if (!blob) throw new Error('Das Foto konnte nicht gespeichert werden.');
  return blob;
}

// Foto aus der Auswahl als Leinwand, höchstens EINGANG_MAX groß
function bildAusDatei(datei) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(FEHLER_FORMAT));
    };
    img.src = url;
  });
}

async function leinwandAusDatei(datei) {
  let quelle;
  try {
    quelle = await createImageBitmap(datei);
  } catch {
    quelle = await bildAusDatei(datei); // Safari wandelt HEIC beim Laden von <img> um
  }
  const w0 = quelle.naturalWidth || quelle.width;
  const h0 = quelle.naturalHeight || quelle.height;
  if (!w0 || !h0) throw new Error(FEHLER_FORMAT);
  const f = Math.min(1, EINGANG_MAX / Math.max(w0, h0));
  const leinwand = document.createElement('canvas');
  leinwand.width = Math.max(1, Math.round(w0 * f));
  leinwand.height = Math.max(1, Math.round(h0 * f));
  const ctx = leinwand.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(quelle, 0, 0, leinwand.width, leinwand.height);
  quelle.close?.();
  return leinwand;
}

// Karte auf einer Leinwand erkennen: vier Ecken in Pixeln der Leinwand, oder null
async function kartenEcken(leinwand, seitenVerhaeltnis) {
  const k = await erkennung();
  if (!k?.karteErkennen) return null;
  try {
    const fund = await k.karteErkennen(leinwand, seitenVerhaeltnis ? { seiten: seitenVerhaeltnis } : {});
    if (!fund) return null;
    const ecken = ordnen(fund.ecken);
    if (ecken) ecken.sicher = fund.wert >= 0.6;   // nur sichere Funde lösen automatisch aus
    return ecken;
  } catch (e) {
    console.warn('Kartenerkennung ohne Ergebnis', e);
    return null;
  }
}

// OpenCV ist erst bereit, wenn karteErkennen einmal gelaufen ist (dabei wird es geladen)
function istBereit(k) {
  return Boolean(k?.istBereit ? k.istBereit() : true);
}

// Öffnet den Scanner. Liefert [{rolle, blob}] (JPEG) oder null bei Abbrechen.
// kontext.sheet wird nur gebraucht, wenn ein Foto nachgezogen wird (Zuschnitt).
// seitenVerhaeltnis: [min, max] für die Rahmenerkennung (ohne Angabe: Visitenkarte; Belege: BELEG_SEITEN)
export function scannen(kontext, { seiten = ROLLEN, seitenVerhaeltnis = null, wort = 'Karte', titel = 'Visitenkarte scannen' } = {}) {
  const rollen = seiten.length ? [...seiten] : [...ROLLEN];
  return new Promise((ergebnis) => {
    const vorher = document.activeElement;
    const rahmenEl = document.querySelector('.rahmen');
    const aufnahmen = new Map(); // rolle → { rolle, blob, url }
    const det = document.createElement('canvas'); // verkleinertes Einzelbild für die Erkennung
    const detKtx = det.getContext('2d', { willReadFrequently: true });
    const akzent = getComputedStyle(document.documentElement).getPropertyValue('--akzent').trim() || '#d7261e';

    let modus = 'start'; // start | kamera | datei
    let rolle = rollen[0];
    let kamera = null;
    let beendet = false;
    let ausgeblendet = false;
    let auto = true; // löst nur bei sicherer Erkennung (Wert ab 0,6) aus
    let gesperrt = false; // nach einer Auto-Aufnahme erst wieder, wenn die Karte weg war
    let fehlt = 0;
    let letzteEcken = null; // in Pixeln von det
    let ruheEcken = null;
    let ruheSeit = 0;
    let bereit = false;
    let kanteFehlt = false;
    let modulKante = null; // kantenerkennung.js, sobald geladen
    let erkennungLaeuft = false;
    let arbeitet = false;
    let meldung = '';
    let meldungFehler = false;
    let meldungBis = 0;
    let rahmenGroesse = { w: 0, h: 0 };

    // Aufbau
    const huelle = el('div', 'scanner');
    huelle.setAttribute('role', 'dialog');
    huelle.setAttribute('aria-modal', 'true');
    huelle.setAttribute('aria-label', titel);

    const bild = el('div', 'scanner-bild');
    const video = el('video', 'scanner-video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('aria-hidden', 'true');
    const overlay = el('canvas', 'scanner-rahmen');
    overlay.setAttribute('aria-hidden', 'true');
    const ohneKamera = el('div', 'scanner-ohne-kamera', `Die Kamera steht nicht zur Verfügung. Mit dem runden Knopf ein Foto ${wort === 'Karte' ? 'der Karte' : 'des Belegs'} wählen.`);
    ohneKamera.hidden = true;
    const blitz = el('div', 'scanner-blitz');
    blitz.setAttribute('aria-hidden', 'true');
    blitz.addEventListener('animationend', () => blitz.classList.remove('aktiv'));
    bild.append(video, overlay, ohneKamera, blitz);

    const abbrechen = el('button', 'scanner-knopf', 'Abbrechen');
    abbrechen.type = 'button';
    const schalter = document.createElement('input');
    schalter.type = 'checkbox';
    schalter.checked = true;
    schalter.setAttribute('role', 'switch');
    const schalterWort = el('span', null, 'Automatisch');
    const schalterFeld = el('label', 'scanner-schalter');
    schalterFeld.append(schalter, schalterWort);
    schalterFeld.hidden = true;
    const kopf = el('div', 'scanner-kopf');
    kopf.append(abbrechen, schalterFeld);

    const hinweis = el('p', 'scanner-hinweis');
    hinweis.setAttribute('role', 'status');
    hinweis.setAttribute('aria-live', 'polite');

    const mitte = el('div', 'scanner-mitte');

    const streifen = el('div', 'scanner-streifen');
    streifen.setAttribute('aria-label', 'Aufgenommene Seiten');
    streifen.hidden = true;
    const rollenReihe = el('div', 'scanner-rollen');
    rollenReihe.setAttribute('role', 'group');
    rollenReihe.setAttribute('aria-label', 'Seite der nächsten Aufnahme');
    const rollenKnoepfe = rollen.map((r) => {
      const knopf = el('button', 'scanner-rolle', r);
      knopf.type = 'button';
      knopf.setAttribute('aria-pressed', 'false');
      knopf.addEventListener('click', () => {
        rolle = r;
        rollenZeichnen();
      });
      return knopf;
    });
    rollenReihe.append(...rollenKnoepfe);
    const ausloeser = el('button', 'scanner-ausloeser');
    ausloeser.type = 'button';
    ausloeser.disabled = true;
    const fertig = el('button', 'scanner-fertig', 'Fertig');
    fertig.type = 'button';
    fertig.disabled = true;
    const reihe = el('div', 'scanner-reihe');
    reihe.append(el('span'), ausloeser, fertig);
    const unten = el('div', 'scanner-unten');
    unten.append(streifen, rollenReihe, reihe);

    const dateiEingabe = document.createElement('input');
    dateiEingabe.type = 'file';
    dateiEingabe.accept = 'image/*';
    dateiEingabe.className = 'nur-sr';
    dateiEingabe.tabIndex = -1;
    dateiEingabe.setAttribute('aria-hidden', 'true');

    huelle.append(bild, kopf, hinweis, mitte, unten, dateiEingabe);

    // Anzeige ---------------------------------------------------------

    function hinweisSetzen(text, fehler = false) {
      if (hinweis.textContent !== text) hinweis.textContent = text;
      hinweis.classList.toggle('fehler', fehler);
    }

    function melden(text, fehler = false) {
      meldung = text;
      meldungFehler = fehler;
      meldungBis = performance.now() + MELDUNG_MS;
      hinweisSetzen(text, fehler);
    }

    // Der Zustand bestimmt den Hinweis, eine kurze Meldung hat Vorrang
    function hinweisAktualisieren() {
      if (performance.now() < meldungBis) {
        hinweisSetzen(meldung, meldungFehler);
        return;
      }
      let text;
      if (modus === 'start') text = 'Kamera wird eingeschaltet …';
      else if (modus === 'datei') text = `Ein Foto ${ohneRahmen() ? 'der Notiz' : wort === 'Karte' ? 'der Karte' : 'des Belegs'} wählen.`;
      else if (ohneRahmen()) text = 'Notiz ins Bild halten. Zum Aufnehmen auf den Knopf tippen, das ganze Bild wird übernommen.';
      else if (kanteFehlt) text = `${wort} ins Bild halten. Zum Aufnehmen auf den Knopf tippen.`;
      else if (video.readyState < 2) text = 'Kamera wird eingeschaltet …';
      else if (!bereit) text = 'Erkennung wird geladen …';
      else if (!letzteEcken) text = `${wort} ins Bild halten`;
      else if (!auto) text = `${wort} erkannt. Zum Aufnehmen auf den Knopf tippen.`;
      else if (gesperrt) text = `${wort} wenden oder wegnehmen für die nächste Seite.`;
      else text = 'Ruhig halten …';
      hinweisSetzen(text);
    }

    // Notizen sind Zettel beliebiger Form: keine Kartensuche, das ganze Bild wird übernommen
    function ohneRahmen() { return rolle === 'Notiz'; }

    function rollenZeichnen() {
      if (ohneRahmen() && letzteEcken) {
        letzteEcken = null;
        ruheEcken = null;
        rahmenZeichnen();
      }
      rollenKnoepfe.forEach((knopf, i) => knopf.setAttribute('aria-pressed', String(rollen[i] === rolle)));
      ausloeser.setAttribute('aria-label', modus === 'datei' ? `Foto als ${rolle} wählen` : `Foto als ${rolle} aufnehmen`);
    }

    function eintragBauen(a) {
      const eintrag = el('div', 'scanner-eintrag');
      const vorschau = el('button', 'scanner-vorschau');
      vorschau.type = 'button';
      vorschau.setAttribute('aria-label', `${a.rolle}, antippen zum Nachziehen`);
      const img = new Image();
      img.alt = '';
      img.src = a.url;
      vorschau.append(img);
      vorschau.addEventListener('click', () => nachziehen(a.rolle));
      const name = el('p', 'scanner-eintrag-name', a.rolle);
      const wieder = el('button', 'scanner-wiederholen', 'Wiederholen');
      wieder.type = 'button';
      wieder.addEventListener('click', () => wiederholen(a.rolle));
      eintrag.append(vorschau, name, wieder);
      return eintrag;
    }

    function streifenZeichnen() {
      const eintraege = rollen.filter((r) => aufnahmen.has(r)).map((r) => eintragBauen(aufnahmen.get(r)));
      streifen.replaceChildren(...eintraege);
      streifen.hidden = eintraege.length === 0;
      fertig.disabled = eintraege.length === 0;
    }

    function rahmenZeichnen() {
      const ctx = overlay.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      if (!letzteEcken || modus !== 'kamera' || !video.videoWidth || !rahmenGroesse.w) return;
      const dpr = overlay.width / rahmenGroesse.w;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Die Anzeige füllt den Bildschirm (object-fit: cover): Bildmitte und Skalierung wie bei der Anzeige
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const kx = vw / det.width;
      const ky = vh / det.height;
      const s = Math.max(rahmenGroesse.w / vw, rahmenGroesse.h / vh);
      const ox = (rahmenGroesse.w - vw * s) / 2;
      const oy = (rahmenGroesse.h - vh * s) / 2;
      const punkte = letzteEcken.map((p) => ({ x: p.x * kx * s + ox, y: p.y * ky * s + oy }));
      ctx.beginPath();
      punkte.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = akzent;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = akzent;
      ctx.stroke();
    }

    function anpassen() {
      const r = bild.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      rahmenGroesse = { w: r.width, h: r.height };
      overlay.width = Math.max(1, Math.round(r.width * dpr));
      overlay.height = Math.max(1, Math.round(r.height * dpr));
      rahmenZeichnen();
    }

    // Aufnahmen ------------------------------------------------------

    function naechsteRolle() {
      return rollen.find((r) => !aufnahmen.has(r)) ?? rolle;
    }

    function ablegen(r, blob) {
      const alt = aufnahmen.get(r);
      if (alt) URL.revokeObjectURL(alt.url);
      aufnahmen.set(r, { rolle: r, blob, url: URL.createObjectURL(blob) });
      streifenZeichnen();
      rollenZeichnen();
    }

    function aufgenommen(r) {
      melden(rolle !== r ? `${r} aufgenommen. Als Nächstes: ${rolle}.` : `${r} aufgenommen.`);
    }

    function blitzZeigen() {
      blitz.classList.remove('aktiv');
      void blitz.offsetWidth;
      blitz.classList.add('aktiv');
    }

    function bildAusVideo() {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      return c;
    }

    // Ruhig: alle vier Ecken bewegen sich zwischen zwei Takten nur wenig
    function ruhigPruefen(a, b) {
      return a.every((p, i) => Math.abs(p.x - b[i].x) <= RUHE_ANTEIL * det.width
        && Math.abs(p.y - b[i].y) <= RUHE_ANTEIL * det.height);
    }

    function aktualisieren(ecken) {
      const jetzt = performance.now();
      if (!ecken) {
        fehlt += 1;
        letzteEcken = null;
        ruheEcken = null;
        if (fehlt >= FEHLT_MAX) gesperrt = false;
        rahmenZeichnen();
        return;
      }
      fehlt = 0;
      if (!ruheEcken || !ruhigPruefen(ecken, ruheEcken)) ruheSeit = jetzt;
      letzteEcken = ecken;
      ruheEcken = ecken;
      rahmenZeichnen();
      if (auto && ecken.sicher && !gesperrt && !arbeitet && jetzt - ruheSeit >= RUHE_MS) aufnehmen(true);
    }

    // Ein Lauf zur Zeit. Der erste Lauf lädt OpenCV, deshalb wartet die Schleife dann.
    async function erkennen() {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh || erkennungLaeuft) return;
      erkennungLaeuft = true;
      try {
        const f = Math.min(1, DETEKTION_BREITE / vw);
        const w = Math.max(1, Math.round(vw * f));
        const h = Math.max(1, Math.round(vh * f));
        if (det.width !== w || det.height !== h) {
          det.width = w;
          det.height = h;
        }
        detKtx.drawImage(video, 0, 0, w, h);
        const ecken = await kartenEcken(det, seitenVerhaeltnis);
        bereit = istBereit(modulKante);
        if (!beendet && !ohneRahmen()) aktualisieren(ecken);
      } finally {
        erkennungLaeuft = false;
      }
    }

    // Aufnahme aus dem Video in voller Auflösung, mit den letzten Ecken entzerrt
    async function aufnehmen(istAuto = false) {
      if (arbeitet || beendet) return;
      if (!video.videoWidth) {
        melden('Die Kamera startet noch. Gleich noch einmal tippen.', true);
        return;
      }
      arbeitet = true;
      const r = rolle;
      try {
        const kx = video.videoWidth / det.width;
        const ky = video.videoHeight / det.height;
        const ecken = letzteEcken && !ohneRahmen() ? letzteEcken.map((p) => ({ x: p.x * kx, y: p.y * ky })) : null;
        const blob = await jpeg(bildAusVideo(), ecken);
        ablegen(r, blob);
        rolle = naechsteRolle();
        rollenZeichnen();
        if (istAuto) gesperrt = true;
        blitzZeigen();
        aufgenommen(r);
      } catch (e) {
        console.error(e);
        melden('Das Foto konnte nicht gespeichert werden. Bitte noch einmal.', true);
      } finally {
        arbeitet = false;
      }
    }

    // Foto aus der Auswahl: gleiche Erkennung und Entzerrung wie bei der Kamera
    async function dateiVerarbeiten(datei) {
      if (arbeitet || beendet) return;
      arbeitet = true;
      const r = rolle;
      melden('Das Foto wird erkannt …');
      try {
        const leinwand = await leinwandAusDatei(datei);
        const blob = await jpeg(leinwand, ohneRahmen() ? null : await kartenEcken(leinwand, seitenVerhaeltnis));
        ablegen(r, blob);
        rolle = naechsteRolle();
        rollenZeichnen();
        aufgenommen(r);
      } catch (e) {
        console.error(e);
        melden(e?.message || 'Das Foto konnte nicht verarbeitet werden.', true);
      } finally {
        arbeitet = false;
      }
    }

    function ausblenden(an) {
      ausgeblendet = an;
      huelle.hidden = an;
      if (!an) anpassen();
    }

    // Zuschnitt zum Nachziehen: der Scanner tritt zurück, das Sheet zeigt den Zuschnitt
    async function nachziehen(r) {
      const a = aufnahmen.get(r);
      if (!a || arbeitet || beendet) return;
      ausblenden(true);
      let neu = null;
      try {
        neu = await zuschneiden(a.blob, kontext);
      } catch (e) {
        melden(e?.message || 'Das Foto konnte nicht geöffnet werden.', true);
      }
      ausblenden(false);
      if (neu && !beendet) ablegen(r, neu);
    }

    function wiederholen(r) {
      if (arbeitet || beendet) return;
      const a = aufnahmen.get(r);
      if (a) {
        URL.revokeObjectURL(a.url);
        aufnahmen.delete(r);
      }
      rolle = r;
      gesperrt = false;
      streifenZeichnen();
      rollenZeichnen();
      melden(`${r} wird neu aufgenommen.`);
    }

    // Kamera -----------------------------------------------------------

    async function kameraStarten() {
      if (!navigator.mediaDevices?.getUserMedia) return false;
      try {
        kamera = await navigator.mediaDevices.getUserMedia(KAMERA);
      } catch (e) {
        console.warn('Kamera nicht verfügbar', e?.name);
        return false;
      }
      if (beendet) {
        stopKamera();
        return false;
      }
      video.srcObject = kamera;
      try {
        await video.play();
      } catch {
        // Ohne sofortigen Start wartet die Schleife, bis Bilder da sind
      }
      return true;
    }

    function stopKamera() {
      kamera?.getTracks().forEach((t) => t.stop());
      kamera = null;
      video.srcObject = null;
    }

    // Takt: alle 150 ms erkennen (nur mit Kamera und sichtbar), Hinweis aktualisieren
    async function schleife() {
      while (!beendet) {
        const start = performance.now();
        hinweisAktualisieren();
        if (modus === 'kamera' && !ausgeblendet && !kanteFehlt && !ohneRahmen() && video.readyState >= 2) await erkennen();
        await pause(Math.max(0, TAKT_MS - (performance.now() - start)));
      }
    }

    async function starten() {
      modulKante = await erkennung();
      kanteFehlt = !modulKante?.karteErkennen;
      const mitKamera = await kameraStarten();
      if (beendet) return;
      if (mitKamera) {
        modus = 'kamera';
        schalterFeld.hidden = false;
      } else {
        modus = 'datei';
        ohneKamera.hidden = false;
      }
      ausloeser.disabled = false;
      rollenZeichnen();
      ausloeser.focus({ preventScroll: true });
    }

    // Ende ------------------------------------------------------------

    function taste(e) {
      if (e.key === 'Escape' && !ausgeblendet) {
        e.preventDefault();
        beenden(null);
      }
    }

    function beenden(erg) {
      if (beendet) return;
      beendet = true;
      stopKamera();
      window.removeEventListener('keydown', taste);
      window.removeEventListener('resize', anpassen);
      aufnahmen.forEach((a) => URL.revokeObjectURL(a.url));
      aufnahmen.clear();
      huelle.remove();
      if (rahmenEl) rahmenEl.inert = false;
      if (vorher?.isConnected) vorher.focus({ preventScroll: true });
      ergebnis(erg);
    }

    // Ereignisse ---------------------------------------------------------

    abbrechen.addEventListener('click', () => beenden(null));
    schalter.addEventListener('change', () => {
      auto = schalter.checked;
    });
    ausloeser.addEventListener('click', () => {
      if (modus === 'datei') dateiEingabe.click();
      else if (modus === 'kamera') aufnehmen(false);
    });
    dateiEingabe.addEventListener('change', () => {
      const datei = dateiEingabe.files?.[0];
      dateiEingabe.value = '';
      if (datei) dateiVerarbeiten(datei);
    });
    fertig.addEventListener('click', () => {
      if (!aufnahmen.size || arbeitet) return;
      beenden(rollen.filter((r) => aufnahmen.has(r)).map((r) => ({ rolle: r, blob: aufnahmen.get(r).blob })));
    });
    window.addEventListener('keydown', taste);
    window.addEventListener('resize', anpassen);

    // Start: Sheet-Inhalte hinter dem Scanner sind für Bedienhilfen nicht erreichbar
    if (rahmenEl) rahmenEl.inert = true;
    document.body.append(huelle);
    rollenZeichnen();
    streifenZeichnen();
    anpassen();
    schleife();
    starten();
  });
}
