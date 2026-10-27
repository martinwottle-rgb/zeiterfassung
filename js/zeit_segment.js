// Segment „Woche | Monat | Abwesenheiten“ über den Zeit-Ansichten. aktiv ist 'woche', 'monat' oder 'abwesenheiten'.
const TEILE = [
  ['woche', 'Woche'],
  ['monat', 'Monat'],
  ['abwesenheiten', 'Abwesenheiten'],
];

export function zeitSegment(aktiv) {
  const nav = document.createElement('nav');
  nav.className = 'segment zeit-segment';
  nav.setAttribute('aria-label', 'Zeitansicht');
  for (const [ziel, text] of TEILE) {
    const link = document.createElement('a');
    link.className = 'segment-teil';
    link.href = `#${ziel}`;
    const schrift = document.createElement('span');
    schrift.textContent = text;
    link.append(schrift);
    if (ziel === aktiv) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return nav;
}
