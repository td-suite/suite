import { BASE } from './api.js';
const eurIt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const eurEn = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });
export const eur = (n, lang = 'it') => (n == null || n === '' ? '–' : (lang === 'en' ? eurEn : eurIt).format(Number(n)));
export const num = (n) => new Intl.NumberFormat('it-IT').format(Number(n || 0));
export const fdate = (iso) => { if (!iso) return ''; const s = String(iso).slice(0, 10); const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
export const fdt = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
export const currentMonth = () => today().slice(0, 7);
export const monthLabel = (m, lang = 'it') => { const [y, mm] = m.split('-'); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', { month: 'long', year: 'numeric' }); };
export const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);
export const STATUS_TONE = { NEW: 'grey', ASSIGNED: 'blue', SHIPPED: 'mauve', DELIVERED: 'teal', SAMPLE_RECEIVED: 'green', SHIPPED_TO_LAB: 'mauve', CLOSED: 'grey', CANCELLED: 'red' };
export const KIT_TONE = { IN_STOCK: 'green', ASSIGNED: 'blue', SHIPPED: 'mauve', DELIVERED: 'teal', SAMPLE_RECEIVED: 'green', SHIPPED_TO_LAB: 'mauve', CLOSED: 'grey', DISCARDED: 'red' };
export const TRACK_TONE = { PENDING: 'grey', IN_TRANSIT: 'blue', OUT_FOR_DELIVERY: 'mauve', DELIVERED: 'green', EXCEPTION: 'red', UNKNOWN: 'grey' };
export const LAB_TONE = { PREPARING: 'blue', SHIPPED: 'mauve', DELIVERED: 'green' };
export const BILL_TONE = { OPEN: 'grey', CLOSED: 'blue', INVOICED: 'green' };
export const modeName = (o, lang) => (o?.project === 'LIFESTYLE' || !o?.mode_code ? null : lang === 'en' ? o.mode_en : o.mode_it);
export const patientName = (o) => [o.patient_title, o.patient_first_name, o.patient_last_name].filter(Boolean).join(' ');
// Richiedente: la Legal entity (con il referente) oppure la persona destinataria stessa
export const requesterName = (o) => (o?.requester_kind === 'LEGAL_ENTITY' ? (o.requester_org_name || o.requester_name || '') : patientName(o || {}));
// Percorso del progetto dentro la Suite: le pagine compongono `/${projectPath(project)}/richieste/...` → /shipments/endeavor/richieste/...
export const projectPath = (p) => `${BASE.slice(1)}/${p === 'LIFESTYLE' ? 'lifestyle' : 'endeavor'}`;
export const projectOf = (slug) => (slug === 'lifestyle' ? 'LIFESTYLE' : 'ENDEAVOR');
