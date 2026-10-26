export const STATO = { BOZZA: { label: 'Bozza', tone: 'amber' }, PUBBLICATA: { label: 'Pubblicata', tone: 'green' }, SUPERATA: { label: 'Superata', tone: 'grey' }, ANNULLATA: { label: 'Annullata', tone: 'red' } };
export const SEGMENTO = { CLIENTI_SERVICE: 'Clienti service', PUNTI_PRELIEVO: 'Punti prelievo', MEDICINA_LAVORO: 'Medicina del lavoro', PERSONALE: 'Personale', PARTNER: 'Partner', ALTRO: 'Altro' };
export const ORIENTAMENTO = { AUTO: 'Automatico', VERTICALE: 'Verticale', ORIZZONTALE: 'Orizzontale' };
export const itDate = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '');
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
export const isoDate = (d) => (d ? String(d).slice(0, 10) : '');
export const BLOCCHI = { titolo: 'Titolo di sezione', paragrafo: 'Paragrafo', elenco: 'Elenco', tabella: 'Tabella' };
