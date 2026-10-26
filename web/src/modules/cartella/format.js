// Formati del modulo Cartella condivisa: date, dimensioni, tipo di file e icona
export const itDate = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '');
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
export const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const extOf = (name) => String(name || '').split('.').pop()?.toLowerCase() || '';

// Tipo del documento dal nome del file: icona della Suite, etichetta e classe colore (cf-t-<tipo>)
export const TIPI = {
  pdf: { icon: 'pdf', label: 'PDF', cls: 'pdf' },
  docx: { icon: 'doc', label: 'Word', cls: 'doc' },
  xlsx: { icon: 'sheet', label: 'Excel', cls: 'sheet' },
  pptx: { icon: 'doc', label: 'PowerPoint', cls: 'pptx' },
  png: { icon: 'image', label: 'Immagine', cls: 'img' }, jpg: { icon: 'image', label: 'Immagine', cls: 'img' }, jpeg: { icon: 'image', label: 'Immagine', cls: 'img' }, webp: { icon: 'image', label: 'Immagine', cls: 'img' },
  txt: { icon: 'file', label: 'Testo', cls: 'txt' }, csv: { icon: 'sheet', label: 'CSV', cls: 'sheet' }, md: { icon: 'file', label: 'Markdown', cls: 'txt' },
};
export const tipoDi = (d) => TIPI[extOf(d?.filename)] || { icon: 'file', label: (extOf(d?.filename) || 'file').toUpperCase(), cls: 'txt' };
export const anteprimabile = (d) => /^(application\/pdf|image\/)/.test(d?.mime || '');

export const EVENTO = { CARICATO: 'Caricamento', RINOMINATO: 'Rinomina', SPOSTATO: 'Spostamento', ELIMINATO: 'Eliminazione', EVIDENZA: 'Evidenza', VERSIONE: 'Nuova versione', MODIFICATO: 'Descrizione', CARTELLA_CREATA: 'Cartella creata', CARTELLA_RINOMINATA: 'Cartella rinominata', CARTELLA_SPOSTATA: 'Cartella spostata', CARTELLA_ELIMINATA: 'Cartella eliminata' };
export function descriviEvento(e) {
  const d = e.dati || {};
  const doc = e.documento_nome || d.nome || d.filename || `documento ${e.documento_id || ''}`;
  switch (e.tipo) {
    case 'CARICATO': return `Caricato ${doc}${d.size ? ` (${kb(d.size)})` : ''}`;
    case 'RINOMINATO': return `Rinominato "${d.da}" in "${d.a}"`;
    case 'SPOSTATO': return `Spostato ${doc} da ${d.da || 'Cartella principale'} a ${d.a || 'Cartella principale'}`;
    case 'ELIMINATO': return `Eliminato ${doc}${d.percorso ? ` (${d.percorso})` : ''}`;
    case 'EVIDENZA': return d.in_evidenza ? `${doc} messo in evidenza${d.fino ? ` fino al ${itDate(d.fino)}` : ''}` : `${doc} tolto dall'evidenza`;
    case 'VERSIONE': return `${doc}: versione ${d.versione}${d.filename ? ` (${d.filename})` : ''}`;
    case 'MODIFICATO': return `${doc}: descrizione aggiornata`;
    case 'CARTELLA_CREATA': return `Creata la cartella ${e.cartella_nome || d.nome}`;
    case 'CARTELLA_RINOMINATA': return `Cartella rinominata da "${d.da}" a "${d.a}"`;
    case 'CARTELLA_SPOSTATA': return `Cartella spostata da ${d.da} a ${d.a}`;
    case 'CARTELLA_ELIMINATA': return `Eliminata la cartella ${d.nome}`;
    default: return EVENTO[e.tipo] || e.tipo;
  }
}
