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
// Origine dell'elaborazione e stato dell'invio al mittente (casella template@, 31/10/2026)
export const ORIGINE = { UPLOAD: { label: 'Caricato', tone: 'grey', icon: 'upload' }, CASELLA: { label: 'Casella', tone: 'teal', icon: 'mail' } };
export const STATO_INVIO = { INVIATO: { label: 'Inviato', tone: 'green' }, REGISTRATO: { label: 'Registrato (posta in modalità registro)', breve: 'Registrato', tone: 'blue' }, FALLITO: { label: 'Invio non riuscito', breve: 'Non riuscito', tone: 'red' } };
// Motore del 03/11/2026: come è stata letta la scheda e origine delle versioni dei dati ("Chiedi una correzione")
export const LETTURA = {
  CLAUDE: { label: 'Letta con Claude', tone: 'teal', correzione: 'Claude rilegge il PDF di partenza e la scheda.' },
  MOCK: { label: 'Lettura simulata', tone: 'blue', correzione: 'Lettura simulata (REFERTI_AI_MOCK): la correzione è simulata, solo per il collaudo.' },
  RISERVA: { label: 'Parser di riserva', tone: 'amber', correzione: 'Senza chiave Anthropic la correzione con Claude non è disponibile: correggi i campi qui sotto.' },
};
export const ORIGINE_VERSIONE = { LETTURA: { label: 'Lettura', tone: 'teal' }, CORREZIONE: { label: 'Correzione', tone: 'mauve' }, MANUALE: { label: 'Modifica manuale', tone: 'grey' } };
