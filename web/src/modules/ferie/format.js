// Formati del Piano Ferie: stati del piano e dei periodi, date italiane, quantità, eventi della cronologia
export const STATO = {
  PIANIFICATA: { label: 'Nel piano', tone: 'blue' }, RICHIESTA: { label: 'Variazione in attesa', tone: 'amber' }, APPROVATA: { label: 'Approvato', tone: 'green' },
  RIFIUTATA: { label: 'Non accolta', tone: 'red' }, GODUTA: { label: 'Goduto', tone: 'teal' }, ANNULLATA: { label: 'Tolto', tone: 'grey' },
};
// Stati del piano annuale (BOZZA → PROPOSTO → IN_REVISIONE → APPROVATO → DEFINITIVO)
export const STATO_PIANO = {
  BOZZA: { label: 'Bozza', tone: 'grey', breve: 'Bozza' }, PROPOSTO: { label: 'Inviato al responsabile', tone: 'amber', breve: 'Inviato' },
  IN_REVISIONE: { label: 'In revisione dal responsabile', tone: 'blue', breve: 'In revisione' }, APPROVATO: { label: 'Approvato', tone: 'green', breve: 'Approvato' },
  DEFINITIVO: { label: 'Definitivo', tone: 'teal', breve: 'Definitivo' },
};
export const EVENTO = { RICHIESTA: 'Variazione proposta', APPROVATA: 'Approvazione', RIFIUTATA: 'Non accolta', GODUTA: 'Goduta', ANNULLATA: 'Tolto', PROMEMORIA: 'Promemoria', MODIFICA: 'Modifica', PIANIFICATA: 'Inserito nel piano', MIGRATA: 'Migrazione al piano annuale', VARIAZIONE_PROPOSTA: 'Variazione proposta', VARIAZIONE_APPROVATA: 'Variazione approvata', VARIAZIONE_RIFIUTATA: 'Variazione non accolta' };
export const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
export const GG = ['', 'L', 'M', 'M', 'G', 'V', 'S', 'D'];
export const itData = (s) => (s ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}/${String(s).slice(0, 4)}` : '');
export const itDataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
export const num = (n) => (n == null ? '' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 }));
export const oggiIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
export const periodo = (r) => {
  const a = itData(r.data_inizio), b = itData(r.data_fine);
  if (a === b) return `${a}${r.mezza_inizio ? ' (pomeriggio)' : r.mezza_fine ? ' (mattina)' : ''}`;
  return `${a}${r.mezza_inizio ? ' (pom.)' : ''} → ${b}${r.mezza_fine ? ' (mat.)' : ''}`;
};
export const quantita = (r) => (r.tipo === 'ROL' ? `${num(r.ore)} h ROL` : r.giorni != null ? `${num(r.giorni)} ${Number(r.giorni) === 1 ? 'giorno' : 'giorni'}` : '');
// Date di calendario (UTC per non farsi spostare dall'ora legale)
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const parseIso = (s) => new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))));
export const addDays = (s, n) => { const d = parseIso(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const weekday = (s) => { const g = parseIso(s).getUTCDay(); return g === 0 ? 7 : g; };
export function giorniTra(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
export const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export const giorniMese = (anno, mese) => new Date(Date.UTC(anno, mese, 0)).getUTCDate();   // mese 1..12
export function quotaInData(r, d) {
  if (d < r.data_inizio || d > r.data_fine) return 0;
  if (r.tipo === 'ROL') return d === r.data_inizio ? 0.25 : 0;
  if (d === r.data_inizio && r.mezza_inizio) return 0.5;
  if (d === r.data_fine && r.mezza_fine) return 0.5;
  return 1;
}
export function descriviEvento(e) {
  const d = e.dati || {};
  switch (e.tipo) {
    case 'RICHIESTA': return `Richiesta di ${d.ore ? `${num(d.ore)} ore` : `${num(d.giorni)} giorni`}${d.per_conto ? ' inserita da HR' : ''}${d.sotto_copertura ? ` · ${d.sotto_copertura} giorni sotto la copertura minima` : ''}`;
    case 'APPROVATA': if (d.senza_approvatore) return `Approvata: ${d.nota || 'senza approvatore in organigramma'}`; return `Approvata${d.registrata_da_hr ? ' (registrata da HR)' : ''}${d.hr ? ' da HR' : ''}${d.nota ? `: ${d.nota}` : ''}${d.sotto_copertura ? ' nonostante l\'avviso di copertura' : ''}`;
    case 'RIFIUTATA': return `Rifiutata: ${d.nota || ''}`;
    case 'GODUTA': return d.automatico ? 'Goduta (passata automaticamente a data conclusa)' : 'Goduta';
    case 'ANNULLATA': return `Annullata${d.da_stato ? ` (era ${STATO[d.da_stato]?.label?.toLowerCase() || d.da_stato})` : ''}${d.motivo ? `: ${d.motivo}` : ''}`;
    case 'PROMEMORIA': return `Promemoria all'approvatore (in attesa da ${d.giorni_attesa} giorni)`;
    case 'PIANIFICATA': return `Inserito nel piano (${num(d.giorni)} giorni)${d.da_responsabile ? ' dal responsabile' : ''}${d.nota ? `: ${d.nota}` : ''}`;
    case 'MODIFICA': return `Spostato da ${itData(d.prima?.dal)} → ${itData(d.prima?.al)} a ${itData(d.dopo?.dal)} → ${itData(d.dopo?.al)}${d.nota ? `: ${d.nota}` : ''}`;
    case 'MIGRATA': return 'Richiesta in attesa diventata periodo proposto del piano annuale';
    case 'VARIAZIONE_PROPOSTA': return d.tipo === 'RIMOZIONE' ? `Proposta di togliere il periodo${d.note ? `: ${d.note}` : ''}` : `Proposta di spostare al ${itData(d.data_inizio)} → ${itData(d.data_fine)}${d.note ? `: ${d.note}` : ''}`;
    case 'VARIAZIONE_APPROVATA': return `Variazione approvata${d.nota ? `: ${d.nota}` : ''}`;
    case 'VARIAZIONE_RIFIUTATA': return `Variazione non accolta${d.nota ? `: ${d.nota}` : ''}`;
    default: return EVENTO[e.tipo] || e.tipo;
  }
}

