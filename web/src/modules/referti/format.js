// Etichette e formati del modulo Referti esterni
export const SORGENTE = {
  BIANALISI: { label: 'Bianalisi Firenze', breve: 'Bianalisi', tone: 'blue' },
  CERBA_RDI: { label: 'Cerba RDI Limena', breve: 'Cerba RDI', tone: 'teal' },
  CERBA_NUOVA_IGEA: { label: 'Cerba Nuova Igea', breve: 'Nuova Igea', tone: 'mauve' },
  ALTRO: { label: 'Sorgente non riconosciuta', breve: 'Altro', tone: 'amber' },
};
export const STATO_SCHEDA = { BOZZA: { label: 'Da confermare', tone: 'amber' }, CONFERMATA: { label: 'Confermata', tone: 'green' }, SCARTATA: { label: 'Scartata', tone: 'grey' } };
export const STATO_ELAB = { CARICATO: { label: 'In elaborazione', tone: 'blue' }, ELABORATO: { label: 'Elaborato', tone: 'green' }, SCARTATO: { label: 'Scartato', tone: 'red' } };
export const itDate = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '');
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
export const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
export const pagineLabel = (p) => (Array.isArray(p) && p.length ? (p.length === 1 ? `pag. ${p[0]}` : `pagg. ${p[0]}-${p[p.length - 1]}`) : '');
export const b64ToUrl = (b64, mime) => { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return URL.createObjectURL(new Blob([arr], { type: mime })); };
