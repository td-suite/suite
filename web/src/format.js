// Formattazioni italiane e piccole utilità condivise
const IT = 'it-IT';

export const fmtDate = (d, opts) => (d ? new Date(d).toLocaleDateString(IT, opts || { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
export const fmtDateLong = (d) => (d ? new Date(d).toLocaleDateString(IT, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(IT, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString(IT, { hour: '2-digit', minute: '2-digit' }) : '');
export const fmtNum = (n, digits = 0) => (n == null || n === '' ? '' : Number(n).toLocaleString(IT, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
export const fmtMoney = (n) => (n == null ? '' : Number(n).toLocaleString(IT, { style: 'currency', currency: 'EUR' }));
export const fmtBytes = (b) => { if (b == null) return ''; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`; if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`; return `${(b / 1073741824).toFixed(2)} GB`; };

export function timeAgo(d) {
  if (!d) return '';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'adesso';
  if (diff < 3600) return `${Math.floor(diff / 60)} min fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h fa`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} g fa`;
  return fmtDate(d);
}

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 13) return 'Buongiorno';
  if (h < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}

export const firstName = (full) => (full || '').trim().split(/\s+/)[0] || '';

export function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Colore stabile derivato dal nome (toni compatibili con il brand)
const HUES = [196, 170, 150, 275, 30, 205, 330, 120, 250, 15];
export function nameColor(name) {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length];
  return `hsl(${hue} 38% 42%)`;
}

export const LEVEL = { OWNER: 'Titolare', ADMIN: 'Amministratore', USER: 'Utente' };
export const STATUS = { ACTIVE: 'Attivo', PENDING: 'In attesa', DISABLED: 'Disattivato' };
export const STATUS_TONE = { ACTIVE: 'green', PENDING: 'mauve', DISABLED: 'grey' };
export const PROVIDER = { LOCAL: 'Credenziali', ENTRA: 'Microsoft 365', BOTH: 'Microsoft 365 e credenziali' };
export const PERSON_KIND = { DIPENDENTE: 'Dipendente', LP: 'Libero professionista', MEDICO: 'Medico', SANITARIO: 'Sanitario', ESTERNO: 'Esterno', DIRIGENTE: 'Dirigente' };
export const SITE_KIND = { HEADQUARTER: 'Sede centrale', LABORATORIO: 'Laboratorio', CENTRO_DIAGNOSTICO: 'Centro diagnostico', POLIAMBULATORIO: 'Poliambulatorio', PUNTO_PRELIEVI: 'Punto prelievi', SERVICE: 'Service', CENTRO_MEDICO: 'Centro medico', ALTRO: 'Altro' };
export const ORG_KIND = { GRUPPO: 'Gruppo', SOCIETA: 'Società', CLIENTE: 'Cliente', PARTNER: 'Partner', FORNITORE: 'Fornitore', TARGET: 'Target M&A', ALTRO: 'Altro' };
export const NEWS_KIND = { NEWS: 'News', CIRCOLARE: 'Circolare', BLOG: 'Blog' };
export const NEWS_STATUS = { DRAFT: 'Bozza', PUBLISHED: 'Pubblicata', ARCHIVED: 'Archiviata' };
export const EVENT_KIND = { EVENTO: 'Evento', RIUNIONE: 'Riunione', FORMAZIONE: 'Formazione', SCADENZA: 'Scadenza', TURNO: 'Turno', FESTIVITA: 'Festività', ALTRO: 'Altro' };
export const SEVERITY = { INFO: 'Informazione', WARN: 'Attenzione', CRIT: 'Urgente' };

// Colori d'area come variabili CSS (si adattano al tema scuro); i valori di base coincidono con quelli del server
export const AREA_COLORS = { DIREZIONE: 'var(--area-DIREZIONE)', FINANCE: 'var(--area-FINANCE)', RETAIL_FLOW: 'var(--area-RETAIL_FLOW)', OPERATIONS: 'var(--area-OPERATIONS)', HQS: 'var(--area-HQS)', PEOPLE: 'var(--area-PEOPLE)' };
export const areaColor = (key, fallback) => AREA_COLORS[key] || fallback || 'var(--teal)';
export const AREA_NAMES = { DIREZIONE: 'Direzione', FINANCE: 'Finance', RETAIL_FLOW: 'Retail and Flow Management', OPERATIONS: 'Operations', HQS: 'HQS · Qualità, Sicurezza, SGI', PEOPLE: 'People' };

// Sanifica l'HTML degli snippet di ricerca (ts_headline): consente solo <b> e <mark>
export function sanitizeSnippet(html) {
  if (!html) return '';
  const esc = String(html).replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;').replace(/<(?!\/?(b|mark)>)/gi, '&lt;');
  return esc;
}

export const fileIcon = (mime = '', name = '') => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/sheet|excel|csv/.test(mime) || ['xls', 'xlsx', 'csv'].includes(ext)) return 'sheet';
  if (/word|document/.test(mime) || ['doc', 'docx', 'odt'].includes(ext)) return 'doc';
  if (/zip|compressed/.test(mime) || ['zip', 'rar', '7z'].includes(ext)) return 'zip';
  return 'file';
};
