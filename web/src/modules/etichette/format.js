// Label · formati di data per l'interfaccia (date del gestionale "YYYY-MM-DD", istanti ISO in ora di Roma)
export const itData = (s) => { const v = String(s || ''); return /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : ''; };
export const itDataOra = (s) => (s ? new Date(s).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const oggiIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
