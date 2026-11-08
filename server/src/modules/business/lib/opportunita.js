// Import del DB Opportunità del CEO (XLSX "DB Opportunità B2B Laboratorio", 49 colonne) nel Business Hub.
// Precisazioni del CEO (06/11/2026):
// - "Valuta cosa c'è già in Contratti e non fare sovrapposizioni": i contratti service caricati dai pacchetti hanno in data.pipeline
//   la pipeline del 21/07/2026 e le controparti sono già Legal entity. Abbinamento, nell'ordine: riga già importata (legacy_refs.
//   db_opportunita), contratto esistente ("Cliente Pipeline" = data.pipeline.cliente), email o PEC della Legal entity, ragione sociale
//   normalizzata, somiglianza del nome (≥ 90% abbinata, 72-90% DUBBIO da confermare a mano, sotto: nuova). Le differenze tra DB e
//   contratto (fase, date, fatturato) diventano un'attività SISTEMA "riconciliazione": il contratto non si tocca.
// - "Tutti diventano Legal entity": le righe non abbinate diventano public.organizations di tipo CLIENTE (il tipo TARGET della Suite
//   è riservato alle società da acquisire di Integration, docs/ANAGRAFICA.md) con il flag prospect sull'account.
// - "Se hanno più sedi, conta la sola Legal entity": righe dello stesso gruppo o ente gestore (non generico) o con la stessa ragione
//   sociale → UNA Legal entity e UN account; le strutture restano nell'elenco sedi dell'account (accounts.sedi), non come
//   public.sites: una sede SERVICE diventa punto di consegna di Ordini e sede inviante di NC, si crea in Amministrazione > Sedi
//   quando la struttura parte davvero.
// Nessun dato inventato: i valori vengono dal file; "n.d." resta vuoto con nota; la riga originale resta in import_raw.
// Idempotente: rieseguire ritrova le righe per ID (legacy_refs.db_opportunita) e l'account per Legal entity e linea; le date di fase
// già registrate nella Suite prevalgono su quelle del file; diario e cliente attivo non si toccano.
import ExcelJS from 'exceljs';
import { one, many, q } from '../db.js';
import { norm } from '../../../lib/anagraficaMatch.js';
import { indexOrg } from '../../../lib/search.js';
import {
  leggiRiga, intestazioniMancanti, raggruppa, rigaPrincipale, prioritaMassima, somma, parseEmailCampo, splitReferenti,
  regolaImportAttivo, esitoSomiglianza, differenzePipeline, faseEffettiva, faseDaDate, faseDb,
} from './hub.js';

export async function leggiFile(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw Object.assign(new Error('Il file non è un XLSX leggibile'), { status: 400 }); }
  const ws = wb.worksheets.find((w) => intestazioniMancanti((w.getRow(1).values || []).slice(1)).length < 10) || wb.worksheets[0];
  if (!ws) throw Object.assign(new Error('Il file non contiene fogli'), { status: 400 });
  const headers = (ws.getRow(1).values || []).slice(1).map((h) => String(h ?? '').trim());
  const mancanti = intestazioniMancanti(headers);
  if (mancanti.length > 5) throw Object.assign(new Error(`Non sembra il DB Opportunità: mancano ${mancanti.length} colonne (${mancanti.slice(0, 6).join(', ')}…)`), { status: 400 });
  const righe = []; let scartate = 0;
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const r = leggiRiga(headers, (row.values || []).slice(1));
    if (Number.isInteger(r.id) && r.ragione_sociale) righe.push(r); else if (r.ragione_sociale || r.id != null) scartate++;
  });
  const visti = new Set(); const doppi = [];
  for (const r of righe) { if (visti.has(r.id)) doppi.push(r.id); visti.add(r.id); }
  return { foglio: ws.name, righe, mancanti, scartate, doppi };
}

