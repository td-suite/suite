// Funzioni condivise del modulo Personale sanitario: ore, tariffe, calcolo del rendiconto mensile, profilo dell'utente.
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

export const personKey = (nome) => (nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
export const isAttivita = (nome) => /^(punto prelievi|rm |rx|mammograf|tc\b|moc|opt|seminolog|anatomia patolog|medicina del lavoro)/i.test((nome || '').trim());

/** Tariffa oraria applicabile a una sede (eccezione per sede, altrimenti tariffa base). */
export function tariffaPerSede(dati, sedeId) {
  const c = dati?.compenso || {};
  const ex = (c.eccezioniSede || []).find((e) => e.sedeId === sedeId && e.tariffaOraria != null && e.tariffaOraria !== '');
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
    const sede = sediById[p.sede_id] || p.sede_id;
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

/** Professionista collegato all'utente loggato (ruolo PROF). */
export async function profOfUser(u) {
  if (!u) return null;
  return (await one('SELECT * FROM professionisti WHERE user_id=$1 AND attivo', [u.id])) || (await one('SELECT * FROM professionisti WHERE lower(email)=lower($1) AND attivo', [u.email]));
}

export async function sediMap() {
  const rows = await many("SELECT id, data->>'denominazione' AS den, data->>'nomeSede' AS nome, data->>'indirizzo' AS ind FROM strutture WHERE deleted_at IS NULL");
  const m = {}; const cnt = {}; rows.forEach((r) => { cnt[r.den] = (cnt[r.den] || 0) + 1; });
  rows.forEach((r) => { m[r.id] = r.nome ? `${r.den} · ${r.nome}` : cnt[r.den] > 1 && r.ind ? `${r.den} · ${r.ind.split(',')[0]}` : r.den; });
  return m;
}

/** Vista pubblica del professionista (senza dati fiscali) per elenchi e turni. */
export const profLite = (p) => ({ id: p.id, nome: p.nome, tipo: p.tipo, profilo: p.profilo, email: p.email, attivo: p.attivo, personaKey: p.persona_key, discipline: p.dati?.professionale?.discipline || [], compensoTipo: p.dati?.compenso?.tipo || 'ORARIO', userId: p.user_id || null });
