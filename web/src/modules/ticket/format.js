export const STATO = { APERTO: { label: 'Aperto', tone: 'blue' }, IN_CORSO: { label: 'In corso', tone: 'teal' }, IN_ATTESA: { label: 'In attesa', tone: 'amber' }, RISOLTO: { label: 'Risolto', tone: 'green' }, CHIUSO: { label: 'Chiuso', tone: 'grey' }, ANNULLATO: { label: 'Annullato', tone: 'red' } };
export const PRIORITA = { P1: { label: 'P1 Critica', short: 'P1', tone: 'red' }, P2: { label: 'P2 Alta', short: 'P2', tone: 'amber' }, P3: { label: 'P3 Normale', short: 'P3', tone: 'teal' }, P4: { label: 'P4 Bassa', short: 'P4', tone: 'grey' } };
export const EVENTO = { APERTO: 'Apertura', PRESO_IN_CARICO: 'Presa in carico', ASSEGNATO: 'Assegnazione', GIRATO: 'Giro ad altra casella', STATO: 'Cambio di stato', PRIORITA: 'Cambio di priorità', COMMENTO: 'Commento', NOTA: 'Nota interna', ALLEGATO: 'Allegato', ESCALATION: 'Escalation', RIAPERTO: 'Riapertura', CHIUSO: 'Chiusura', VALUTATO: 'Valutazione', LETTURA_RISERVATO: 'Lettura riservato', ANNULLATO: 'Annullamento', MODIFICA: 'Modifica', OSSERVATORE: 'Osservatori' };
export const itDate = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '');
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
export const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// Tempo residuo (o di ritardo) rispetto a una scadenza, in forma leggibile
export function residuo(d) {
  if (!d) return '';
  const ms = new Date(d).getTime() - Date.now();
  const abs = Math.abs(ms); const h = Math.floor(abs / 3600_000); const m = Math.floor((abs % 3600_000) / 60_000);
  const txt = h >= 48 ? `${Math.floor(h / 24)} g` : h >= 1 ? `${h} h ${m} min` : `${m} min`;
  return ms < 0 ? `in ritardo di ${txt}` : `tra ${txt}`;
}
export function descriviEvento(e) {
  const d = e.dati || {};
  switch (e.tipo) {
    case 'APERTO': return `Aperto con priorità ${d.priorita} verso ${d.unit || ''}${d.riservato ? ' (riservato)' : ''}`;
    case 'PRESO_IN_CARICO': return 'Preso in carico';
    case 'ASSEGNATO': return `Assegnato a ${d.a || ''}`;
    case 'GIRATO': return `Girato da ${d.da || ''} a ${d.a || ''}: ${d.motivo || ''}`;
    case 'STATO': return `Da ${STATO[d.da]?.label || d.da} a ${STATO[d.a]?.label || d.a}${d.intervallo_attesa ? ` (attesa ${Math.round(d.intervallo_attesa.secondi / 60)} min, scadenza spostata al ${itDateTime(d.nuova_scadenza)})` : ''}${d.messaggio ? `: ${d.messaggio}` : ''}`;
    case 'PRIORITA': return `Priorità da ${d.da} a ${d.a}${d.motivo ? `: ${d.motivo}` : ''} (nuove scadenze ricalcolate)`;
    case 'COMMENTO': return `Commento: ${d.anteprima || ''}`;
    case 'NOTA': return `Nota interna: ${d.anteprima || ''}`;
    case 'ALLEGATO': return `Allegato ${d.filename || ''}`;
    case 'ESCALATION': return `Escalation a ${d.a_unit || ''}: ${d.motivo || ''}`;
    case 'RIAPERTO': return `Riaperto (riapertura n. ${d.riaperture}): ${d.motivo || ''}`;
    case 'CHIUSO': return d.automatico ? `Chiuso automaticamente dopo ${d.giorni} giorni dalla risoluzione` : `Chiuso${d.da_richiedente ? ' dal richiedente' : ''}${d.nota ? `: ${d.nota}` : ''}`;
    case 'VALUTATO': return `Valutazione ${d.valutazione}/5${d.nota ? `: ${d.nota}` : ''}`;
    case 'LETTURA_RISERVATO': return 'Ha letto il ticket riservato';
    case 'ANNULLATO': return `Annullato${d.motivo ? `: ${d.motivo}` : ''}`;
    case 'MODIFICA': return 'Titolo o descrizione modificati dal richiedente';
    case 'OSSERVATORE': return d.aggiunto ? `Aggiunto osservatore ${d.aggiunto}` : 'Rimosso un osservatore';
    default: return EVENTO[e.tipo] || e.tipo;
  }
}
