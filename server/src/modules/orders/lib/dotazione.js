// Dotazione di avvio delle sedi (richiesta del CEO, 31/10/2026) e visibilità degli articoli a quattro tipologie di struttura.
// Funzioni pure, senza accesso al database: le usano le route (routes/dotazione.js, admin.js, stock.js, lib/orders.js) e i test
// (server/test/orders-startup.test.mjs).

// Le quattro tipologie dei modelli di dotazione, nell'ordine in cui compaiono nelle pagine
export const TIPOLOGIE = [
  { kind: 'PUNTO_PRELIEVI', name: 'Punto Prelievi' },
  { kind: 'POLIDIAGNOSTICO', name: 'Centro Polidiagnostico' },
  { kind: 'LABORATORIO', name: 'Laboratorio di Analisi' },
  { kind: 'SERVICE', name: 'Cliente service / Legal entity' },
];
export const TIPOLOGIA_KINDS = TIPOLOGIE.map((t) => t.kind);
export const nomeTipologia = (kind) => TIPOLOGIE.find((t) => t.kind === kind)?.name || kind;

// Tipi di sede dell'anagrafica (public.sites.kind) che hanno una dotazione di avvio; HEADQUARTER, ALTRO e i punti SERVICE no
// (i clienti service compaiono come Legal entity).
export const SITE_KINDS_DOTAZIONE = ['PUNTO_PRELIEVI', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'CENTRO_MEDICO', 'LABORATORIO'];
const POLI = ['CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'CENTRO_MEDICO'];

// Tipologia della dotazione dalla struttura di strutture_v: le Legal entity (origin ORG) e i punti SERVICE sono SERVICE;
// per le sedi decide il tipo dell'anagrafica. null = struttura senza dotazione (Direzione, Altro).
export function tipologiaDaSiteKind(siteKind, origin = 'SITE') {
  if (origin === 'ORG' || siteKind === 'SERVICE') return 'SERVICE';
  if (siteKind === 'PUNTO_PRELIEVI') return 'PUNTO_PRELIEVI';
  if (POLI.includes(siteKind)) return 'POLIDIAGNOSTICO';
  if (siteKind === 'LABORATORIO') return 'LABORATORIO';
  return null;
}

// Colonna di visibilità dell'articolo per una struttura ({ site_kind, origin, kind } di strutture_v):
// Punto Prelievi → visible_sedi, Centro Polidiagnostico → visible_poli, Laboratorio di Analisi → visible_lab,
// Legal entity / cliente service → visible_service. Per le sedi senza tipo utile (Direzione, Altro) decide il ruolo nel
// flusso del modulo (kind: CLIENTE → service, LAB → laboratorio, SEDE → punti prelievo), come prima delle quattro tipologie.
export const COLONNE_VISIBILITA = { PUNTO_PRELIEVI: 'visible_sedi', POLIDIAGNOSTICO: 'visible_poli', LABORATORIO: 'visible_lab', SERVICE: 'visible_service' };
export function colonnaVisibilita(s = {}) {
  const t = tipologiaDaSiteKind(s.site_kind, s.origin);
  if (t) return COLONNE_VISIBILITA[t];
  if (s.kind === 'CLIENTE') return 'visible_service';
  if (s.kind === 'LAB') return 'visible_lab';
  return 'visible_sedi';
}
// Clausola SQL: articolo visibile a tutti o alla tipologia della struttura (alias della tabella articles)
export const clausolaVisibilita = (s, alias = 'a') => `(${alias}.visible_all OR ${alias}.${colonnaVisibilita(s)})`;

// Stato della dotazione: nessun carico o carico senza piano = NON_PIANIFICATA; PIANIFICATA; CONSEGNATA = Giacenza 0 registrata
export const STATI = ['NON_PIANIFICATA', 'PIANIFICATA', 'CONSEGNATA'];
export function statoDotazione(load) {
  if (!load) return 'NON_PIANIFICATA';
  if (load.status === 'CONSEGNATA' || load.delivered_at) return 'CONSEGNATA';
  if (load.status === 'PIANIFICATA') return 'PIANIFICATA';
  return 'NON_PIANIFICATA';
}

// Totali delle righe: articoli con quantità, confezioni pianificate e consegnate
export function totaliDotazione(lines = []) {
  let articoli = 0, pianificate = 0, consegnate = 0;
  for (const l of lines) {
    const p = Math.max(0, Number(l.packs_planned ?? l.packs ?? 0) || 0);
    const d = l.packs_delivered == null ? 0 : Math.max(0, Number(l.packs_delivered) || 0);
    if (p > 0 || d > 0) articoli++;
    pianificate += p; consegnate += d;
  }
  return { articoli, pianificate, consegnate };
}

// Giorni tra oggi e la data di apertura (YYYY-MM-DD, negativo se già aperta); null senza data
export function giorniAllApertura(openedAt, oggi) {
  if (!openedAt) return null;
  const a = Date.UTC(...String(openedAt).slice(0, 10).split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...String(oggi).slice(0, 10).split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
  return Math.round((a - b) / 86400000);
}

// Sede da attenzionare nel badge del menu: data di apertura entro `giorni` (o già aperta) e Giacenza 0 non registrata
export function daAttenzionare(sede, oggi, giorni = 60) {
  const g = giorniAllApertura(sede.opened_at, oggi);
  if (g == null) return false;
  return g <= giorni && statoDotazione(sede.load ?? (sede.status ? { status: sede.status, delivered_at: sede.delivered_at } : null)) !== 'CONSEGNATA';
}
export const contaBadge = (sedi, oggi, giorni = 60) => sedi.filter((s) => daAttenzionare(s, oggi, giorni)).length;
