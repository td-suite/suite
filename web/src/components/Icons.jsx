import React from 'react';

/* Icone dei moduli (viewBox 48, tratto 2.2, linee arrotondate, due toni: tratto currentColor e un'area piena al 18%).
   `f` = aree piene (opacità .18), `s` = tratti. Il colore arriva da `color` (CSS currentColor). */
// Ingranaggio a otto denti (centro 18,19; raggio esterno 11, interno 8.5), generato per avere denti regolari
const GEAR = (() => {
  const cx = 18, cy = 19, ro = 11, ri = 8.5, n = 8, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, w = Math.PI / n;
    const seq = [[a - w * 0.5, ri], [a - w * 0.3, ro], [a + w * 0.3, ro], [a + w * 0.5, ri]];
    for (const [ang, r] of seq) pts.push(`${(cx + Math.cos(ang) * r).toFixed(1)} ${(cy + Math.sin(ang) * r).toFixed(1)}`);
  }
  return `M${pts.join('L')}z`;
})();

const MODULES = {
  'contracts-b2b': {
    f: 'M11 6h17l8 8v28H11z',
    s: 'M11 6h17l8 8v28H11zM28 6v8h8M17 20h12M17 26h8M39 33a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0zM31 37.5 29 44M36 37.5 38 44M24 40h-6',
  },
  'finance-sign': {
    f: 'M5 14h32v20H5zM43 6l-11 11-4 1 1-4L40 3z',
    s: 'M5 14h32v20H5zM10 20h10M10 29c2-4 4-4 6 0s4 4 6 0M24 29c2-3 4-3 6 0s3 2 5 0M43 6l-11 11-4 1 1-4L40 3zM31 9l4 4M5 40h38',
  },
  'integration-plan': {
    f: 'M7 7h12v5a3 3 0 0 0 0 6v5H7zM23 7h12v16H23zM7 32h16v5H7zM17 40h20v5H17z',
    s: 'M7 7h12v5a3 3 0 0 0 0 6v5H7zM23 7h12v16H23zM19 12a3 3 0 0 1 0 6M23 10h-4M23 20h-4M7 32h16v5H7zM17 40h20v5H17z',
  },
  cockpit: {
    f: 'M24 36 7 36a17 17 0 0 1 8.5-14.7z',
    s: 'M7 36a17 17 0 1 1 34 0M24 36 33 23M12 24l2 1.2M18 18l1.2 2.2M30 18l-1.2 2.2M36 24l-2 1.2M5 36h38M24 36h.01',
  },
  cash: {
    f: 'M4 24h26v14H4zM28 8l9-5 9 5z',
    s: 'M4 24h26v14H4zM17 35a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 28h.01M26 34h.01M28 8l9-5 9 5zM30 10v8M44 10v8M37 10v8M28 20h18M40 44a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM34 41a4 4 0 0 1 1.5-7M14 20c2-5 5-8 10-8h3M24 8l3 4-3 4',
  },
  orders: {
    f: 'M6 15l10-5 10 5-10 5z',
    s: 'M6 15l10-5 10 5v14l-10 5-10-5zM6 15l10 5 10-5M16 20v14M32 8h10M32 14h10M32 20h6M30 27h3l2 9h8l2-7H36M36 42a1.5 1.5 0 1 0 0-.1M43 42a1.5 1.5 0 1 0 0-.1',
  },
  shipments: {
    f: 'M5 9h20v14H5zM40 44c-3.5-4-6-6.8-6-10a6 6 0 0 1 12 0c0 3.2-2.5 6-6 10z',
    s: 'M5 9h20v14H5zM15 12v8M11 16h8M5 27v10h12M27 16c7 0 7 12 13 12M40 44c-3.5-4-6-6.8-6-10a6 6 0 0 1 12 0c0 3.2-2.5 6-6 10zM40 34h.01',
    dash: 'M27 16c7 0 7 12 13 12',
  },
  room: {
    f: 'M5 7h17v15H5zM45 14a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
    s: 'M5 7h25v33H5zM5 22h17M22 7v33M22 30h8M12 22v5M22 14h4M45 14a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM38 10v4l2.5 2M41 44H30',
  },
  nc: {
    f: 'M15 18v9a4.5 4.5 0 0 0 9 0v-9zM35 22l9 17H26z',
    s: 'M13 5h13M15 5v22a4.5 4.5 0 0 0 9 0V5M15 15h9M35 22l9 17H26zM35 28.5v5M35 36.5v.3M7 44h30',
  },
  sgi: {
    f: 'M5 11h12l4 4h22v24H5z',
    s: 'M5 11h12l4 4h22v24H5zM5 19h38M12 27h8M39 30a5 5 0 1 1-10 0 5 5 0 0 1 10 0zM31.5 34 30 41M36.5 34 38 41M34 28.5l.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z',
  },
  service: {
    f: 'M9 28h18v4H9zM12 40h30v3H12z',
    s: 'M22 5l-5 5M19 6l6 6-9 9-6-6zM25 12l9 9c5 5 4 13-2 18M14 15l5 5M9 28h18v4H9zM18 32v8M12 40h30v3H12zM33 25l2 2M40 32c-2 1-5 1-7-1',
  },
  'contracts-hr': {
    f: 'M27 7h10l5 5v15H27zM29 32h14v10H29z',
    s: 'M21 13a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM4 36c0-7 5-12 11-12s11 5 11 12v2H4zM27 7h10l5 5v15H27zM37 7v5h5M31 17h6M31 21h4M29 32h14v10H29zM32 32v-3a4 4 0 0 1 8 0v3M36 36.5v2',
  },
  rubrica: {
    f: 'M17 5h14v10H17zM4 31h14v10H4zM30 31h14v10H30z',
    s: 'M17 5h14v10H17zM4 31h14v10H4zM30 31h14v10H30zM24 15v8M11 23h26M11 23v8M37 23v8M24 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 38a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM37 38a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  },
  retail: {
    f: 'M4 17l4-9h32l4 9c-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0z',
    s: 'M4 17l4-9h32l4 9c-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0-1.5 3-4 3-5.5 0zM7 20v22h34V20M20 42V30h8v12M12 30h4M32 25l1.5 3 3.3.4-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.4z',
  },
  comunicazione: {
    f: 'M6 20v8h7l15 9V11L13 20z',
    s: 'M6 20v8h7l15 9V11L13 20zM11 28v9h7M33 19c2 2 2 8 0 10M38 14c5 4 5 16 0 20M43 9c8 7 8 23 0 30',
  },
  admin: {
    f: 'M34 20l9 3.5V31c0 5.5-3.5 9.5-9 12-5.5-2.5-9-6.5-9-12v-7.5z' + GEAR,
    s: GEAR + 'M22 19a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM34 20l9 3.5V31c0 5.5-3.5 9.5-9 12-5.5-2.5-9-6.5-9-12v-7.5zM29.5 32l3 3 5.5-6',
  },
};

/* Icone di interfaccia (viewBox 24, tratto 1.9) */
const UI = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v10h4.5v-6h4v6h4.5V10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4',
  user: 'M20 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-7A4.5 4.5 0 0 0 4 19.5V21M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2',
  news: 'M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2zM17 9h3v10a2 2 0 0 1-2 2M7 9h5v4H7zM14 9h1M7 16h7',
  megaphone: 'M3 10v4h3l8 5V5L6 10zM6 14v5h3M17 9.5c1 1 1 4 0 5M20 7c2 2.5 2 7.5 0 10',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  'cloud-sun': 'M9 5a3.5 3.5 0 0 1 5.7 2.3M8 2.5V4M3.5 8H5M4.8 4.8l1 1M8 20h9a4 4 0 0 0 .5-8A6 6 0 0 0 6 13.5 3.5 3.5 0 0 0 8 20z',
  cloud: 'M7 19h10a4.5 4.5 0 0 0 .5-9A6.5 6.5 0 0 0 5 11.5 3.9 3.9 0 0 0 7 19z',
  fog: 'M6 15h12M4 19h16M7 11h9a4 4 0 0 0 .5-8A6 6 0 0 0 5 4.5 3.3 3.3 0 0 0 7 11z',
  drizzle: 'M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 7.5 3.3 3.3 0 0 0 7 14zM9 17v2M13 17v2M11 20v2',
  rain: 'M7 13h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 3.3 3.3 0 0 0 7 13zM8 16l-1 3M12 16l-1 3M16 16l-1 3M10 20l-.5 1.5M14 20l-.5 1.5',
  snow: 'M7 13h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 3.3 3.3 0 0 0 7 13zM8 17h.01M12 17h.01M16 17h.01M10 20.5h.01M14 20.5h.01',
  storm: 'M7 13h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 3.3 3.3 0 0 0 7 13zM13 13l-3 5h4l-3 5',
  folder: 'M3 6h6l2 2h10v11H3z',
  upload: 'M12 16V5M7 10l5-5 5 5M4 20h16',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  sunLight: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M4 12.5l5 5L20 6.5',
  x: 'M6 6l12 12M18 6 6 18',
  pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  pinTack: 'M9 4h6l-1 6 3 3v1H7v-1l3-3zM12 14v7',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  like: 'M7 11v9H3v-9zM7 11l4-7a2 2 0 0 1 3 2l-1 4h6a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7',
  comment: 'M4 5h16v11H9l-5 4z',
  teams: 'M3 7h11v10H3zM14 10h7v7h-7M9 15v-5M6.5 10h5M18 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  back: 'M15 6l-6 6 6 6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shield: 'M12 3 4 6v6c0 5 3.5 8.3 8 9 4.5-.7 8-4 8-9V6l-8-3z',
  building: 'M4 21V5l8-2v18M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  tree: 'M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 12h12M6 12v4M18 12v4',
  key: 'M14 10a4 4 0 1 0-3.5 3.96L12 15.5V18l2 2 2-2-1-1 1-1-1-1 1-1.5a4 4 0 0 0-2-3.5z',
  import: 'M12 3v12M8 11l4 4 4-4M4 17v3h16v-3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  edit: 'M4 20h4l11-11-4-4L4 16zM13 7l4 4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  lock: 'M6 11h12v10H6zM9 11V8a3 3 0 0 1 6 0v3M12 15v2',
  unlock: 'M6 11h12v10H6zM9 11V8a3 3 0 0 1 5.5-1.7M12 15v2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M19 14v6H4V5h6',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  pdf: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M8 17v-5h2a1.5 1.5 0 0 1 0 3H8M13 12h2v5h-2z',
  sheet: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M16 5v14',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M8 13h8M8 17h6',
  zip: 'M4 5h16v14H4zM10 5v2M12 7v2M10 9v2M12 11v2M10 13v3h2v-3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
  alert: 'M12 4 2.5 20h19L12 4zM12 10v4.5M12 17.2v.01',
  quote: 'M6 11h4v6H5v-4a7 7 0 0 1 3-6M15 11h4v6h-5v-4a7 7 0 0 1 3-6',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 3v3M20.5 4.5h-3',
  send: 'M3 11l18-8-6 18-3-7z',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M11 8v6M8 11h6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M8 11h6',
  birthday: 'M5 12h14v8H5zM5 16c2 1.5 4 1.5 6 0 2 1.5 4 1.5 6 0M12 4v4M9 12V9h6v3',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
};

