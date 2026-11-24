// Formati e etichette del Recupero Crediti
export const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(n || 0));
export const itData = (d) => { const s = String(d || '').slice(0, 10); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
export const itDataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const oggiIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
export const STATO_CLIENTE = {
  REGOLARE: { label: 'Regolare', tone: 'green' }, SCADUTO: { label: 'Scaduto', tone: 'amber' }, IN_SOLLECITO: { label: 'In sollecito', tone: 'amber' }, PROMESSA: { label: 'Promessa o piano', tone: 'blue' },
  SOSPESO: { label: 'Sospeso', tone: 'blue' }, CONTESTAZIONE: { label: 'Contestazione', tone: 'mauve' }, LEGALE: { label: 'Area legale', tone: 'red' }, ESCLUSO: { label: 'Escluso dai solleciti', tone: 'grey' },
};
export const FASE = { 0: 'Nessuna', 1: 'Avviso di scadenza', 2: '1° sollecito', 3: '2° sollecito', 4: 'Chiamata', 5: 'Area legale' };
export const STATO_COM = { DA_APPROVARE: { label: 'In attesa', tone: 'amber' }, IN_CODA: { label: 'In invio', tone: 'blue' }, INVIATA: { label: 'Inviata', tone: 'green' }, REGISTRATA: { label: 'Solo registrata (posta non attiva)', tone: 'mauve' },
  SIMULATA: { label: 'Prova: non inviata', tone: 'grey' }, FALLITA: { label: 'Invio non riuscito', tone: 'red' }, ANNULLATA: { label: 'Annullata', tone: 'grey' } };
export const CLASSE = { PAGATO: { label: 'Dice di avere pagato', tone: 'green' }, PROMESSA: { label: 'Promessa di pagamento', tone: 'blue' }, CONTESTAZIONE: { label: 'Contestazione', tone: 'red' }, RICHIESTA: { label: 'Richiesta', tone: 'amber' },
  FUORI_UFFICIO: { label: 'Assenza automatica', tone: 'grey' }, ALTRO: { label: 'Da leggere', tone: 'amber' } };
export const ESITO = { PAGAMENTO_PROMESSO: 'Pagamento promesso', PIANO_RIENTRO: 'Piano di rientro', CONTESTAZIONE: 'Contestazione', NESSUN_RISCONTRO: 'Nessun riscontro' };
export const STATO_FATTURA = { APERTA: { label: 'Aperta', tone: 'amber' }, PARZIALE: { label: 'Incassata in parte', tone: 'blue' }, PAGATA: { label: 'Incassata', tone: 'green' }, NOTA_CREDITO: { label: 'Nota di credito', tone: 'mauve' }, ANNULLATA: { label: 'Annullata', tone: 'grey' } };
export const STATO_PRATICA = { PROPOSTA: { label: 'Da autorizzare', tone: 'amber' }, AUTORIZZATA: { label: 'Autorizzata, da trasmettere', tone: 'blue' }, TRASMESSA: { label: 'Trasmessa', tone: 'red' }, CHIUSA: { label: 'Chiusa', tone: 'green' }, RESPINTA: { label: 'Non autorizzata', tone: 'grey' } };
export const ORIGINE_SCADENZA = { FILE: 'dal partitario', TERMINI: 'dai termini di pagamento', PREDEFINITA: 'termini predefiniti: da verificare', MANUALE: 'indicata a mano' };
export const GIORNI = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