// ---------------- Abbinamento ----------------
async function contesto() {
  const orgs = await many(`SELECT id, name, kind, city, email, pec, active, legacy_refs FROM public.organizations WHERE kind NOT IN ('GRUPPO','SOCIETA')`);
  const perNome = new Map();
  for (const o of orgs) { const k = norm(o.name); if (!k) continue; if (!perNome.has(k)) perNome.set(k, []); perNome.get(k).push(o); }
  const perEmail = new Map();
  for (const o of orgs) for (const e of [o.email, o.pec]) if (e) perEmail.set(String(e).trim().toLowerCase(), o);
  const perRiga = new Map();
  for (const o of orgs) { const v = o.legacy_refs?.db_opportunita; for (const id of Array.isArray(v) ? v : v != null ? [v] : []) perRiga.set(Number(id), o); }
  const contratti = await many(`SELECT c.id, c.kind, c.org_id, c.title, c.protocol, c.status, c.data->'pipeline' AS pipeline, o.name AS org_name
    FROM contracts c LEFT JOIN public.organizations o ON o.id=c.org_id WHERE c.org_id IS NOT NULL AND c.status <> 'ANNULLATO'`);
  const perCliente = new Map();
  for (const c of contratti) if (c.pipeline?.cliente) perCliente.set(norm(c.pipeline.cliente), c);
  const accounts = await many(`SELECT id, organization_id, linea, cliente_attivo, phase_dates, sedi, owner_user_id FROM accounts`);
  return { orgs, perNome, perEmail, perRiga, perCliente, contratti, accounts };
}

async function simili(nome) {
  if (!nome) return [];
  return many(`SELECT id, name, city, similarity(lower(name), lower($1))::float AS s FROM public.organizations
    WHERE kind NOT IN ('GRUPPO','SOCIETA') AND similarity(lower(name), lower($1)) >= 0.5 ORDER BY s DESC LIMIT 3`, [nome]);
}

