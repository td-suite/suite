// C7 (programma anagrafica unica, 08/11/2026): un'unica costante dei tipi di struttura (public.sites.kind), prima ripetuta in cinque
// file (Audit, Ordini Dotazione, catalogo dispositivi di Facility, import XLSX, connettore). I moduli importano da qui.
export const SITE_KINDS = ['HEADQUARTER', 'LABORATORIO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'PUNTO_PRELIEVI', 'SERVICE', 'CENTRO_MEDICO', 'ALTRO'];
export const SITE_KIND_LABEL = { HEADQUARTER: 'Sede direzionale', LABORATORIO: 'Laboratorio', CENTRO_DIAGNOSTICO: 'Centro diagnostico', POLIAMBULATORIO: 'Poliambulatorio', PUNTO_PRELIEVI: 'Punto prelievi', SERVICE: 'Punto cliente service', CENTRO_MEDICO: 'Centro medico', ALTRO: 'Altro' };
/** Strutture sanitarie operative di TD: auto-audit mensile (Audit SGI), dotazione di avvio (Ordini), immobili di Facility (+ HQ). */
export const SEDI_OPERATIVE = ['PUNTO_PRELIEVI', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'CENTRO_MEDICO', 'LABORATORIO'];
/** Sedi della rete TD (tutte tranne i punti dei clienti service). */
export const SEDI_TD = SITE_KINDS.filter((k) => k !== 'SERVICE');
/** Sedi della rete commerciale di Retail per predefinito (retail.sites_v.in_network). */
export const SEDI_NETWORK_RETAIL = SITE_KINDS.filter((k) => !['HEADQUARTER', 'SERVICE', 'ALTRO'].includes(k));
