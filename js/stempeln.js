// Stempeln: Kommen, Pause, Gehen und der Mitternachtswechsel. Schreibt über speicher.js.
import { alle, speichern, loeschen } from './speicher.js';
import { heute, jetztMinuten, uhrzeit } from './zeit.js';
import { bloeckeAm } from './rechnen.js';

// Alle Vorgänge laufen nacheinander, damit schnelle Doppeltipps nicht gegeneinander lesen.
let kette = Promise.resolve();
function nacheinander(aufgabe) {
  const ergebnis = kette.then(aufgabe);
  kette = ergebnis.catch(() => {});
  return ergebnis;
}

// `zeit` in Minuten seit Mitternacht; ohne Angabe jetzt.
async function stempelnZu(aktion, minuten) {
  const d = heute();
  const bloecke = await alle('bloecke');
  const jetzt = jetztMinuten();
  const zeit = minuten ?? jetzt;
  if (zeit > jetzt) throw new Error('Diese Uhrzeit liegt in der Zukunft.');
  const heuteBloecke = bloeckeAm(bloecke, d);
  const offen = heuteBloecke.find(b => b.ende === null);
  const letzter = heuteBloecke[heuteBloecke.length - 1];

  if (aktion === 'kommen') {
    if (offen) return null; // schon eingestempelt
    if (letzter && zeit < letzter.ende) throw new Error('Um diese Zeit warst du schon eingestempelt.');
    // Endete der letzte Block in dieser Minute, wird er wieder geöffnet statt ein neuer angelegt.
    if (letzter && letzter.ende === zeit) return speichern('bloecke', { ...letzter, ende: null, gehen: false });
    return speichern('bloecke', { datum: d, beginn: zeit, ende: null, gehen: false, notiz: '' });
  }
  if (aktion === 'pause') {
    if (!offen) return null; // nichts läuft
    if (zeit < offen.beginn) throw new Error('Das liegt vor dem Beginn um ' + uhrzeit(offen.beginn) + '.');
    // Länge 0: der Block wird verworfen (Grabstein)
    if (offen.beginn === zeit) return loeschen('bloecke', offen.id);
    return speichern('bloecke', { ...offen, ende: zeit });
  }
  if (aktion === 'gehen') {
    if (offen && zeit < offen.beginn) throw new Error('Das liegt vor dem Beginn um ' + uhrzeit(offen.beginn) + '.');
    if (offen && offen.beginn !== zeit) return speichern('bloecke', { ...offen, ende: zeit, gehen: true });
    if (offen) {
      // Länge 0: der Block wird verworfen, der vorige Block des Tages wird Feierabend
      await loeschen('bloecke', offen.id);
      const vorige = heuteBloecke.filter(b => b.id !== offen.id);
      const v = vorige[vorige.length - 1];
      if (!v) return null;
      return speichern('bloecke', { ...v, gehen: true });
    }
    // Nichts läuft: den letzten Block des Tages als Feierabend markieren
    if (!letzter) return null;
    return speichern('bloecke', { ...letzter, gehen: true });
  }
  throw new Error('Unbekannte Aktion: ' + aktion);
}

// Aktion ausführen: 'kommen', 'pause' oder 'gehen'. `minuten` ist optional (Minuten seit Mitternacht, Vorgabe jetzt).
export async function stempeln(aktion, minuten) {
  return nacheinander(() => stempelnZu(aktion, minuten));
}

// Ein Block, der über Mitternacht läuft, endet gestern um 24:00.
// Heute beginnt dann ein neuer offener Block um 0:00, falls noch keiner läuft.
export async function mitternachtPruefen() {
  return nacheinander(async () => {
    const d = heute();
    const bloecke = await alle('bloecke');
    const alteOffen = bloecke.filter(b => !b.geloescht && b.ende === null && b.datum < d);
    if (alteOffen.length === 0) return false;
    for (const b of alteOffen) {
      await speichern('bloecke', { ...b, ende: 1440 });
    }
    const heuteOffen = bloecke.some(b => !b.geloescht && b.ende === null && b.datum === d);
    if (!heuteOffen) {
      await speichern('bloecke', { datum: d, beginn: 0, ende: null, gehen: false, notiz: '' });
    }
    return true;
  });
}