// Esito di un'unità: { esito: GIA_IMPORTATA | CONTRATTO | ESISTENTE | DUBBIO | NUOVA, org, come, contratti, candidati, avvisi }
async function abbinaUnita(u, ctx) {
  const avvisi = [];
  const nomi = [u.gruppo, ...u.righe.map((r) => r.ragione_sociale)].filter(Boolean);
  // 1) righe già importate
  const prev = [...new Set(u.righe.map((r) => ctx.perRiga.get(r.id)).filter(Boolean))];
  // 2) contratti esistenti (Cliente Pipeline = data.pipeline.cliente dei pacchetti)
  const contratti = [];
  for (const r of u.righe) {
    if (!r.cliente_pipeline) continue;
    const c = ctx.perCliente.get(norm(r.cliente_pipeline));
    if (c) contratti.push({ ...c, riga: r.id }); else avvisi.push(`Riga ${r.id}: "Cliente Pipeline" ${r.cliente_pipeline} non trova un contratto con quella pipeline`);
  }
  const orgContratti = [...new Set(contratti.map((c) => c.org_id))];
  if (orgContratti.length > 1) avvisi.push(`Righe del gruppo collegate a ${orgContratti.length} Legal entity diverse dei contratti (${[...new Set(contratti.map((c) => c.org_name))].join(', ')}): l'account nasce sulla prima, le altre restano come sono (da verificare)`);
  if (prev.length) return { esito: 'GIA_IMPORTATA', org: { id: prev[0].id, name: prev[0].name }, come: 'righe già importate (ID del DB)', contratti, candidati: [], avvisi };
  if (contratti.length) return { esito: 'CONTRATTO', org: { id: contratti[0].org_id, name: contratti[0].org_name }, come: `contratto ${contratti[0].protocol || `#${contratti[0].id}`} (Cliente Pipeline "${contratti[0].pipeline?.cliente}")`, contratti, candidati: [], avvisi };
  // 3) email o PEC
  for (const r of u.righe) {
    const { email, pec } = parseEmailCampo(r.email);
    for (const e of [email, pec].filter(Boolean)) { const o = ctx.perEmail.get(e); if (o) return { esito: 'ESISTENTE', org: { id: o.id, name: o.name }, come: `email ${e}`, contratti, candidati: [], avvisi }; }
  }
  // 4) ragione sociale normalizzata (con la città quando i candidati sono più di uno)
  for (const n of nomi) {
    const hit = ctx.perNome.get(norm(n)) || [];
    if (hit.length === 1) return { esito: 'ESISTENTE', org: { id: hit[0].id, name: hit[0].name }, come: 'ragione sociale', contratti, candidati: [], avvisi };
    if (hit.length > 1) {
      const citta = new Set(u.righe.map((r) => norm(r.citta)).filter(Boolean));
      const inCitta = hit.filter((o) => citta.has(norm(o.city)));
      if (inCitta.length === 1) return { esito: 'ESISTENTE', org: { id: inCitta[0].id, name: inCitta[0].name }, come: 'ragione sociale e città', contratti, candidati: [], avvisi };
      return { esito: 'DUBBIO', org: null, come: `${hit.length} Legal entity con lo stesso nome`, contratti, candidati: hit.map((o) => ({ id: o.id, name: o.name, city: o.city, s: 1 })), avvisi };
    }
  }
  // 5) somiglianza (pg_trgm)
  let best = []; for (const n of nomi) { const s = await simili(n); if (s.length && (!best.length || s[0].s > best[0].s)) best = s; }
  const top = best[0];
  const es = top ? esitoSomiglianza(Number(top.s)) : 'NUOVO';
  if (es === 'ABBINATO') return { esito: 'ESISTENTE', org: { id: top.id, name: top.name }, come: `nome simile (${Math.round(top.s * 100)}%)`, contratti, candidati: [], avvisi };
  if (es === 'DUBBIO') return { esito: 'DUBBIO', org: null, come: `nome simile al ${Math.round(top.s * 100)}%: da confermare`, contratti, candidati: best.filter((x) => x.s >= 0.72).map((x) => ({ id: x.id, name: x.name, city: x.city, s: Math.round(x.s * 100) / 100 })), avvisi };
  return { esito: 'NUOVA', org: null, come: 'nessuna Legal entity corrispondente', contratti, candidati: [], avvisi };
}

const nomeUnita = (u) => u.gruppo || rigaPrincipale(u.righe).ragione_sociale;

/**
 * Piano dell'import (Prova, senza scrivere) e base dell'esecuzione. decisioni: { [chiave unità]: id Legal entity | 'NUOVA' | 'SALTA' }
 */
export async function pianifica(file, decisioni = {}) {
  const ctx = await contesto();
  const unita = raggruppa(file.righe);
  const out = [];
  for (const u of unita) {
    const a = await abbinaUnita(u, ctx);
    const d = decisioni[u.chiave];
    let esito = a.esito; let org = a.org; let come = a.come;
    if (a.esito === 'DUBBIO' && d != null && d !== '') {
      if (d === 'NUOVA') { esito = 'NUOVA'; come = 'deciso a mano: nuova Legal entity'; }
      else if (d === 'SALTA') { esito = 'SALTATA'; come = 'deciso a mano: non importare'; }
      else { const o = ctx.orgs.find((x) => x.id === Number(d)); if (o) { esito = 'ESISTENTE'; org = { id: o.id, name: o.name }; come = 'deciso a mano'; } }
    }
    const p = rigaPrincipale(u.righe);
    const acc = org ? ctx.accounts.find((x) => x.organization_id === org.id && x.linea === 'SRV') : null;
    out.push({
      chiave: u.chiave, nome: nomeUnita(u), gruppo: u.gruppo, righe: u.righe.map((r) => ({ id: r.id, nome: r.ragione_sociale, citta: r.citta, prov: r.prov })),
      esito, esito_abbinamento: a.esito, org, come, candidati: a.candidati, avvisi: a.avvisi,
      contratti: a.contratti.map((c) => ({ id: c.id, protocol: c.protocol, title: c.title, status: c.status, riga: c.riga, differenze: differenzePipeline(u.righe.find((r) => r.id === c.riga) || p, c.pipeline) })),
      account_esistente: acc?.id || null,
      fase: faseEffettiva(p.phase_dates, acc?.cliente_attivo || false), fase_db: p.fase_attuale || faseDb(faseDaDate(p.phase_dates)),
      alert: u.righe.filter((r) => r.alert_riconciliazione).map((r) => ({ id: r.id, testo: r.alert_riconciliazione })),
      da_confermare: u.righe.some((r) => regolaImportAttivo(r).da_confermare),
      nd: [...new Set(u.righe.flatMap((r) => r.nd))],
    });
  }
  // Più unità sulla stessa Legal entity (es. una struttura abbinata per email alla Legal entity di un contratto): un solo account
  const perOrg = new Map();
  for (const x of out) if (x.org?.id && !['DUBBIO', 'SALTATA'].includes(x.esito)) { if (!perOrg.has(x.org.id)) perOrg.set(x.org.id, []); perOrg.get(x.org.id).push(x); }
  for (const list of perOrg.values()) if (list.length > 1) for (const x of list) x.avvisi.push(`Stessa Legal entity (${x.org.name}) di ${list.filter((y) => y !== x).map((y) => y.nome).join(', ')}: le righe confluiscono in un solo account`);
  const c = (f) => out.filter(f).length;
  const conteggi = {
    righe: file.righe.length, unita: out.length, gruppi: c((x) => x.righe.length > 1), righe_in_gruppi: out.filter((x) => x.righe.length > 1).reduce((n, x) => n + x.righe.length, 0),
    gia_importate: c((x) => x.esito === 'GIA_IMPORTATA'), abbinate_contratto: c((x) => x.esito === 'CONTRATTO'), abbinate_legal_entity: c((x) => x.esito === 'ESISTENTE'),
    nuove: c((x) => x.esito === 'NUOVA'), dubbi: c((x) => x.esito === 'DUBBIO'), saltate: c((x) => x.esito === 'SALTATA'),
    account_nuovi: c((x) => x.esito === 'NUOVA') + [...perOrg.values()].filter((l) => !l[0].account_esistente).length, account_esistenti: [...perOrg.values()].filter((l) => l[0].account_esistente).length,
    righe_con_alert: out.reduce((n, x) => n + x.alert.length, 0), da_confermare_ceo: c((x) => x.da_confermare),
    contratti_con_differenze: out.reduce((n, x) => n + x.contratti.filter((k) => k.differenze.length).length, 0),
    righe_scartate: file.scartate || 0, id_doppi: file.doppi || [],
  };
  return { foglio: file.foglio, conteggi, unita: out };
}

// ---------------- Esecuzione ----------------
const testo = (righe) => righe.filter(Boolean).join('\n');

async function addActivity(accountId, a, userId) {
  const r = await one(`INSERT INTO activities (account_id, tipo, at, user_id, con_chi, oggetto, testo, esito, contract_id, fase_da, fase_a, dati)
    VALUES ($1,$2,coalesce($3, now()),$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (account_id, (dati->>'import_key')) WHERE dati ? 'import_key' DO NOTHING RETURNING id`,
  [accountId, a.tipo || 'SISTEMA', a.at || null, userId || null, a.con_chi || null, a.oggetto || null, a.testo || null, a.esito || null, a.contract_id || null, a.fase_da ?? null, a.fase_a ?? null, a.dati ? JSON.stringify(a.dati) : null]);
  return r?.id || null;
}

function sedeDaRiga(r) {
  const { email, pec, nota } = parseEmailCampo(r.email);
  return { id_db: r.id, nome: r.ragione_sociale, tipologia: r.tipologia, indirizzo: r.indirizzo, citta: r.citta, prov: r.prov, email, pec, email_nota: nota, telefono: r.telefono, referente: r.referente,
    priorita: r.priorita, fase: faseDb(faseDaDate(r.phase_dates)) || '0. Prospect', fatturato_fy_atteso: r.fatturato_fy_atteso, fornitore_attuale: r.fornitore_attuale, situazione_fornitore: r.situazione_fornitore, nd: r.nd };
}

export async function esegui(file, decisioni, userId) {
  const piano = await pianifica(file, decisioni);
  const perChiave = new Map(raggruppa(file.righe).map((u) => [u.chiave, u]));
  // unità che arrivano sulla stessa Legal entity esistente: una sola esecuzione con tutte le righe (un account, le strutture come sedi)
  const lavori = []; const perOrg = new Map();
  for (const p of piano.unita) {
    if (!p.org?.id || ['DUBBIO', 'SALTATA'].includes(p.esito)) { lavori.push({ p, u: perChiave.get(p.chiave) }); continue; }
    const prev = perOrg.get(p.org.id);
    if (!prev) { const w = { p: { ...p, contratti: [...p.contratti] }, u: { ...perChiave.get(p.chiave), righe: [...perChiave.get(p.chiave).righe] } }; perOrg.set(p.org.id, w); lavori.push(w); continue; }
    prev.u.righe.push(...perChiave.get(p.chiave).righe);
    prev.p.contratti.push(...p.contratti);
    if (p.esito === 'CONTRATTO') prev.p.esito = 'CONTRATTO';
  }
  const rep = { account_creati: 0, account_aggiornati: 0, legal_entity_nuove: 0, legal_entity_abbinate: 0, abbinate_contratto: 0, dubbi_saltati: 0, saltate: 0,
    contatti_creati: 0, attivita_create: 0, riconciliazioni: 0, da_confermare_ceo: 0, righe_con_alert: 0, errori: [] };
  for (const { p, u } of lavori) {
    if (p.esito === 'DUBBIO') { rep.dubbi_saltati++; continue; }
    if (p.esito === 'SALTATA') { rep.saltate++; continue; }
    try {
      const r0 = rigaPrincipale(u.righe);
      const multi = u.righe.length > 1;
      const ids = u.righe.map((r) => r.id);
      const em = parseEmailCampo(r0.email);
      // Legal entity
      let orgId = p.org?.id || null;
      if (!orgId) {
        const notes = testo([`Creata dall'import del DB Opportunità B2B Laboratorio (ID ${ids.join(', ')}).`, multi ? `Gruppo o ente gestore con ${u.righe.length} strutture: elenco nel Business Hub (sedi dell'account).` : null,
          em.nota ? `Email: ${em.nota}` : null, !multi && r0.nd.length ? `Campi "n.d." nel DB: ${r0.nd.join(', ')}.` : null]);
        // B5: createOrganization (doppioni per P.IVA, CF o nome ritrovati; nomi simili con la spunta "da rivedere")
        const { createOrganization } = await import('../../../lib/organizations.js');
        const out = await createOrganization({ kind: 'CLIENTE', name: p.nome, email: multi ? null : em.email, pec: multi ? null : em.pec, phone: multi ? null : r0.telefono, address: multi ? null : r0.indirizzo,
          city: multi ? null : r0.citta, province: multi ? null : (r0.prov && r0.prov.length <= 3 ? r0.prov : null), notes, legacy_refs: { db_opportunita: multi ? ids : ids[0] } }, { origine: 'Business Hub, import del DB Opportunità' });
        orgId = out.org.id;
        if (out.created) rep.legal_entity_nuove++;
        else { rep.legal_entity_abbinate++; await q(`UPDATE public.organizations SET legacy_refs = coalesce(legacy_refs, '{}'::jsonb) || $2::jsonb, updated_at=now() WHERE id=$1`, [orgId, JSON.stringify({ db_opportunita: multi ? ids : ids[0] })]); }
      } else {
        if (p.esito === 'CONTRATTO') rep.abbinate_contratto++; else rep.legal_entity_abbinate++;
        const cur = await one('SELECT * FROM public.organizations WHERE id=$1', [orgId]);
        const prevRef = cur.legacy_refs?.db_opportunita; const prevIds = Array.isArray(prevRef) ? prevRef : prevRef != null ? [prevRef] : [];
        const allIds = [...new Set([...prevIds.map(Number), ...ids])];
        const sets = ['legacy_refs = coalesce(legacy_refs, \'{}\'::jsonb) || $2::jsonb']; const params = [orgId, JSON.stringify({ db_opportunita: allIds.length === 1 ? allIds[0] : allIds })];
        if (!multi) for (const [k, v] of [['email', em.email], ['pec', em.pec], ['phone', r0.telefono], ['address', r0.indirizzo], ['city', r0.citta], ['province', r0.prov && r0.prov.length <= 3 ? r0.prov : null]]) {
          if (v && (cur[k] == null || cur[k] === '')) { params.push(v); sets.push(`${k}=$${params.length}`); }
        }
        await q(`UPDATE public.organizations SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params);
      }
      // Account (una Legal entity, una linea)
      const ex = await one('SELECT * FROM accounts WHERE organization_id=$1 AND linea=$2', [orgId, 'SRV']);
      const phaseFile = r0.phase_dates || {};
      const phaseDates = { ...phaseFile, ...(ex?.phase_dates || {}) };   // le date registrate nella Suite prevalgono
      const clienteAttivo = ex?.cliente_attivo || false;
      const sedi = multi ? u.righe.map(sedeDaRiga) : [];
      const raw = Object.fromEntries(u.righe.map((r) => [r.id, r.raw]));
      const testiNonNumerici = u.righe.flatMap((r) => Object.entries(r.testi).map(([k, v]) => `${k}: ${v}`));
      const prospect = !u.righe.some((r) => /cliente td attivo|contratto td in essere/i.test(r.situazione_fornitore || '') || /^s[iì]$/i.test(r.contratto_td || ''));
      const vals = {
        prospect, gruppo: u.gruppo || r0.gruppo, tipologia: r0.tipologia, segmento_lab: r0.segmento_lab, discipline: r0.discipline, accreditata_ssr: r0.accreditata_ssr,
        fatturato_struttura: multi ? null : r0.fatturato_struttura, fatturato_struttura_testo: r0.testi['Fatturato struttura (€)'] || null, anno_bilancio: r0.anno_bilancio,
        modalita_contatto: r0.modalita_contatto, fornitore_attuale: r0.fornitore_attuale, situazione_fornitore: r0.situazione_fornitore, contratto_td: r0.contratto_td,
        listino_riferimento: r0.listino_riferimento, priorita: prioritaMassima(u.righe), fonte_priorita: r0.fonte_priorita, stato_cartella: r0.stato_cartella,
        fase_corrente: faseEffettiva(phaseDates, clienteAttivo), phase_dates: JSON.stringify(phaseDates),
        prossima_azione: r0.prossima_azione, data_prossima_azione: r0.data_prossima_azione,
        sconto_medio: multi ? null : r0.sconto_medio, volume_fy_atteso: somma(u.righe, 'volume_fy_atteso'), prezzo_medio_esame: multi ? null : r0.prezzo_medio_esame,
        fatturato_fy_atteso: somma(u.righe, 'fatturato_fy_atteso'), fatturato_2026: somma(u.righe, 'fatturato_2026'), fatturato_2027: somma(u.righe, 'fatturato_2027'),
        note: testo(u.righe.map((r) => r.note && (multi ? `ID ${r.id}: ${r.note}` : r.note))) || null, fonte_censimento: [...new Set(u.righe.map((r) => r.fonte_censimento).filter(Boolean))].join(' · ') || null,
        sedi: JSON.stringify(sedi), import_key: `dbopp:${u.chiave}`, import_raw: JSON.stringify({ file: file.nome || null, righe: raw }),
      };
      let accountId;
      if (ex) {
        // aggiornamento: anagrafica commerciale e valori dal file; prossima azione e owner solo se vuoti; diario e cliente attivo intatti
        if (ex.prossima_azione) { delete vals.prossima_azione; delete vals.data_prossima_azione; }
        const cols = Object.keys(vals);
        await q(`UPDATE accounts SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [ex.id, ...cols.map((k) => vals[k])]);
        accountId = ex.id; rep.account_aggiornati++;
      } else {
        const cols = Object.keys(vals);
        accountId = (await one(`INSERT INTO accounts (organization_id, linea, created_by, ${cols.join(', ')}) VALUES ($1,'SRV',$2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`, [orgId, userId, ...cols.map((k) => vals[k])])).id;
        rep.account_creati++;
      }
      // Referenti (solo nomi: le email del DB sono della struttura, restano sulla Legal entity o sulle sedi)
      for (const r of u.righe) for (const nome of splitReferenti(r.referente)) {
        const dup = await one('SELECT 1 FROM contatti WHERE account_id=$1 AND lower(nome)=lower($2)', [accountId, nome]);
        if (dup) continue;
        await q(`INSERT INTO contatti (account_id, nome, ruolo, telefono, note, fonte) VALUES ($1,$2,$3,$4,$5,'DB_OPPORTUNITA')`,
          [accountId, nome, null, u.righe.length === 1 ? r.telefono : null, `Referente dal DB Opportunità (ID ${r.id}${multi ? `, ${r.ragione_sociale}` : ''})`]);
        rep.contatti_creati++;
      }
      // Diario: attività SISTEMA di import con ciò che non ha un campo (Stato Cartella, Cliente Pipeline, Affidabilità match, alert)
      const righeTesto = u.righe.map((r) => testo([
        multi ? `ID ${r.id} · ${r.ragione_sociale}${r.citta ? ` (${r.citta})` : ''}` : `ID ${r.id}`,
        r.stato_cartella ? `Stato Cartella: ${r.stato_cartella}` : null, r.in_pipeline ? `In Pipeline: ${r.in_pipeline}` : null,
        r.cliente_pipeline ? `Cliente Pipeline: ${r.cliente_pipeline}` : null, r.affidabilita_match ? `Affidabilità match: ${r.affidabilita_match}` : null,
        r.alert_riconciliazione ? `Alert riconciliazione: ${r.alert_riconciliazione}` : null, r.fase_attuale ? `Fase Attuale nel DB: ${r.fase_attuale}` : null,
        r.nd.length ? `Campi "n.d." (lasciati vuoti): ${r.nd.join(', ')}` : null,
      ]));
      if (await addActivity(accountId, { tipo: 'SISTEMA', oggetto: 'Import dal DB Opportunità B2B Laboratorio', testo: testo([...righeTesto, testiNonNumerici.length ? `Valori testuali non numerici: ${testiNonNumerici.join('; ')}` : null]),
        dati: { import_key: `dbopp:import:${ids.join(',')}`, righe: ids, alert: u.righe.filter((r) => r.alert_riconciliazione).map((r) => r.id) } }, userId)) rep.attivita_create++;
      rep.righe_con_alert += u.righe.filter((r) => r.alert_riconciliazione).length;
      // Cliente attivo: mai dall'import. Da confermare dal CEO
      const conf = u.righe.map(regolaImportAttivo).filter((x) => x.da_confermare);
      if (conf.length && !clienteAttivo) {
        if (await addActivity(accountId, { tipo: 'SISTEMA', oggetto: 'Cliente attivo: da confermare dal CEO', testo: [...new Set(conf.map((x) => x.motivo))].join('\n'), esito: 'DA_CONFERMARE',
          dati: { import_key: `dbopp:attivo:${ids.join(',')}`, da_confermare: true } }, userId)) rep.attivita_create++;
        rep.da_confermare_ceo++;
      }
      // Riconciliazione con i contratti esistenti (data.pipeline del 21/07/2026): differenze nel diario, il contratto non cambia
      for (const c of p.contratti) {
        if (!c.differenze.length) continue;
        const righeDiff = c.differenze.map((d) => `${d.campo}: DB ${d.db ?? '–'} · contratto ${d.contratto ?? '–'}`);
        if (await addActivity(accountId, { tipo: 'SISTEMA', oggetto: `Riconciliazione con il contratto ${c.protocol || `#${c.id}`}`, contract_id: c.id,
          testo: testo([`Differenze tra il DB Opportunità (riga ${c.riga}) e la pipeline del contratto (pacchetti del 21/07/2026). Il contratto non è stato modificato: verificare quale dato è corretto.`, ...righeDiff]),
          esito: 'DA_VERIFICARE', dati: { import_key: `dbopp:ricon:${c.id}`, differenze: c.differenze } }, userId)) { rep.attivita_create++; rep.riconciliazioni++; }
      }
    } catch (e) { rep.errori.push({ chiave: p.chiave, nome: p.nome, errore: e.message }); }
  }
  return { piano: piano.conteggi, ...rep };
}

// ---------------- Account dai contratti esistenti ----------------
// Contratti PP / SRV / MDL con controparte e senza account sulla stessa linea: account con le fasi della pipeline del contratto
// (data.pipeline dei pacchetti, se c'è) o dalle date del contratto (proposta → 4 Offerta inviata, firma → 6 Contratto firmato).
// Mai cliente attivo: un contratto ATTIVO diventa un'attività "da confermare dal CEO".
const PIPE = { 1: 'data_lead', 2: 'data_primo_contatto', 3: 'data_sopralluogo', 4: 'data_offerta_inviata', 5: 'data_in_negoziazione', 6: 'data_contratto_firmato', 7: 'data_attivo_starting' };
export function fasiDaContratto(c) {
  const p = c.data?.pipeline; const out = {};
  if (p) { for (const [n, k] of Object.entries(PIPE)) if (/^\d{4}-\d{2}-\d{2}/.test(String(p[k] || ''))) out[n] = String(p[k]).slice(0, 10); return { phase_dates: out, fonte: 'pipeline del contratto (pacchetti del 21/07/2026)' }; }
  if (['PROPOSTA', 'FIRMATO', 'AUTORIZZATO', 'ATTIVO', 'CESSATO'].includes(c.status) && c.proposal_date) out[4] = String(c.proposal_date).slice(0, 10);
  if (['FIRMATO', 'AUTORIZZATO', 'ATTIVO', 'CESSATO'].includes(c.status) && (c.signed_at || c.start_date)) out[6] = String(c.signed_at || c.start_date).slice(0, 10);
  return { phase_dates: out, fonte: 'date del contratto' };
}
export async function accountDaContratti(userId, { dryRun = false } = {}) {
  // Punti Prelievo (06/11/2026): un account per punto, cioè per Legal entity e sede del contratto (pp_site_id); le altre linee per Legal entity
  const rows = await many(`SELECT c.id, c.kind, c.org_id, c.site_id, c.status, c.protocol, c.title, c.proposal_date, c.signed_at, c.start_date, c.data, o.name AS org_name, s.kind AS site_kind
    FROM contracts c JOIN public.organizations o ON o.id=c.org_id LEFT JOIN public.sites s ON s.id=c.site_id
    WHERE c.kind IN ('PP','SRV','MDL') AND c.status NOT IN ('ANNULLATO') AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.linea=c.kind
      AND ((a.organization_id=c.org_id AND (c.kind <> 'PP' OR a.pp_site_id IS NULL OR a.pp_site_id IS NOT DISTINCT FROM c.site_id)) OR (c.kind='PP' AND c.site_id IS NOT NULL AND a.pp_site_id=c.site_id)))
    ORDER BY c.org_id, c.kind, c.created_at`);
  const perChiave = new Map();
  for (const c of rows) { const k = `${c.org_id}:${c.kind}${c.kind === 'PP' ? `:${c.site_id || 0}` : ''}`; if (!perChiave.has(k)) perChiave.set(k, []); perChiave.get(k).push(c); }
  const out = [];
  for (const list of perChiave.values()) {
    const c = list.find((x) => ['ATTIVO', 'FIRMATO', 'AUTORIZZATO'].includes(x.status)) || list[0];
    const { phase_dates: pd, fonte } = fasiDaContratto(c);
    out.push({ org_id: c.org_id, org_name: c.org_name, linea: c.kind, contratti: list.map((x) => ({ id: x.id, protocol: x.protocol, status: x.status })), fase: faseEffettiva(pd, false), fonte });
    if (dryRun) continue;
    const p = c.data?.pipeline || {};
    const ppSite = c.kind === 'PP' && c.site_kind === 'PUNTO_PRELIEVI' ? c.site_id : null;
    const ik = `contratti:${c.org_id}:${c.kind}${ppSite ? `:${ppSite}` : ''}`;
    const id = (await one(`INSERT INTO accounts (organization_id, linea, prospect, fase_corrente, phase_dates, fatturato_fy_atteso, fatturato_2026, sconto_medio, prezzo_medio_esame, volume_fy_atteso, stato_cartella, created_by, import_key, pp_site_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING RETURNING id`,
    [c.org_id, c.kind, !list.some((x) => ['ATTIVO', 'FIRMATO', 'AUTORIZZATO'].includes(x.status)), faseEffettiva(pd, false), JSON.stringify(pd),
      p.fatturato_fy_atteso_eur ?? null, p.fatturato_2026_da_starting_eur ?? null, p.sconto_medio_pct_vs_listino ?? null, p.prezzo_medio_eur ?? null, p.volume_fy_atteso_esami_anno ?? null, p.stato_cartella ?? null,
      userId, ik, ppSite]))?.id;
    if (!id) continue;
    await addActivity(id, { tipo: 'SISTEMA', oggetto: 'Account creato dai contratti esistenti', contract_id: c.id,
      testo: testo([`Contratti della Legal entity su questa linea: ${list.map((x) => `${x.protocol || `#${x.id}`} (${x.status})`).join(', ')}.`, `Fasi da: ${fonte}.`]), dati: { import_key: ik } }, userId);
    if (list.some((x) => x.status === 'ATTIVO') || pd[7]) {
      await addActivity(id, { tipo: 'SISTEMA', oggetto: 'Cliente attivo: da confermare dal CEO', esito: 'DA_CONFERMARE', contract_id: c.id,
        testo: `Il contratto ${c.protocol || `#${c.id}`} è in stato ${c.status}${pd[7] ? ` e la pipeline indica Attivo / Starting dal ${pd[7]}` : ''}: il cliente attivo lo imposta il CEO dalla scheda account.`, dati: { import_key: `contratti:attivo:${c.org_id}:${c.kind}`, da_confermare: true } }, userId);
    }
  }
  return { account: out.length, dettaglio: out, dry_run: dryRun };
}
