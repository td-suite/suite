// Programma "anagrafica unica", blocco 3 (08/11/2026). Parte pura (sempre): orari dal testo del connettore, conferma del titolo da
// Payments, campi della fusione, royalties dal contratto PP, punto service dalla sede, referenti, fascicoli. Parte d'integrazione (con
// DATABASE_URL_TEST, la Suite vera su un database temporaneo, helpers/suiteTest.mjs): B5 createOrganization, B5b fusione, B11 connettore,
// B13 royalties in Cash, B15 ponte B2B di Retail, B17 quadro d'impatto, B18 Payments su sede ospitata, B19 unicità StudioLAB, B1 data
// di avvio, B3/B4 orari e superfici, B9 Laboratorio, C13 sede della persona, Diagnostica D24/D36 attivi.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { orariDaTesto, hoursText } from '../src/lib/sites.js';
import { titoloDaContratto } from '../src/lib/leaseSync.js';
import { campiFusi } from '../src/lib/fusioneOrg.js';
import { royaltyDaVoci, differenzeRoyalty } from '../src/lib/royaltyPP.js';
import { datiDaSedeService } from '../src/modules/business/lib/mod230.js';
import { sceltaPersona } from '../src/modules/business/lib/referenti.js';
import { orariFascicolo, personaleFascicolo } from '../src/modules/business/lib/dossier.js';
import { orariRoomDaCore } from '../src/modules/room/lib/strutture.js';
import { SITE_KINDS, SEDI_OPERATIVE } from '../src/lib/tipiSede.js';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

