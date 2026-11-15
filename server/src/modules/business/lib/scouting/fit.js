// Ricerca prospect · punteggio di interesse (0-100) con i motivi in chiaro: ogni punto ha una ragione leggibile. I pesi sono una
// prima taratura ragionata, non una statistica: si correggono guardando quali prospect diventano clienti.
export const CATEGORIE = {
  RSA: { etichetta: 'RSA e residenze per anziani', linee: ['SRV'], base: { SRV: 22 } },
  CASA_DI_CURA: { etichetta: 'Case di cura e ospedali', linee: ['SRV'], base: { SRV: 24 } },
  POLIAMBULATORIO: { etichetta: 'Poliambulatori e centri medici', linee: ['SRV', 'PP'], base: { SRV: 20, PP: 22 } },
  STUDIO_MEDICO: { etichetta: 'Studi medici', linee: ['SRV', 'PP'], base: { SRV: 8, PP: 14 } },
  FARMACIA: { etichetta: 'Farmacie', linee: ['PP', 'SRV'], base: { SRV: 8, PP: 24 } },
  LABORATORIO: { etichetta: 'Laboratori di analisi', linee: ['SRV'], base: { SRV: 14 } },
  FISIOTERAPIA: { etichetta: 'Centri di fisioterapia e riabilitazione', linee: ['SRV', 'PP'], base: { SRV: 8, PP: 10 } },
  DENTISTA: { etichetta: 'Studi dentistici', linee: ['SRV'], base: { SRV: 4 } },
  VETERINARIO: { etichetta: 'Cliniche veterinarie', linee: ['SRV'], base: { SRV: 6 } },
  DIALISI: { etichetta: 'Centri dialisi', linee: ['SRV'], base: { SRV: 20 } },
  AZIENDA: { etichetta: 'Aziende e stabilimenti', linee: ['MDL'], base: { MDL: 15 } },
  ALTRO: { etichetta: 'Altro', linee: ['SRV', 'PP', 'MDL'], base: { SRV: 5, PP: 5, MDL: 5 } },
};
export function punteggio(c, linea = c.linea) {
  const s = c.segnali || {}; const m = [];
  const piu = (n, perche) => { if (n) m.push({ punti: n, perche }); };
  piu((CATEGORIE[c.categoria]?.base || {})[linea] ?? 5, `Tipologia: ${CATEGORIE[c.categoria]?.etichetta || 'non classificata'}`);
  if (linea === 'MDL') {
    const d = Number(s.DIPENDENTI?.valore || 0);
    if (d) piu(d >= 250 ? 30 : d >= 50 ? 22 : 12, `${d} dipendenti dichiarati`);
    if (/45001/.test(String(s.CERTIFICAZIONI?.valore || ''))) piu(10, 'Certificata ISO 45001: salute e sicurezza presidiate');
    if (s.ASSUME) piu(8, 'Sta assumendo: nuove visite preassuntive');
    if (s.SEDI_MULTIPLE) piu(8, `${s.SEDI_MULTIPLE.valore} sedi dichiarate`);
    if (s.GRUPPO) piu(5, `Fa parte del ${s.GRUPPO.valore}`);
  } else {
    if (s.PRELIEVI_IN_SEDE) piu(linea === 'PP' ? 10 : 22, 'Fa prelievi o analisi: oggi qualcuno glieli esegue');
    if (s.PRELIEVI_DOMICILIO) piu(4, 'Prelievi a domicilio');
    if (s.FORNITORE_LAB) piu(10, `Fornitore di laboratorio citato: ${s.FORNITORE_LAB.valore}`);
    if (s.LAB_INTERNO) piu(-8, 'Dichiara un laboratorio interno: spazio solo sugli esami di secondo livello');
    if (s.ACCREDITATO) piu(8, 'Accreditata o convenzionata');
    const pl = Number(s.POSTI_LETTO?.valore || 0);
    if (pl) piu(pl >= 100 ? 18 : pl >= 40 ? 12 : 6, `${pl} posti letto`);
    if (s.SEDI_MULTIPLE) piu(8, `${s.SEDI_MULTIPLE.valore} sedi dichiarate`);
    if (s.GRUPPO) piu(6, `Fa parte del ${s.GRUPPO.valore}`);
    if (s.ASSUME_SANITARI) piu(4, 'Cerca personale sanitario: attività in crescita');
    if (linea === 'PP' && s.DIAGNOSTICA_IMMAGINI) piu(6, 'Ha già diagnostica per immagini');
  }
  if (s.DIRETTORE_SANITARIO_NOTO && linea !== 'MDL') piu(8, 'Direttore sanitario noto');
  else if (s.DECISORE_NOTO) piu(6, 'Decisore noto');
  if (s.EMAIL_DECISORE) piu(5, 'Email di un decisore');
  else if (s.EMAIL_GENERALE) piu(3, 'Email generale pubblicata');
  if (s.PIVA_NOTA) piu(2, 'Partita IVA nota');
  if (s.SENZA_SITO) piu(-6, 'Nessun sito indicato: profilo da completare a mano');
  const tot = Math.max(0, Math.min(100, m.reduce((a, x) => a + x.punti, 0)));
  return { punteggio: tot, motivi: m };
}
