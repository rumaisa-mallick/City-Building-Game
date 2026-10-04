/**
 * Inline SVG icon set — the chrome half of the UI.
 *
 * Why not emoji: they are rendered by whatever font the OS happens to supply,
 * so their weight, optical size and colour are all outside our control and they
 * fall back to empty boxes on machines without an emoji font (headless Chrome,
 * some Linux setups). A stroke-based SVG set gives every control the same line
 * weight, the same optical size and a colour that follows `currentColor`, which
 * is what makes a toolbar read as designed rather than assembled.
 *
 * Design rules for anything added here:
 *  - 24×24 box, ~1.9 stroke, round caps and joins — matches `.ic` in style.css
 *  - no fills; legibility comes from silhouette, not from colour
 *  - keep to 3 path elements or fewer so it still reads at 14px
 *
 * Content emoji (inside prose: "🍔 Burger Barn", toast copy) stay as emoji —
 * they are illustration, not chrome, and mixing the two is deliberate.
 */

export const ICONS: Record<string, string> = {
  // ---- build rail -------------------------------------------------------
  building: `<path d="M3 21h18M7 21V4h7v17M14 21V11h4v10M9.5 8h2M9.5 12h2M9.5 16h2M16 14.5h.01M16 17.5h.01"/>`,
  tree: `<path d="M12 21v-5M12 16c-3.1 0-5.6-2.4-5.6-5.4S8.9 5.2 12 5.2s5.6 2.4 5.6 5.4S15.1 16 12 16Z"/>`,
  bush: `<path d="M3 20h18M6 20a2.6 2.6 0 0 1 .4-5.2 3.6 3.6 0 0 1 6.9-1.4A3.2 3.2 0 1 1 17.5 20Z"/>`,
  grass: `<path d="M3 20h18M8 20c0-4.2-1.2-6.4-3.4-7.4C4.4 15.8 5.5 18 8 20ZM12 20c0-5 1.6-7.4 4.4-8.5-.4 4.4-1.6 6.7-4.4 8.5Z"/>`,
  flower: `<circle cx="12" cy="7.5" r="1.9"/><path d="M12 3.2v2.4M12 9.4v1.6M7.7 7.5h2.4M13.9 7.5h2.4M9 4.5l1.7 1.7M13.3 8.8l1.7 1.7M15 4.5l-1.7 1.7M10.7 8.8 9 10.5M12 12.6V21"/>`,
  person: `<circle cx="12" cy="4.8" r="2.3"/><path d="M12 7.1v6.6M12 13.7 8.7 21M12 13.7 15.3 21M7.6 10.2 12 8.6l4.4 1.6"/>`,
  car: `<path d="M4 19v-4.6L6 8.6h12l2 5.8V19M4 14.4h16"/><circle cx="8" cy="19" r="1.7"/><circle cx="16" cy="19" r="1.7"/>`,
  lamp: `<path d="M12 21V9M7 21h10M8.5 3.5h7L15 9H9Z"/><path d="M12 3.5V1.8"/>`,
  bulldoze: `<path d="M3 18h6M3 18v-3.2h5.6L11 9h4l1.4 5.8H21"/><circle cx="6" cy="19.4" r="2"/><circle cx="14" cy="19.4" r="2"/><path d="M11 9V6h4v3"/>`,
  select: `<path d="M8 3.5 18 12l-4.4.7 2.5 5.2-2.6 1.3-2.5-5.2L8 17.5Z"/>`,
  zone: `<path d="M4 6.5 12 3l8 3.5v11L12 21l-8-3.5Z"/><path d="M4 6.5 12 10l8-3.5M12 10v11"/>`,
  bench: `<path d="M3 11h18M3 14.5h18M5 11v7M19 11v7M5 8.5h14v2.5H5Z"/>`,
  fountain: `<path d="M4 20h16M6 20v-3.5a6 6 0 0 1 12 0V20M12 10.5V6M12 6c-1.6-1.4-3.2-1.4-4.8 0M12 6c1.6-1.4 3.2-1.4 4.8 0"/>`,
  hospital: `<path d="M4 21V8.5L12 4l8 4.5V21M3 21h18M10 21v-5h4v5"/><path d="M12 7.5v4M10 9.5h4"/>`,
  grocery: `<path d="M4 6h2.2l2.3 9.5h8.8L19.5 9H7"/><circle cx="9.5" cy="19.5" r="1.6"/><circle cx="16.5" cy="19.5" r="1.6"/>`,
  playground: `<path d="M4 20h16M6 20V9M18 20V9M6 9h12M6 13.5c4 2.5 8 2.5 12 0"/><circle cx="12" cy="6" r="2"/>`,
  firestation: `<path d="M3 21h18M5 21V9l7-4 7 4v12M9 21v-5h6v5"/><path d="M12 12.5c-1.4-1.6-1-3.4.4-4.4.3 1.4 1.6 1.9 1.6 3.3 0 1-.8 1.8-2 1.8s-2-.8-2-1.8"/>`,
  police: `<path d="M4 19v-4.4L6 9h12l2 5.6V19M4 14.6h16"/><circle cx="8" cy="19" r="1.7"/><circle cx="16" cy="19" r="1.7"/><path d="m12 3.5 2.4 1.6-.9 2.8h-3l-.9-2.8Z"/>`,
  busStop: `<path d="M5 21V4h10v6M15 4h4v17M3 21h18M8 8h4M8 12h4"/><path d="M17.5 16.5h.01"/>`,
  train: `<path d="M7 3h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Z"/><path d="M5 9.5h14M9 13h.01M15 13h.01M8 17l-2.5 4M16 17l2.5 4"/>`,
  dog: `<path d="M4 8.5 6.5 5l2 2.5h5L17 6l3 2.5V15a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/><path d="M9.5 13h.01M14.5 13h.01M12 16.5c-.8 0-1.4-.5-1.4-1.1"/>`,
  cat: `<path d="M5 10 4 4l4.5 3h7L20 4l-1 6v4a7 7 0 0 1-14 0Z"/><path d="M9.5 13h.01M14.5 13h.01M12 15.5l-1 .8M12 15.5l1 .8M9 16.5H5.5M15 16.5h3.5"/>`,
  duck: `<path d="M6 13a4 4 0 0 1 4-4h3l3-3 2 1-1 3a4.5 4.5 0 0 1-1 6H8"/><path d="M6 13c0 3.3 2.7 6 6 6h5"/><path d="M16.5 8.5h.01"/>`,
  cow: `<path d="M4 9.5c0-2 1.6-3.5 3.6-3.5h8.8c2 0 3.6 1.5 3.6 3.5V15a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/><path d="M4 9.5 2.5 7M20 9.5 21.5 7M9 13h.01M15 13h.01M10.5 17h3"/>`,
  snowman: `<circle cx="12" cy="17" r="4"/><circle cx="12" cy="9.5" r="3"/><path d="M12 6.5V4M5 11l3 1.5M19 11l-3 1.5M10.8 9h.01M13.2 9h.01"/>`,
  pick: `<path d="M3 21 14 10M10 5c3-2 7-1.5 9 1.5-3 .5-5.5 2-7 4-2.5-2-5.5-3-9-1.5C5 6 7.5 5 10 5Z"/>`,

  // ---- top bar ----------------------------------------------------------
  sound: `<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.3 6.6a8 8 0 0 1 0 10.8"/>`,
  soundOff: `<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="m16 10 4 4M20 10l-4 4"/>`,
  spring: `<path d="M12 21v-8"/><path d="M12 13c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6ZM12 13c0-3.3-2.7-6-6-6 0 3.3 2.7 6 6 6Z"/>`,
  summer: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>`,
  autumn: `<path d="M12 21c0-6 3-10.5 8-12 .8 5.7-2.4 11-8 12Z"/><path d="M12 21c0-5-2.5-8.8-7-10-.7 4.8 2 9.2 7 10ZM12 21v-6"/>`,
  winter: `<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>`,
  timelapse: `<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 2.5h5M18.5 6l1.5-1.5"/>`,
  stop: `<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>`,
  pace: `<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l3 1.5M9.5 2.5h5"/>`,
  weather: `<path d="M7.5 18.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.4 11a3.8 3.8 0 0 1-.4 7.5Z"/><path d="M9 21.5 8 23M13 21.5 12 23M17 21.5 16 23"/>`,
  cloud: `<path d="M7.5 19a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.4 11.5a3.8 3.8 0 0 1-.4 7.5Z"/>`,
  storm: `<path d="M7.5 16.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.4 9a3.8 3.8 0 0 1-.4 7.5Z"/><path d="m12.5 15-3 4.5h3l-1.5 4"/>`,
  budget: `<path d="M3 8.5h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 8.5 5.5 4h13L21 8.5M12 12v5M14 13.3h-2.6a1.4 1.4 0 0 0 0 2.8h1.2a1.4 1.4 0 0 1 0 2.8H10"/>`,
  goals: `<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/>`,
  news: `<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H18v14H5.5A2.5 2.5 0 0 0 3 20.5Z"/><path d="M21 8.5v9a2.5 2.5 0 0 1-2.5 2.5H18"/><path d="M6.5 8h7M6.5 11.5h7M6.5 15h4"/>`,
  map: `<path d="M9 4 3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5Z"/><path d="M9 4v14M15 6.5v14"/>`,
  pause: `<path d="M9 5.5v13M15 5.5v13"/>`,
  save: `<path d="M5 4h11l3 3v13H5Z"/><path d="M8.5 4v5h7V4M8 20v-6h8v6"/>`,
  load: `<path d="M3 7.5h6l2 2.5h10v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19Z"/><path d="M12 17v-5M9.5 14.5 12 12l2.5 2.5"/>`,
  newCity: `<path d="M3 20h18M6 20V9l5-3.5V20M11 20V12h7v8M13.5 15h2M13.5 17.5h2"/><path d="M4.5 6.5 6 5M19.5 6.5 18 5"/>`,
  brand: `<path d="M3 21h18M6 21V7l6-4v18M12 21V11l6 3v7M8.5 9.5h1M8.5 13h1M8.5 16.5h1M14.5 16h1M14.5 18.5h1"/>`,

  // ---- scene switcher ---------------------------------------------------
  morning: `<path d="M3 19h18M7.5 19a4.5 4.5 0 0 1 9 0"/><path d="M12 6.5V4M5.6 9.1 4.3 7.8M18.4 9.1l1.3-1.3M3 14H1.5M22.5 14H21M7 13.5 6 14.5M17 13.5l1 1"/>`,
  day: `<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M18.6 5.4l-1.7 1.7M7.1 16.9l-1.7 1.7"/>`,
  sunset: `<path d="M3 19.5h18M7.5 19.5a4.5 4.5 0 0 1 9 0"/><path d="M12 8V5M5.6 10.6 4.3 9.3M18.4 10.6l1.3-1.3M3 14.5H1.5M22.5 14.5H21"/><path d="M8 6.5 9.5 8M16 6.5 14.5 8"/>`,
  night: `<path d="M20 14.4A8.5 8.5 0 0 1 9.6 4 8.5 8.5 0 1 0 20 14.4Z"/><path d="M17.5 4.5v2M16.5 5.5h2"/>`,
  rain: `<path d="M7.5 15.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.4 8a3.8 3.8 0 0 1-.4 7.5Z"/><path d="M8.5 18 7.5 21M12.5 18l-1 3M16.5 18l-1 3"/>`,
  snow: `<path d="M7.5 15a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.4 7.5a3.8 3.8 0 0 1-.4 7.5Z"/><path d="M9 19h.01M12.5 20.5h.01M16 19h.01M10.5 21.5h.01M15 21.5h.01"/>`,

  // ---- panels & affordances --------------------------------------------
  stock: `<path d="M3 20h18M4.5 16.5 9 11l3.5 3 6-7"/><path d="M14.5 7h4v4"/>`,
  shop: `<path d="M4 7h2.3l2.3 9.5h8.8L19.5 10H7"/><circle cx="9.5" cy="19.5" r="1.6"/><circle cx="16.5" cy="19.5" r="1.6"/>`,
  learn: `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5Z"/>`,
  cart: `<path d="M3 4h2.2l2.3 9.5h8.8L18.5 7H6.2"/><circle cx="9.5" cy="19" r="1.6"/><circle cx="16.5" cy="19" r="1.6"/>`,
  chart: `<path d="M4 20h16M7 20v-6M12 20V7M17 20v-9"/>`,
  book: `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5Z"/>`,
  money: `<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.3a3 3 0 0 0-4.6 1.6c0 3 4.7 1.7 4.7 4.4a3 3 0 0 1-4.7 1.5M12 6.8v1.6M12 15.6v1.6"/>`,
  wrench: `<path d="M15.5 3.8a5.5 5.5 0 0 0-6.7 7.1L3.6 16a2.1 2.1 0 0 0 3 3l5.1-5.1a5.5 5.5 0 0 0 7.1-6.7l-3.2 3.2-2.9-.6-.6-2.9Z"/>`,
  package: `<path d="M12 3 3.5 7.3v9.4L12 21l8.5-4.3V7.3Z"/><path d="M3.5 7.3 12 11.6l8.5-4.3M12 11.6V21M7.8 5.2l8.4 4.3"/>`,
  dice: `<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01"/>`,
  close: `<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>`,
  minus: `<path d="M6 12h12"/>`,
  plus: `<path d="M12 6v12M6 12h12"/>`,
  refresh: `<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5V10h-5.5"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 1.9"/>`,
  spark: `<path d="M12 3.5 13.7 9.3 19.5 11 13.7 12.7 12 18.5 10.3 12.7 4.5 11 10.3 9.3Z"/><path d="M18.5 16.6 19.2 18.7 21.3 19.4 19.2 20.1 18.5 22.2 17.8 20.1 15.7 19.4 17.8 18.7Z"/>`,
  copy: `<rect x="9" y="9" width="11.5" height="11.5" rx="2.2"/><path d="M15 6.6V5.5A2 2 0 0 0 13 3.5H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2h1.1"/>`,
  trash: `<path d="M4 6.5h16M9.5 6.5V4.4h5v2.1M6.6 6.5 7.6 20.2h8.8L17.4 6.5M10 10.2v6.4M14 10.2v6.4"/>`,
  play: `<path d="M8.5 5.3 18 12l-9.5 6.7Z"/>`,
  info: `<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8h.01"/>`,
};

/**
 * Inline an icon. Returns an empty string for unknown names so a typo degrades
 * to "no icon" instead of throwing inside a template literal.
 */
export function ico(name: string, cls = ''): string {
  const body = ICONS[name];
  if (!body) return '';
  const klass = cls ? ` ic ${cls}` : ' ic';
  return `<svg class="${klass}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}
