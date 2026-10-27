// QR-Code im Foto suchen mit jsQR (lokal aus web/vendor/qr/). jsQR findet dichte Codes nur in passender
// Auflösung, daher werden nacheinander mehrere Bildbreiten probiert; Abbruch beim ersten Treffer.
const JSQR_JS = new URL('../vendor/qr/jsQR.js', import.meta.url).href;
const BREITEN = [800, 1000, 600, 1400, 400];

let skriptLadung = null;

// jsQR genau einmal per <script> laden (das UMD-Skript setzt window.jsQR)
function jsQRLaden() {
  if (globalThis.jsQR) return Promise.resolve(globalThis.jsQR);
  if (!skriptLadung) {
    skriptLadung = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSQR_JS;
      s.async = true;
      s.onload = () => {
        if (globalThis.jsQR) {
          resolve(globalThis.jsQR);
        } else {
          skriptLadung = null;
          reject(new Error('Der QR-Leser ist nicht verfügbar.'));
        }
      };
      s.onerror = () => {
        skriptLadung = null;
        s.remove();
        reject(new Error('Der QR-Leser konnte nicht geladen werden.'));
      };
      document.head.append(s);
    });
  }
  return skriptLadung;
}

// Zeichenfläche in gewünschter Größe (OffscreenCanvas, sonst normales Canvas)
function flaeche(breite, hoehe) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(breite, hoehe);
  const c = document.createElement('canvas');
  c.width = breite;
  c.height = hoehe;
  return c;
}

// Sucht einen QR-Code im Bild. Eingabe: Blob, ImageBitmap oder Canvas.
// Liefert {text, ecken} mit den vier Ecken (oben links, oben rechts, unten rechts, unten links)
// in Koordinaten des Originalbildes, oder null.
export async function qrSuchen(bildOderBlob) {
  const jsQR = await jsQRLaden();
  let quelle = bildOderBlob;
  let eigenesBitmap = null;
  if (typeof Blob !== 'undefined' && bildOderBlob instanceof Blob) {
    eigenesBitmap = await createImageBitmap(bildOderBlob);
    quelle = eigenesBitmap;
  }
  try {
    const W = quelle.width;
    const H = quelle.height;
    if (!W || !H) return null;
    for (const breite of BREITEN) {
      const hoehe = Math.max(1, Math.round((H * breite) / W));
      const c = flaeche(breite, hoehe);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(quelle, 0, 0, breite, hoehe);
      const pixel = ctx.getImageData(0, 0, breite, hoehe);
      let code = null;
      try {
        code = jsQR(pixel.data, breite, hoehe, { inversionAttempts: 'attemptBoth' });
      } catch {
        code = null;
      }
      if (code?.location) {
        const sx = W / breite;
        const sy = H / hoehe;
        const l = code.location;
        const punkt = (p) => ({ x: p.x * sx, y: p.y * sy });
        return {
          text: code.data ?? '',
          ecken: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner].map(punkt),
        };
      }
    }
    return null;
  } finally {
    eigenesBitmap?.close?.();
  }
}
