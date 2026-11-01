// Dati del Portale Service: i JSON dello specchio (GET /api/service/dati/<chiave>) letti una volta per sessione di pagina e condivisi
// tra le pagine; utilità per file, link stabili, copia negli appunti in doppio formato e invio per e-mail come sul sito di origine.
import { useEffect, useState } from 'react';
import { api } from '../../api.js';

const cache = new Map();
export const svuotaDati = () => cache.clear();
export function caricaDati(chiave) {
  if (!cache.has(chiave)) cache.set(chiave, api.get(`/service/dati/${chiave}`, { silent: true }).catch((e) => { cache.delete(chiave); throw e; }));
  return cache.get(chiave);
}
/** Più JSON insieme: { data: { chiave: json }, error, loading } */
export function useDati(...chiavi) {
  const [st, setSt] = useState({ data: null, error: null, loading: true });
  const k = chiavi.join(',');
  useEffect(() => {
    let vivo = true;
    Promise.all(chiavi.map(caricaDati)).then((v) => vivo && setSt({ data: Object.fromEntries(chiavi.map((c, i) => [c, v[i]])), error: null, loading: false }))
      .catch((e) => vivo && setSt({ data: null, error: e, loading: false }));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return st;
}

export const base = '/service';
/** URL di un file dello specchio servito dalla Suite (ogni segmento codificato: i nomi hanno spazi, #, virgole). */
export const fileUrl = (p, dl) => `/api/service/file/${String(p).split('/').map(encodeURIComponent).join('/')}${dl ? '?dl=1' : ''}`;
export const docUrl = (d) => (d?.pdf ? fileUrl(`docs/${d.pdf}`) : null);
export const stampabileUrl = (d) => (d?.stampabile ? fileUrl(`stampabili/${d.stampabile}`) : null);
export const codiceBase = (code) => String(code || '').split('_')[0];
/** Link stabile dentro la Suite (consegna il PDF senza redirect): /service/p/<shortcut>, /service/m/<codice>, /service/doc/<codice> */
export const linkSuite = (tipo, codice) => `${base}/${tipo}/${encodeURIComponent(codice)}`;
/** Link stabile del sito pubblico (da mandare a clienti e pazienti, che non hanno un account della Suite) */
export const linkPubblico = (origine, tipo, codice) => `${String(origine || '').replace(/\/+$/, '')}/${tipo}/${encodeURIComponent(codice)}`;

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const slug = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const senzaNumero = (area) => String(area || '').replace(/^\d+\.\s*/, '');
export const gruppo = (r) => ((r.extra || {}).Gruppo || '').replace(/^\s*-\s*/, '').trim();

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Copia in doppio formato: testo semplice (l'URL) e HTML (collegamento cliccabile), come il pulsante catena del sito. */
export async function copiaLink(url, testo) {
  const html = `<a href="${esc(url)}">${esc(testo || url)}</a>`;
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) await navigator.clipboard.write([new window.ClipboardItem({ 'text/plain': new Blob([url], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
    else await navigator.clipboard.writeText(url);
    return true;
  } catch { try { await navigator.clipboard.writeText(url); return true; } catch { window.prompt('Copia il link', url); return false; } }
}
async function copiaHtml(html, plain) {
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) await navigator.clipboard.write([new window.ClipboardItem({ 'text/plain': new Blob([plain], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
    else await navigator.clipboard.writeText(plain);
  } catch { /* appunti non disponibili: resta l'e-mail */ }
}
/* E-mail con i link stabili del documento (il PDF non si allega da una pagina web): stesso testo del sito di origine */
function linkDoc(d, origine) {
  const b = codiceBase(d.code);
  const l = [{ label: 'Apri il PDF', url: linkPubblico(origine, 'doc', b) }];
  if (d.stampabile) l.push({ label: 'Versione stampabile (senza frontespizio)', url: linkPubblico(origine, 'm', b) });
  return l;
}
export function mailtoDoc(d, origine) {
  const righe = ['Buongiorno,', '', 'di seguito il riferimento al documento del Sistema di Gestione Integrato di Toscana Diagnostica (Portale Service di Laboratorio):', '',
    `${d.code} - ${d.title} (rev. ${d.rev} del ${d.data})`, `Area: ${d.area}`, ''];
  linkDoc(d, origine).forEach((l) => righe.push(`${l.label}:`, `<${l.url}>`, ''));
  righe.push('Il link apre sempre la revisione in vigore.', '', 'Cordiali saluti', 'Laboratorio di Analisi - Toscana Diagnostica', 'laboratorio@toscanadiagnostica.it · 055 7765102');
  return `mailto:?subject=${encodeURIComponent(`[Toscana Diagnostica Service] ${d.code} - ${d.title}`)}&body=${encodeURIComponent(righe.join('\n'))}`;
}
export function copiaLinkDoc(d, origine) {
  const ls = linkDoc(d, origine);
  const html = `<p><b>${esc(`${d.code} - ${d.title}`)}</b> (rev. ${esc(d.rev)} del ${esc(d.data)})</p>${ls.map((l) => `<p>${esc(l.label)}: <a href="${esc(l.url)}">${esc(l.url)}</a></p>`).join('')}`;
  return copiaHtml(html, `${d.code} - ${d.title}\n${ls.map((l) => `${l.label}: ${l.url}`).join('\n')}`);
}

// Stato dello specchio (build, REG006, origine pubblica): una lettura condivisa, rinnovata da Impostazioni
let statoP = null;
export const svuotaStato = () => { statoP = null; };
export function useStato() {
  const [s, setS] = useState(null);
  useEffect(() => {
    let vivo = true;
    if (!statoP) statoP = api.get('/service/state', { silent: true }).catch((e) => { statoP = null; throw e; });
    statoP.then((x) => vivo && setS(x)).catch(() => {});
    return () => { vivo = false; };
  }, []);
  return s;
}