describe('anagrafica unica, blocco 3 (funzioni pure)', () => {
  test('B11: testo degli orari → orari strutturati, ritorno identico; testo non interpretabile → null', () => {
    const j = orariDaTesto('Lun-Ven 7:30-12:30, 15:00-18:00; Sab 7:30-11:00');
    assert.deepEqual(j.mon, [{ from: '07:30', to: '12:30' }, { from: '15:00', to: '18:00' }]);
    assert.deepEqual(j.sat, [{ from: '07:30', to: '11:00' }]);
    assert.equal(j.sun, undefined);
    assert.equal(hoursText(j), 'Lun-Ven 7:30-12:30, 15:00-18:00; Sab 7:30-11:00');
    assert.deepEqual(orariDaTesto('lunedì, mercoledì 8.00-12'), { mon: [{ from: '08:00', to: '12:00' }], wed: [{ from: '08:00', to: '12:00' }] });
    assert.equal(orariDaTesto('su appuntamento'), null);
    assert.equal(orariDaTesto('Lun 12:00-08:00'), null);
    assert.equal(orariDaTesto(''), null);
  });
  test('B18: un contratto di Payments non cambia senza conferma il titolo di una sede ospitata, di proprietà o in comodato', () => {
    assert.deepEqual(titoloDaContratto('OSPITATA', 'COMMERCIALE_6_6'), { tenure: 'LOCAZIONE', conferma: true });
    assert.deepEqual(titoloDaContratto('PROPRIETA', null), { tenure: 'LOCAZIONE', conferma: true });
    assert.deepEqual(titoloDaContratto('LOCAZIONE', 'COMMERCIALE_9_9'), { tenure: 'LOCAZIONE', conferma: false });
    assert.deepEqual(titoloDaContratto('LOCAZIONE', 'COMODATO'), { tenure: 'COMODATO', conferma: false });
    assert.deepEqual(titoloDaContratto('COMODATO', 'COMMERCIALE_6_6'), { tenure: 'LOCAZIONE', conferma: true });
  });
  test('B5b: fusione dei campi, vince la riga che resta, i vuoti si completano, note e riferimenti si uniscono', () => {
    const r = campiFusi({ id: 1, name: 'A', vat_number: '0123', pec: '', iban: null, notes: 'n1', legacy_refs: { a: 1 }, active: true },
      { id: 2, name: 'A bis', vat_number: '9999', pec: 'a@pec.it', iban: 'IT60X0542811101000000123456', notes: 'n2', legacy_refs: { b: 2 }, active: true });
    assert.deepEqual(r.presi.sort(), ['iban', 'pec']);
    assert.equal(r.set.vat_number, undefined);
    assert.match(r.set.notes, /n1\nDalla Legal entity unita #2 A bis: n2/);
    assert.deepEqual(r.set.legacy_refs, { b: 2, a: 1 });
  });
  test('B13: voci del contratto PP → royalties di Cash; differenze solo sui campi economici', () => {
    const p = royaltyDaVoci([{ kind: 'PERCENT', percent: 10, base: 'PUNTO_PRELIEVI', vat: 'PIU_IVA' }, { kind: 'FIXED', amount: 900, period: 'TRIMESTRE', vat: 'PIU_IVA' },
      { kind: 'MINIMUM', amount: 500, period: 'MESE' }, { kind: 'FIXED', amount: 1000, period: 'UNA_TANTUM' }], { protocollo: 'PP-1' });
    assert.equal(p.royalty_pct, 10); assert.equal(p.royalty_fixed_monthly, 300); assert.equal(p.royalty_vat_rate, 22); assert.equal(p.royalty_base, 'TOTALE');
    assert.match(p.royalty_notes, /Dal contratto PP PP-1/); assert.match(p.royalty_notes, /minimo garantito/); assert.match(p.royalty_notes, /una tantum/);
    assert.deepEqual(differenzeRoyalty(p, { royalty_fixed_monthly: '300.00', royalty_pct: 10, royalty_base: 'TOTALE', royalty_vat_rate: 22 }), []);
    assert.deepEqual(differenzeRoyalty(p, { royalty_fixed_monthly: 0, royalty_pct: 10, royalty_base: 'TOTALE', royalty_vat_rate: 22 }).map((d) => d.campo), ['royalty_fixed_monthly']);
    assert.equal(royaltyDaVoci([]).royalty_pct, 0);
  });
  test('B14: punto service e ritiro dalla sede SERVICE (i campi compilati del ritiro restano)', () => {
    const sede = { name: 'Clinica Uno', address: 'Via Uno 1', zip: '50100', city: 'Firenze', province: 'FI', phone: '055 1', email: 'c@u.it', opening_hours_json: { mon: [{ from: '08:00', to: '10:00' }], wed: [{ from: '09:00', to: '11:00' }] } };
    const d = datiDaSedeService({ site_name: 'Vecchio nome', pickup: { contact: 'Rossi', days: [] } }, sede);
    assert.equal(d.site_name, 'Clinica Uno'); assert.equal(d.site_address, 'Via Uno 1, 50100 Firenze (FI)');
    assert.equal(d.pickup.contact, 'Rossi'); assert.equal(d.pickup.site, 'Clinica Uno'); assert.equal(d.pickup.phone, '055 1');
    assert.deepEqual(d.pickup.days.map((x) => x.mode), ['FISSO', 'NO', 'FISSO', 'NO', 'NO', 'NO']);
    assert.equal(datiDaSedeService({ site_name: 'X' }, null).site_name, 'X');
  });
  test('B7: referente → persona con la stessa email solo della stessa Legal entity', () => {
    assert.deepEqual(sceltaPersona([{ id: 5, organization_id: 9 }], 9), { person_id: 5 });
    assert.deepEqual(sceltaPersona([{ id: 5, organization_id: null }], 9), { person_id: 5 });
    assert.match(sceltaPersona([{ id: 5, organization_id: 3 }], 9).motivo, /altra Legal entity/);
    assert.match(sceltaPersona([], 9).motivo, /nessuna persona/);
  });
  test('C2: orari e personale del fascicolo dall\'anagrafica; B3: orari di Room dal core', () => {
    const h = orariFascicolo({ mon: [{ from: '07:00', to: '10:30' }], sat: [{ from: '08:00', to: '09:00' }] });
    assert.equal(h[0].draw, 'dalle ore 7:00 alle ore 10:30'); assert.equal(h[1].draw, ''); assert.equal(h[1].pickup, '');
    assert.equal(orariFascicolo(null), null);
    assert.deepEqual(personaleFascicolo([{ last_name: 'Rossi', first_name: 'Ada', kind: 'LP', job_title: null, is_head: true }])[0], { surname: 'Rossi', name: 'Ada', affiliation: 'Toscana Diagnostica', contract: 'Libero professionista', hours: '', role: 'Responsabile di sede', degree: '' });
    const r = orariRoomDaCore({ mon: [{ from: '15:00', to: '18:00' }, { from: '07:30', to: '12:30' }] });
    assert.deepEqual([r[0].open, r[0].close, r[0].closed, r[1].closed], ['07:30', '18:00', false, true]);
    assert.equal(orariRoomDaCore({}), null);
  });
  test('C7: costante unica dei tipi di struttura', () => {
    assert.equal(SITE_KINDS.length, 8);
    assert.ok(SEDI_OPERATIVE.every((k) => SITE_KINDS.includes(k)) && !SEDI_OPERATIVE.includes('SERVICE'));
  });
});

describe('anagrafica unica, blocco 3 (integrazione)', { skip: SALTA }, () => {
  let S, o, db, lf; const id = {};
  const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
  const diag = async (k) => (await o.get(`/api/admin/diagnostica/${k}`)).j;
  const riga = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  before(async () => {
    S = await avviaSuite();
    o = await entra(client(S.base), OWNER.email, OWNER.password, OWNER.finale);
    for (const k of ['business', 'cash', 'retail', 'room', 'facility', 'contracts']) must(await o.post(`/api/travaso/${k}/run`, {}), `avvio ${k}`);
    // Payments si avvia con il travaso: sorgente = un database vuoto di prova (nessun dato copiato), poi LIVE
    lf = `${S.url.match(/\/([^/?]+)(\?|$)/)[1]}_lf`;
    const adm = new pg.Client({ connectionString: S.url }); await adm.connect(); await adm.query(`CREATE DATABASE ${lf}`); await adm.end();
    const lfUrl = S.url.replace(/\/([^/?]+)(\?|$)/, `/${lf}$2`) + (S.url.includes('?') ? '&' : '?') + 'sslmode=disable';
    must(await o.put('/api/legacy/sources/finance/credential', { database_url: lfUrl }), 'sorgente Payments');
    must(await o.post('/api/travaso/finance/run', {}), 'travaso Payments');
    must(await o.post('/api/travaso/finance/live', {}), 'Payments LIVE');
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    must(await o.get('/api/business/state'), 'utente business');
    id.td = must(await o.post('/api/organizations', { name: 'Toscana Diagnostica S.r.l.', kind: 'SOCIETA', code: 'TD', vat_number: '07528130482' }), 'td').id;
    id.p1 = must(await o.post('/api/organizations', { name: 'Partner Royalty Srl', kind: 'PARTNER', code: 'PR1', vat_number: '03333333333' }), 'partner').id;
    must(await o.post('/api/admin/diagnostica/D22a/correggi', { ids: [], conferma: 'CORREGGI' }), 'Legal entity di TD (A9)');
  }, { timeout: 240000 });
  after(async () => {
    await db?.end().catch(() => {}); await S?.stop();
    if (lf) { const adm = new pg.Client({ connectionString: process.env.DATABASE_URL_TEST }); await adm.connect(); await adm.query(`DROP DATABASE IF EXISTS ${lf} WITH (FORCE)`).catch(() => {}); await adm.end(); }
  });

  test('B5: createOrganization ritrova i doppioni (P.IVA) e segna "da rivedere" i nomi simili', async () => {
    const a = must(await o.post('/api/organizations', { name: 'Laboratorio Doppio Srl', kind: 'CLIENTE', vat_number: '01234567890' }), 'prima');
    const dup = await o.post('/api/organizations', { name: 'Altro nome', kind: 'CLIENTE', vat_number: 'IT 01234567890' });
    assert.equal(dup.s, 409); assert.equal(dup.j.code, 'DUPLICATO'); assert.equal(dup.j.esistente.id, a.id);
    const b = must(await o.post('/api/organizations', { name: 'Laboratorio Doppio S.r.l.', kind: 'CLIENTE', vat_number: '01234567890', forza_duplicato: true }), 'forzata');
    assert.equal(b.needs_review, true);
    assert.equal((await o.post('/api/organizations', { name: 'Laboratorio Doppio S.r.l.', kind: 'CLIENTE' })).s, 409, 'stesso nome (forma societaria a parte) = doppione');
    const c = must(await o.post('/api/organizations', { name: 'Laboratorio Doppio Sud Srl', kind: 'CLIENTE' }), 'simile');
    assert.ok(c.simili.length > 0 && c.needs_review === true);
    const audit = await riga(`SELECT data FROM audit_log WHERE action='ORG_CREATED' AND entity_id=$1`, [String(c.id)]);
    assert.equal(audit.data.origine, 'Amministrazione > Legal entity');
    id.dupA = a.id; id.dupB = b.id; id.dupC = c.id;
    assert.equal((await diag('D16a')).stato, 'ATTENZIONE');
  });

  test('B5b: fusione con anteprima, conflitti bloccanti, riferimenti spostati in ogni schema, D16a verde', async () => {
    // riferimenti sulla riga da unire: account Service, sede SERVICE, persona; un account SRV anche sulla riga che resta = conflitto
    const accB = must(await o.post('/api/business/hub/accounts', { linea: 'SRV', organization_id: id.dupB }), 'account B').id;
    const sB = must(await o.post('/api/sites', { code: 'SRV-DUP', name: 'Punto Doppio', kind: 'SERVICE', organization_id: id.dupB }), 'sede B').id;
    const pB = must(await o.post('/api/people', { kind: 'ESTERNO', status: 'ATTIVO', last_name: 'Referente', first_name: 'Doppio', organization_id: id.dupB }), 'persona B').id;
    const accA = must(await o.post('/api/business/hub/accounts', { linea: 'SRV', organization_id: id.dupA }), 'account A').id;
    let pr = must(await o.post('/api/organizations/fusione/anteprima', { tieni: id.dupA, assorbi: id.dupB }), 'anteprima');
    assert.ok(pr.conflitti.some((x) => x.tabella === 'business.accounts'), 'due account sulla stessa linea = conflitto');
    assert.equal((await o.post('/api/organizations/fusione', { tieni: id.dupA, assorbi: id.dupB, conferma: 'UNISCI' })).s, 409);
    assert.ok(await riga('SELECT 1 FROM organizations WHERE id=$1', [id.dupB]), 'la prova e il conflitto non toccano nulla');
    // risolto il conflitto (l'account della riga che resta si elimina nel Business Hub), la fusione passa
    await db.query('DELETE FROM business.accounts WHERE id=$1', [accA]);
    pr = must(await o.post('/api/organizations/fusione/anteprima', { tieni: id.dupA, assorbi: id.dupB }), 'anteprima 2');
    assert.equal(pr.conflitti.length, 0);
    for (const t of ['business.accounts', 'public.sites', 'public.people']) assert.ok(pr.riferimenti.some((x) => x.tabella === t), `riferimento ${t} nell'anteprima`);
    assert.equal((await o.post('/api/organizations/fusione', { tieni: id.dupA, assorbi: id.dupB, conferma: 'NO' })).s, 400);
    const fx = must(await o.post('/api/organizations/fusione', { tieni: id.dupA, assorbi: id.dupB, conferma: 'UNISCI' }), 'fusione');
    assert.equal(fx.eseguita, true);
    assert.equal(await riga('SELECT 1 FROM organizations WHERE id=$1', [id.dupB]), undefined);
    assert.equal((await riga('SELECT organization_id FROM business.accounts WHERE id=$1', [accB])).organization_id, id.dupA);
    assert.equal((await riga('SELECT organization_id FROM sites WHERE id=$1', [sB])).organization_id, id.dupA);
    assert.equal((await riga('SELECT organization_id FROM people WHERE id=$1', [pB])).organization_id, id.dupA);
    assert.equal((await riga('SELECT count(*)::int AS n FROM org_merges WHERE kept_id=$1 AND merged_id=$2', [id.dupA, id.dupB])).n, 1);
    assert.ok(await riga(`SELECT 1 FROM audit_log WHERE action='ORG_MERGED' AND entity_id=$1`, [String(id.dupA)]));
    assert.equal((await diag('D16a')).stato, 'OK');
  });

  test('B11: connettore con codice sede rinominato nella Suite → nessun doppione; nome cambiato nella Suite non sovrascritto; orari JSON', async () => {
    const k = must(await o.post('/api/api-keys', { name: 'Prova connettore', source: 'studiolab', scopes: ['ingest:sites'] }), 'chiave').key;
    const invia = async (rows) => {
      const r = await fetch(`${S.base}/api/ingest/sites`, { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_uid: `b3-${crypto.randomUUID()}`, rows }) });
      const j = await r.json(); if (r.status >= 300) throw new Error(`ingest ${r.status} ${JSON.stringify(j)}`); return j;
    };
    await invia([{ code: 'CON-1', name: 'Sede del Connettore', kind: 'PUNTO_PRELIEVI', city: 'Prato', opening_hours: 'Lun-Ven 7:30-10:30', manager_name: 'Testo Ignorato' }]);
    const s = await riga(`SELECT * FROM sites WHERE code='CON-1'`);
    assert.deepEqual(s.opening_hours_json.mon, [{ from: '07:30', to: '10:30' }]);
    assert.equal(s.manager_name, null, 'il connettore non scrive più il responsabile (B2)');
    must(await o.put(`/api/sites/${s.id}`, { code: 'CON-1-SUITE', name: 'Nome deciso nella Suite' }), 'rinomina');
    const out = await invia([{ code: 'CON-1', name: 'Nome della fonte', opening_hours: 'su appuntamento' }]);
    assert.equal(out.rows_ok, 1);
    assert.equal((await riga(`SELECT count(*)::int AS n FROM sites WHERE code IN ('CON-1','CON-1-SUITE')`)).n, 1, 'nessun doppione');
    const s2 = await riga('SELECT * FROM sites WHERE id=$1', [s.id]);
    assert.equal(s2.code, 'CON-1-SUITE'); assert.equal(s2.name, 'Nome deciso nella Suite');
    assert.deepEqual(s2.opening_hours_json.mon, [{ from: '07:30', to: '10:30' }], 'testo non interpretabile: restano gli orari strutturati');
  });

  test('B19: lo stesso codice StudioLAB su due sedi è rifiutato; l\'indice di unicità è attivo', async () => {
    must(await o.post('/api/sites', { code: 'SL-1', name: 'Sede Codice Uno', kind: 'PUNTO_PRELIEVI', studiolab_code: 'ABC123' }), 'prima');
    const r = await o.post('/api/sites', { code: 'SL-2', name: 'Sede Codice Due', kind: 'PUNTO_PRELIEVI', studiolab_code: 'abc123' });
    assert.equal(r.s, 400); assert.match(r.j.error, /un codice, una sede/);
    assert.ok(await riga(`SELECT to_regclass('public.sites_studiolab_code_uq') AS i`).then((x) => x.i));
  });

  test('B13: firma del PP → proposta delle royalties in Cash; conferma; royalties diverse in Cash solo con "sovrascrivi"', async () => {
    const s = must(await o.post('/api/sites', { code: 'RY-PP', name: 'Punto Royalty', kind: 'PUNTO_PRELIEVI' }), 'sede');
    id.ryPP = s.id;
    const c = must(await o.post('/api/business/contracts', { kind: 'PP', org_id: id.p1, site_id: s.id, proposal_date: '2026-11-08',
      data: { fee: { items: [{ kind: 'PERCENT', percent: 12, base: 'PUNTO_PRELIEVI', vat: 'PIU_IVA' }, { kind: 'FIXED', amount: 250, period: 'MESE', vat: 'PIU_IVA' }] } } }), 'contratto PP');
    const firma = must(await o.post(`/api/business/contracts/${c.id}/status`, { status: 'FIRMATO' }), 'firma');
    assert.equal(firma.sede.esito, 'IMPOSTATA'); assert.equal(firma.sede.royalty.stato, 'NUOVA');
    assert.ok(await riga(`SELECT 1 FROM business.contract_events WHERE contract_id=$1 AND kind='ROYALTY_PROPOSTA'`, [c.id]), 'proposta annotata negli eventi');
    assert.equal(await riga('SELECT 1 FROM cash.site_ext WHERE site_id=$1', [s.id]), undefined, 'nessuna scrittura senza conferma');
    const pp = must(await o.get('/api/business/hub/punti-prelievo'), 'elenco');
    assert.equal(pp.punti.length >= 0, true);
    const pr = must(await o.get(`/api/business/hub/punti-prelievo/${s.id}/royalty`), 'proposta');
    assert.equal(pr.stato, 'NUOVA'); assert.equal(pr.proposta.royalty_pct, 12); assert.equal(pr.proposta.royalty_fixed_monthly, 250);
    must(await o.post(`/api/business/hub/punti-prelievo/${s.id}/royalty`, {}), 'conferma');
    const e = await riga('SELECT royalty_pct, royalty_fixed_monthly, royalty_vat_rate, company_id FROM cash.site_ext WHERE site_id=$1', [s.id]);
    assert.deepEqual([Number(e.royalty_pct), Number(e.royalty_fixed_monthly), Number(e.royalty_vat_rate), e.company_id], [12, 250, 22, id.td]);
    // in Cash si cambia la percentuale: la proposta torna "diversa" e non si sovrascrive senza conferma
    await db.query('UPDATE cash.site_ext SET royalty_pct=8 WHERE site_id=$1', [s.id]);
    const cashProp = must(await o.get(`/api/cash/sites/${s.id}/royalty-proposta`), 'proposta da Cash');
    assert.equal(cashProp.stato, 'DIVERSA');
    const no = await o.post(`/api/cash/sites/${s.id}/royalty-proposta`, {});
    assert.equal(no.s, 409); assert.equal(no.j.code, 'ROYALTY_DIVERSE');
    must(await o.post(`/api/cash/sites/${s.id}/royalty-proposta`, { sovrascrivi: true }), 'sovrascrittura');
    assert.equal(Number((await riga('SELECT royalty_pct FROM cash.site_ext WHERE site_id=$1', [s.id])).royalty_pct), 12);
    assert.ok(await riga(`SELECT 1 FROM audit_log WHERE action='ROYALTY_DA_CONTRATTO_PP' AND entity_id=$1`, [String(s.id)]));
  });

  test('B18: contratto di Payments su sede ospitata → conferma richiesta, anagrafica intatta; con la conferma LOCAZIONE senza ospitante', async () => {
    const loc = must(await o.post('/api/organizations', { name: 'Immobiliare Prova Srl', kind: 'FORNITORE', vat_number: '04444444444' }), 'locatore').id;
    const l = must(await o.post('/api/finance/scadenziario/leases', { site_id: id.ryPP, landlord_org_id: loc, kind: 'COMMERCIALE_6_6', start_date: '2026-01-01', first_term_years: 6, renewal_years: 6, period_months: 1, amount: 1200 }), 'contratto Payments');
    assert.equal(l.registry_sync_result.status, 'conferma');
    let s = await riga('SELECT tenure, host_organization_id FROM sites WHERE id=$1', [id.ryPP]);
    assert.deepEqual([s.tenure, s.host_organization_id], ['OSPITATA', id.p1]);
    const r = must(await o.post(`/api/finance/scadenziario/leases/${l.id}/allinea-anagrafica`, { conferma_titolo: true }), 'conferma');
    assert.equal(r.registry_sync_result.status, 'ok');
    s = await riga('SELECT tenure, host_organization_id, rent_amount FROM sites WHERE id=$1', [id.ryPP]);
    assert.deepEqual([s.tenure, s.host_organization_id, Number(s.rent_amount)], ['LOCAZIONE', null, 1200]);
    const a = await riga(`SELECT data FROM audit_log WHERE action='SITE_UPDATED' AND entity_id=$1 ORDER BY id DESC LIMIT 1`, [String(id.ryPP)]);
    assert.match(a.data.origine, /titolo confermato/);
  });

  test('B17: quadro d\'impatto prima della chiusura; alla disattivazione closed_at di oggi', async () => {
    const s = must(await o.post('/api/sites', { code: 'CH-1', name: 'Sede da Chiudere', kind: 'PUNTO_PRELIEVI' }), 'sede');
    must(await o.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Chiusura', first_name: 'Prova', site_id: s.id }), 'persona');
    const imp = must(await o.get(`/api/sites/${s.id}/impatto-chiusura`), 'impatto');
    assert.equal(imp.persone_attive, 1); assert.ok(imp.voci.some((v) => /persone attive/.test(v)));
    const x = must(await o.put(`/api/sites/${s.id}`, { active: false }), 'chiusura');
    assert.ok(x.impatto.voci.length >= 1);
    assert.ok((await riga('SELECT closed_at FROM sites WHERE id=$1', [s.id])).closed_at);
  });

  test('B15: vendite StudioLAB con codice noto e ignoto → B2B abbinato in automatico e "da abbinare"; abbinamento manuale; D21a', async () => {
    const cli = must(await o.post('/api/organizations', { name: 'Clinica Ponte Srl', kind: 'CLIENTE', vat_number: '05555555555' }), 'cliente').id;
    must(await o.post('/api/sites', { code: 'SRV-PONTE', name: 'Clinica Ponte', kind: 'SERVICE', organization_id: cli, studiolab_code: 'SER0777' }), 'sede SERVICE');
    const csv = 'numerorichiesta;dataaccettazione;codicecliente;nomecliente;codiceanalisi;prezzonetto\nA1;2026-11-02;SER0777;Clinica Ponte (file);GLU;10\nA2;2026-11-02;SER0999;Struttura Sconosciuta;GLU;12\n';
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'vendite.csv'); fd.append('source', 'STUDIOLAB'); fd.append('dataset', 'SALES');
    const r = await fetch(`${S.base}/api/retail/sales/import/run`, { method: 'POST', headers: { 'X-Requested-With': 'td-suite', cookie: o.cookie }, body: fd });
    const out = await r.json(); assert.equal(r.status, 200, JSON.stringify(out)); assert.equal(out.rows_ok, 2, JSON.stringify(out.errors));
    assert.deepEqual(out.b2b, { abbinati: ['SER0777'], da_abbinare: ['SER0999'] });
    const noto = await riga(`SELECT organization_id, abbinamento FROM retail.customers WHERE external_code='SER0777'`);
    assert.deepEqual([noto.organization_id, noto.abbinamento], [cli, 'AUTO']);
    const ignoto = await riga(`SELECT id, organization_id, abbinamento FROM retail.customers WHERE external_code='SER0999'`);
    assert.deepEqual([ignoto.organization_id, ignoto.abbinamento], [null, 'DA_ABBINARE']);
    const q = must(await o.get('/api/retail/customers/b2b'), 'pagina B2B');
    assert.ok(q.da_abbinare.some((x) => x.external_code === 'SER0999'));
    assert.equal((await diag('D21a')).n, 1);
    // anagrafica del B2B dalla Legal entity; Retail modifica solo i suoi campi
    const det = must(await o.get(`/api/retail/customers/${(await riga(`SELECT id FROM retail.customers WHERE external_code='SER0777'`)).id}`), 'scheda');
    assert.equal(det.company_name, 'Clinica Ponte Srl');
    must(await o.put(`/api/retail/customers/${ignoto.id}/abbina`, { organization_id: cli }), 'abbinamento manuale');
    assert.equal((await riga('SELECT abbinamento FROM retail.customers WHERE id=$1', [ignoto.id])).abbinamento, 'MANUALE');
    assert.equal((await diag('D21a')).stato, 'OK');
  });

  test('B3/B4: orari di apertura dal core in Room, Retail e Facility; superficie e box di Facility letti da Retail', async () => {
    const s = must(await o.post('/api/sites', { code: 'OR-1', name: 'Sede Orari', kind: 'CENTRO_DIAGNOSTICO', opening_hours_json: { mon: [{ from: '07:30', to: '12:30' }, { from: '15:00', to: '19:00' }], sat: [{ from: '08:00', to: '12:00' }] } }), 'sede');
    const room = must(await o.get(`/api/room/strutture/${s.id}`), 'Room');
    assert.equal(room.struttura._orariDaSede, true);
    assert.deepEqual([room.struttura.hours[0].open, room.struttura.hours[0].close, room.struttura.hours[1].closed], ['07:30', '19:00', true]);
    const retail = must(await o.get(`/api/retail/structure/sites/${s.id}/structure`), 'Retail');
    assert.deepEqual([retail.hours[0].open1, retail.hours[0].close2], ['07:30', '19:00']);
    must(await o.get(`/api/facility/immobili/${s.id}`), 'Facility immobile');
    must(await o.put(`/api/facility/immobili/${s.id}`, { surface_sqm: 180, boxes: 4 }), 'Facility dati');
    const imm = must(await o.get(`/api/facility/immobili/${s.id}`), 'Facility immobile 2');
    assert.equal(Number(imm.registry.ore_apertura_anagrafica), 13); assert.equal(imm.registry.giorni_apertura_anagrafica, 2);
    const rs = must(await o.get(`/api/retail/sites/${s.id}`), 'Retail sede');
    assert.deepEqual([Number(rs.surface_sqm), rs.boxes, rs.struttura_da_facility], [180, 4, true]);
    // Room non conserva più la copia degli orari della sede
    must(await o.put(`/api/room/strutture/${s.id}`, { data: { ...room.struttura, logo: undefined, plan: { markers: {} } }, version: room.version }), 'salvataggio Room');
    assert.equal((await riga('SELECT data ? \'hours\' AS h FROM room.site_ext WHERE site_id=$1', [s.id])).h, false);
  });

  test('B1: data di avvio del punto = apertura della sede; D24 attivo e verde', async () => {
    const s = must(await o.post('/api/sites', { code: 'AV-1', name: 'Punto Avvio', kind: 'PUNTO_PRELIEVI' }), 'sede');
    const a = must(await o.post('/api/business/hub/accounts', { linea: 'PP', organization_id: id.td, pp_site_id: s.id }), 'account PP').id;
    must(await o.put(`/api/business/hub/accounts/${a}/punto`, { data_avvio_effettiva: '2026-12-01' }), 'data di avvio');
    assert.equal((await riga(`SELECT to_char(opened_at,'YYYY-MM-DD') AS d FROM sites WHERE id=$1`, [s.id])).d, '2026-12-01');
    const d24 = await diag('D24');
    assert.notEqual(d24.stato, 'DOPO'); assert.equal(d24.stato, 'OK');
  });

  test('C13: la sede della persona è quella del contratto di lavoro; D36 attivo', async () => {
    const lab = must(await o.post('/api/sites', { code: 'LAB-B3', name: 'Laboratorio Prova B3', kind: 'LABORATORIO', address: 'Via del Lab 1', zip: '50019', city: 'Sesto Fiorentino', province: 'FI' }), 'laboratorio').id;
    const p = must(await o.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Contratto', first_name: 'Sede' }), 'persona').id;
    await db.query(`INSERT INTO contracts.employments (resource_id, work_site_id, start_date) VALUES ($1,$2,'2026-01-01')`, [p, lab]);
    assert.equal((await diag('D36')).stato, 'INFO');
    must(await o.post('/api/admin/diagnostica/D36/correggi', { ids: [p], conferma: 'CORREGGI' }), 'correzione D36');
    assert.equal((await riga('SELECT site_id FROM people WHERE id=$1', [p])).site_id, lab);
    const r = await o.put(`/api/people/${p}`, { site_id: id.ryPP });
    assert.equal(r.s, 400); assert.match(r.j.error, /contratto di lavoro/);
    // B9: indirizzo del Laboratorio dalla sede LABORATORIO
    const st = must(await o.get('/api/business/settings'), 'impostazioni Business');
    assert.equal(st.settings.lab_address, 'Sesto Fiorentino (FI), Via del Lab 1');
    assert.ok(st.coreKeys.includes('lab_address'));
  });

  test('Diagnostica: nessun controllo resta "attivo dopo" il blocco 3; D25 applica la decisione 8', async () => {
    const tutti = must(await o.get('/api/admin/diagnostica'), 'diagnostica');
    assert.deepEqual(tutti.risultati.filter((k) => k.stato === 'DOPO').map((k) => k.id), []);
    assert.deepEqual(tutti.risultati.filter((k) => k.correggi_dopo).map((k) => k.id), []);
    assert.deepEqual(tutti.risultati.filter((k) => k.stato === 'ERRORE').map((k) => `${k.id}: ${k.nota}`), []);
    // locatore creato come PARTNER (prima di B5) → la correzione D25 lo fa FORNITORE
    const l = must(await o.post('/api/organizations', { name: 'Locatore Vecchio Srl', kind: 'PARTNER', vat_number: '06666666666', notes: 'Creata dallo Scadenziario strutture' }), 'locatore vecchio').id;
    must(await o.put(`/api/sites/${id.ryPP}`, { lease_landlord_org_id: l }), 'locatore della sede');
    assert.equal((await diag('D25')).stato, 'ATTENZIONE');
    must(await o.post('/api/admin/diagnostica/D25/correggi', { ids: [], conferma: 'CORREGGI' }), 'D25');
    assert.equal((await riga('SELECT kind FROM organizations WHERE id=$1', [l])).kind, 'FORNITORE');
  });
});
