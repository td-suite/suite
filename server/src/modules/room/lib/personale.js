// Funzioni condivise del modulo Personale sanitario: ore, tariffe, calcolo del rendiconto mensile, profilo dell'utente.
// I professionisti sono TUTTE le persone dell'anagrafica unica (public.people, qualunque kind) con la scheda Room in person_ext:
// la vista professionisti_v le unisce con le colonne che il codice si aspetta (id, nome, tipo, profilo, email, attivo, dati, sede, ruolo).
// Chi non va pianificato si esclude persona per persona (person_ext.planning_excluded): pianificabile = attivo e non escluso.
import { one, many } from '../db.js';
import { r2 } from './util.js';

export const t2m = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
export const m2t = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const oreTra = (da, a) => Math.max(0, t2m(a) - t2m(da)) / 60;
export const isoDate = (d) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
export const meseDi = (iso) => iso.slice(0, 7);
export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const meseTxt = (m) => { const [y, mm] = m.split('-'); return `${MESI[Number(mm) - 1]} ${y}`; };
export const validMese = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export const dow = (iso) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0 = lunedì

export const PROFILI = ['Medico', 'Infermiere', 'Tecnico di radiologia', 'Tecnico di laboratorio', 'Ostetrica', 'Fisioterapista', 'Biologo', 'Psicologo', 'Dietista', 'Logopedista', 'OSS', 'Altro'];
export const DOC_TIPI = ['CV', 'DOCUMENTO_IDENTITA', 'CODICE_FISCALE', 'ALBO', 'ASSICURAZIONE', 'TITOLO_STUDIO', 'CONTRATTO', 'PRIVACY', 'ALTRO'];