export const MODULE_ICONS = Object.keys(MODULES);
export const WEATHER_ICONS = ['sun', 'cloud-sun', 'cloud', 'fog', 'drizzle', 'rain', 'snow', 'storm'];

export function Icon({ name, size, color, className = '', title, style }) {
  const m = MODULES[name];
  const sz = size ? { width: size, height: size } : undefined;
  const st = { ...(sz || {}), ...(color ? { color } : {}), ...(style || {}) };
  if (m) {
    return (
      <svg viewBox="0 0 48 48" className={`ico ico-mod ${className}`} style={st} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title}>
        <path d={m.f} fill="currentColor" fillOpacity=".18" stroke="none" />
        <path d={m.s} />
        {m.dash && <path d={m.dash} strokeDasharray="3 3.5" stroke="var(--ico-bg, #fff)" strokeWidth="2.2" opacity=".9" />}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={`ico ${className}`} style={st} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title}>
      <path d={UI[name] || UI.info} />
    </svg>
  );
}

// Mappa codici meteo (WMO, Open-Meteo) → icona
export function weatherIcon(code) {
  const c = Number(code);
  if (Number.isNaN(c)) return 'cloud';
  if (c === 0) return 'sun';
  if (c === 1 || c === 2) return 'cloud-sun';
  if (c === 3) return 'cloud';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'storm';
  return 'cloud';
}
