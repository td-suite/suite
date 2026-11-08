// C11 (programma anagrafica unica, 08/11/2026): l'indirizzo di ritorno dei kit è, per predefinito, quello dei Dati aziendali della Suite
// (Amministrazione > Impostazioni > Dati aziendali). L'impostazione del modulo vale solo se è stata cambiata: vuota o uguale al testo
// iniziale della migrazione 001 (copia di allora dei dati aziendali) significa "dai Dati aziendali".
import { getCompany, companyAddress } from '../../../lib/company.js';

export const RITORNO_INIZIALE = 'Toscana Diagnostica S.r.l.\nVia di Pratignone, 13/4\n50019 Sesto Fiorentino (FI)\nItalia';
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Testo dell'indirizzo di ritorno (più righe) dal valore dell'impostazione. */
export async function indirizzoRitorno(valore) {
  if (norm(valore) && norm(valore) !== norm(RITORNO_INIZIALE)) return valore;
  const co = await getCompany();
  return [co.legal_name, co.address, [co.zip, co.city].filter(Boolean).join(' ') + (co.province ? ` (${co.province})` : ''), 'Italia'].filter((x) => x && String(x).trim()).join('\n') || companyAddress(co);
}