export const personKey = (nome) => (nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
// Aggancio fra una riga del personale di sede (site_ext.data.personale) e una persona dell'anagrafica (v0.68.1): prima person_id della
// riga (scelto dall'elenco con PersonaPicker, v0.67.3), poi la chiave del nome. Con person_id indicato vale solo quello.
const conId = (riga) => riga?.person_id != null && riga.person_id !== '' && Number.isInteger(Number(riga.person_id));
export const stessaPersona = (riga, persona) => (conId(riga) ? Number(riga.person_id) === Number(persona?.id) : personKey(riga?.nome) === personKey(persona?.nome));
/** Ricerca nelle persone (con id e nome): trova(riga) usa prima person_id (se la persona è nell'elenco), poi la chiave del nome. */
export function indicePersone(persone = []) {
  const byId = new Map(persone.map((p) => [Number(p.id), p]));
  const byKey = new Map(persone.map((p) => [personKey(p.nome), p]));
  return (riga) => (conId(riga) && byId.get(Number(riga.person_id))) || byKey.get(personKey(riga?.nome)) || null;
}
/**
 * Aggancio delle righe del personale di sede per turni, presenze e calendario (v0.68.4). persone: TUTTE le righe di professionisti_v
 * (con attivo e planning_excluded), non solo i pianificabili: essere nel personale di una sede è già l'aggancio con l'attività di sede,
 * quindi una persona attiva e non esclusa è pianificabile anche senza scheda Room (la scheda si crea da sola, assicuraSchedeRoom).
 * Ritorna (riga) → { persona, motivo }: persona null con il motivo leggibile quando la riga non è agganciabile.
 */
export const LINK_D52 = '/admin/diagnostica';
export function agganciatore(persone = []) {
  const trova = indicePersone(persone);
  return (riga) => {
    const p = trova(riga);
    if (!p) return { persona: null, motivo: conId(riga) ? 'la persona scelta non c\'è più nell\'anagrafica: sceglierla di nuovo in Sedi e ambulatori > Personale' : 'non agganciata all\'anagrafica (nessuna persona con questo nome): sceglierla dall\'elenco in Sedi e ambulatori > Personale ("Cambia"), creandola prima in Amministrazione > Persone se manca (Diagnostica D52)' };
    if (p.attivo === false) return { persona: null, motivo: `${p.nome} non è attiva nell'anagrafica (Amministrazione > Persone)` };
    if (p.planning_excluded) return { persona: null, motivo: `${p.nome} è esclusa dalla pianificazione: riportarla tra i pianificabili in Personale sanitario > Professionisti` };
    return { persona: p, motivo: null };
  };
}
/** Tipo della scheda Room dal gruppo del personale di sede: medico → medico; personale sanitario e accettazione → sanitario. */
export const tipoScheda = (gruppo) => (gruppo === 'medico' ? 'medico' : 'sanitario');
/**
 * Scheda Room creata in automatico per chi è nel personale di una sede (v0.68.4, CEO 10/11/2026: niente passaggi manuali). Solo per le
 * persone attive, non escluse e ancora senza scheda (person_ext.tipo vuoto); chi ha già la scheda non si tocca. La sede entra tra le
 * sedi abilitate. righe: [{ riga, persona }] già agganciate. Ritorna il numero di schede create.
 */
export async function assicuraSchedeRoom(sedeId, righe, userId = null) {
  let n = 0;
  for (const { riga, persona: p } of righe) {
    if (!p || p.in_room || p.attivo === false || p.planning_excluded) continue;
    const profilo = riga.profilo || p.profilo || (riga.tipo === 'accettazione' ? 'Accettazione' : riga.tipo === 'medico' ? 'Medico' : null);
    const dati = { sediAbilitate: [Number(sedeId)].filter((x) => x > 0), compenso: { tipo: 'ORARIO' }, origine: `personale della sede ${sedeId} (${riga.tipo})` };
    const r = await one(`INSERT INTO person_ext (person_id, tipo, profilo, dati, updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (person_id) DO UPDATE SET tipo=EXCLUDED.tipo, profilo=coalesce(person_ext.profilo, EXCLUDED.profilo), dati=person_ext.dati || EXCLUDED.dati, updated_at=now(), updated_by=EXCLUDED.updated_by
        WHERE person_ext.tipo IS NULL AND NOT person_ext.planning_excluded RETURNING person_id`, [p.id, tipoScheda(riga.tipo), profilo, JSON.stringify(dati), userId]);
    if (r) { n++; p.in_room = true; }
  }
  return n;
}
export const isAttivita = (nome) =>/^(punto prelievi|rm |rx|mammograf|tc\b|moc|opt|seminolog|anatomia patolog|medicina del lavoro)/i.test((nome || '').trim());

// Colonne della vista professionisti_v usate dalle route (alias p)
export const PROF_COLS = 'p.id, p.nome, p.last_name, p.first_name, p.kind, p.status, p.title, p.tipo, p.profilo, p.email, p.phone, p.phone_office, p.tax_code, p.discipline, p.job_title, p.sex, p.birth_date, p.birth_place, p.vat_number, p.address, p.zip, p.city, p.province, p.site_id, p.site_name, p.role_id, p.role_name, p.attivo, p.dati, p.in_room, p.planning_excluded, p.pianificabile, p.created_at, p.updated_at, p.updated_by';
// Tipi di persona dell'anagrafica unica (people.kind) con l'etichetta mostrata nel modulo
export const KIND_LABEL = { DIPENDENTE: 'Dipendente', LP: 'Libero professionista', MEDICO: 'Medico', SANITARIO: 'Professionista sanitario', ESTERNO: 'Esterno', DIRIGENTE: 'Dirigente' };
// Ruolo del catalogo (public.job_roles) considerato sanitario: espressione regolare PostgreSQL (case insensitive) sul nome.
// Serve all'azione di massa "Escludi tutti i non sanitari": chi ha kind DIPENDENTE/ESTERNO/DIRIGENTE senza disciplina e senza
// ruolo sanitario viene escluso dalla pianificazione; MEDICO e SANITARIO restano sempre dentro.
export const RUOLO_SANITARIO_RE = '(medic|sanitar|infermier|ostetric|fisioterap|biolog|psicolog|dietist|logoped|radiolog|laborator|tsrm|tslb|\\moss\\M|prelev|assistente sanitari)';

/** Tariffa oraria applicabile a una sede (eccezione per sede, altrimenti tariffa base). */
export function tariffaPerSede(dati, sedeId) {
  const c = dati?.compenso || {};
  const ex = (c.eccezioniSede || []).find((e) => String(e.sedeId) === String(sedeId) && e.tariffaOraria != null && e.tariffaOraria !== '');
  return Number(ex ? ex.tariffaOraria : c.tariffaOraria || 0);
}

/** Calcolo del rendiconto mensile dalle presenze confermate. Ritorna {ore, importo, righe, perSede, compenso}. */
export function calcolaRendiconto(prof, presenze, sediById = {}) {
  const c = prof.dati?.compenso || {};
  const tipo = c.tipo === 'FISSO' ? 'FISSO' : 'ORARIO';
  const righe = [];
  let ore = 0, importo = 0;
  const perSede = {};
  for (const p of presenze.filter((x) => x.stato === 'CONFERMATA')) {
    const h = r2(oreTra(p.ora_da, p.ora_a));
    const tariffa = tipo === 'ORARIO' ? tariffaPerSede(prof.dati, p.sede_id) : 0;
    const imp = r2(h * tariffa);
    ore = r2(ore + h); importo = r2(importo + imp);
    const sede = sediById[p.sede_id] || String(p.sede_id);
    (perSede[p.sede_id] ||= { sedeId: p.sede_id, sede, ore: 0, importo: 0, presenze: 0 });
    perSede[p.sede_id].ore = r2(perSede[p.sede_id].ore + h); perSede[p.sede_id].importo = r2(perSede[p.sede_id].importo + imp); perSede[p.sede_id].presenze++;
    righe.push({ presenzaId: p.id, data: isoDate(p.data), sedeId: p.sede_id, sede, oraDa: p.ora_da, oraA: p.ora_a, ore: h, tariffa, importo: imp, attivita: p.attivita || '', nota: p.nota || '' });
  }
  const fisso = tipo === 'FISSO' ? r2(c.fissoMensile || 0) : 0;
  const imponibile = tipo === 'FISSO' ? fisso : importo;
  // Oneri indicativi per la fattura (regime del professionista): cassa previdenziale, IVA, ritenuta d'acconto
  const cassaPct = Number(c.cassaPrevidenziale || 0), ivaPct = Number(c.ivaPercent || 0), ritPct = Number(c.ritenutaAcconto || 0);
  const cassa = r2(imponibile * cassaPct / 100);
  const iva = r2((imponibile + cassa) * ivaPct / 100);
  const ritenuta = r2(imponibile * ritPct / 100);
  const totaleFattura = r2(imponibile + cassa + iva);
  const netto = r2(totaleFattura - ritenuta);
  return { tipo, ore, importo: imponibile, righe: righe.sort((a, b) => a.data.localeCompare(b.data) || a.oraDa.localeCompare(b.oraDa)), perSede: Object.values(perSede), fisso,
    compenso: { tipo, tariffaOraria: c.tariffaOraria || null, fissoMensile: c.fissoMensile || null, regime: c.regime || null, cassaPct, ivaPct, ritPct },
    oneri: { imponibile, cassa, iva, ritenuta, totaleFattura, netto } };
}

/** Professionista (persona dell'anagrafica unica) collegato all'utente loggato: req.user.person_id, altrimenti la persona con la stessa email. */
export async function profOfUser(u) {
  if (!u) return null;
  if (u.person_id) { const p = await one(`SELECT ${PROF_COLS} FROM professionisti_v p WHERE p.id=$1`, [u.person_id]); if (p) return p; }
  return one(`SELECT ${PROF_COLS} FROM professionisti_v p WHERE lower(p.email)=lower($1) AND p.attivo ORDER BY p.in_room DESC, p.id LIMIT 1`, [u.email]);
}

/** Etichette delle sedi attive dell'anagrafica unica: {id: 'Nome'} (con il primo pezzo dell'indirizzo se il nome si ripete). */
export async function sediMap() {
  const rows = await many('SELECT id, name, address FROM public.sites WHERE active');
  const m = {}; const cnt = {}; rows.forEach((r) => { cnt[r.name] = (cnt[r.name] || 0) + 1; });
  rows.forEach((r) => { m[r.id] = cnt[r.name] > 1 && r.address ? `${r.name} · ${r.address.split(',')[0]}` : r.name; });
  return m;
}

/** Vista pubblica del professionista (senza dati fiscali) per elenchi e turni. */
export const profLite = (p) => ({ id: p.id, nome: p.nome, lastName: p.last_name, firstName: p.first_name, tipo: p.tipo, profilo: p.profilo, email: p.email, attivo: p.attivo, personaKey: personKey(p.nome), kind: p.kind, status: p.status, inRoom: p.in_room,
  siteId: p.site_id, siteName: p.site_name, roleId: p.role_id, roleName: p.role_name, planningExcluded: p.planning_excluded, pianificabile: p.pianificabile,
  discipline: discipline(p), compensoTipo: p.dati?.compenso?.tipo || 'ORARIO' });

/** Discipline: quella dell'anagrafica unica più quelle della scheda Room. */
export const discipline = (p) => [...new Set([p.discipline, ...(p.dati?.professionale?.discipline || [])].filter(Boolean))];