// Cronologia del piano annuale
const P_EV = {
  CREATO: 'Piano creato', MIGRATO: 'Piano creato dalla migrazione al piano annuale', PERIODO_AGGIUNTO: 'Periodo aggiunto', PERIODO_MODIFICATO: 'Periodo spostato', PERIODO_TOLTO: 'Periodo tolto',
  INVIATO: 'Inviato al responsabile', IN_REVISIONE: 'Preso in carico dal responsabile', APPROVATO: 'Approvato', DEFINITIVO: 'Reso definitivo', RIAPERTO: 'Riaperto',
  VARIAZIONE_PROPOSTA: 'Variazione proposta', VARIAZIONE_APPROVATA: 'Variazione approvata', VARIAZIONE_RIFIUTATA: 'Variazione non accolta', VARIAZIONE: 'Variazione al piano definitivo', PROMEMORIA: 'Promemoria',
  RIASSEGNATO: 'Riassegnato al superiore diretto in anagrafica',
};
export function descriviEventoPiano(e) {
  const d = e.dati || {};
  const per = d.dal ? ` ${itData(d.dal)} → ${itData(d.al)}${d.giorni != null ? ` (${num(d.giorni)} gg)` : ''}` : '';
  const nota = d.nota || d.motivo || d.note;
  switch (e.tipo) {
    case 'MIGRATO': return `${P_EV.MIGRATO} (${STATO_PIANO[d.stato]?.label?.toLowerCase() || d.stato}, ${d.periodi} periodi)`;
    case 'PERIODO_MODIFICATO': return `Periodo spostato${d.prima ? ` da ${itData(d.prima.dal)} → ${itData(d.prima.al)}` : ''} a${per}${d.da_responsabile ? ' dal responsabile' : ''}${nota ? `: ${nota}` : ''}`;
    case 'PERIODO_AGGIUNTO': case 'PERIODO_TOLTO': case 'VARIAZIONE': return `${P_EV[e.tipo]}${per}${d.da_responsabile ? ' dal responsabile' : ''}${nota ? `: ${nota}` : ''}`;
    case 'INVIATO': return `Inviato${d.approvatore ? ` a ${d.approvatore}` : ''}: ${d.periodi} periodi, ${num(d.giorni)} giorni${nota ? ` · ${nota}` : ''}`;
    case 'DEFINITIVO': return d.senza_approvatore ? `Reso definitivo all'invio: ${d.nota || 'senza approvatore in organigramma'}` : `${P_EV.DEFINITIVO}${nota ? `: ${nota}` : ''}`;
    case 'RIASSEGNATO': return d.senza_superiore ? `Nessun superiore in anagrafica: decide l'amministratore` : `${P_EV.RIASSEGNATO}: approva ${d.approvatore || 'l\'amministratore'}${(d.saltati || []).length ? ` (${d.saltati.map((x) => `${x.nome} ${x.motivo}`).join(', ')})` : ''}`;
    case 'APPROVATO': return `Approvato${d.periodi != null ? ` (${d.periodi} periodi)` : ''}${nota ? `: ${nota}` : ''}`;
    case 'VARIAZIONE_PROPOSTA': return `Variazione proposta: ${d.tipo === 'AGGIUNTA' ? `aggiunta${per}` : d.tipo === 'RIMOZIONE' ? `togliere ${itData(d.prima?.dal)} → ${itData(d.prima?.al)}` : `spostare ${itData(d.prima?.dal)} → ${itData(d.prima?.al)} al ${itData(d.data_inizio)} → ${itData(d.data_fine)}`}${nota ? ` · ${nota}` : ''}`;
    case 'VARIAZIONE_APPROVATA': case 'VARIAZIONE_RIFIUTATA': return `${P_EV[e.tipo]}${d.ritirata ? ' (ritirata dal dipendente)' : ''}${d.testo ? `: ${d.testo}` : ''}${nota ? ` · ${nota}` : ''}`;
    case 'PROMEMORIA': return d.tipo === 'invio' ? `Promemoria di invio (scadenza ${itData(d.scadenza)})` : `Promemoria al responsabile (in attesa da ${d.giorni_attesa} giorni)`;
    default: return `${P_EV[e.tipo] || e.tipo}${nota ? `: ${nota}` : ''}`;
  }
}
