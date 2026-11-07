// Business Hub · richieste del CEO del 07/11/2026: listino unico tra la scheda Contratto e la scheda Listino e offerta ("che sia alla
// scheda del contratto o qui l'upload del file XLSX deve essere lo stesso file") e accessi al portale per tutti i referenti ("crea gli
// accessi al portale per tutti i referenti inclusi in anagrafica"). Regole pure (pianoCollegamento, riquadroListino, pianoAccessi) e,
// con DATABASE_URL_TEST, il flusso sulla Suite vera: upload nel contratto → versione dell'account; upload nell'account → file nel
// contratto; revisione → file aggiornato; offerta → PDF nel contratto; accessi per N referenti (uno già con accesso, uno senza email).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { pianoCollegamento, riquadroListino, conListinoAccount, xlsxDaRighe } from '../src/modules/business/lib/listinoUnico.js';
import { leggiListino } from '../src/modules/business/lib/listino.js';
import { pianoAccessi, accessiPerTutti } from '../src/modules/business/lib/processo.js';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

// ---------------------------------------------------------------- listino unico: regole pure
test('listino unico: piano del collegamento di un file della versione al contratto', () => {
  const files = [
    { id: 1, category: 'LISTINO_XLSX', listino_id: null },   // storico, mai importato
    { id: 2, category: 'LISTINO_XLSX', listino_id: 10 },     // copia della v1
    { id: 3, category: 'LISTINO_PDF', listino_id: 10 },
    { id: 4, category: 'FIRMATO', listino_id: null },
  ];
  assert.deepEqual(pianoCollegamento({ files, categoria: 'LISTINO_XLSX', listinoId: 11 }), { gia: false, collega: null, inserisci: true, rimuovi: [2] }, 'nuova versione: copia nuova, tolta quella della v1, lo storico resta');
  assert.deepEqual(pianoCollegamento({ files, categoria: 'LISTINO_XLSX', listinoId: 10 }), { gia: true, collega: null, inserisci: false, rimuovi: [] }, 'idempotente');
  assert.deepEqual(pianoCollegamento({ files, categoria: 'LISTINO_XLSX', listinoId: 11, esistenteId: 1 }), { gia: false, collega: 1, inserisci: false, rimuovi: [2] }, 'importato dal contratto: si collega senza copia');
  assert.deepEqual(pianoCollegamento({ files, categoria: 'LISTINO_XLSX', listinoId: 11, esistenteId: 2 }).inserisci, true, 'un file già collegato a un\'altra versione non si ricollega');
  assert.deepEqual(pianoCollegamento({ files, categoria: 'LISTINO_PDF', listinoId: 11 }).rimuovi, [3]);
  assert.equal(conListinoAccount({ kind: 'SRV', account_id: 5 }), true);
  assert.equal(conListinoAccount({ kind: 'SRV', account_id: null }), false, 'senza account: come prima');
  assert.equal(conListinoAccount({ kind: 'MDL', account_id: 5 }), false);
  const r = riquadroListino([{ id: 10, versione: 1, riepilogo: { esami: 3 }, caricato_at: '2026-11-01' }, { id: 11, versione: 2, riepilogo: { esami: 4 }, origine: 'REVISIONE', offerta_documento_id: 7 }]);
  assert.equal(r.corrente.versione, 2); assert.equal(r.corrente.esami, 4); assert.equal(r.corrente.origine, 'REVISIONE'); assert.equal(r.prossima, 3);
  assert.equal(riquadroListino([{ id: 10, versione: 1, riepilogo: { esami: 3 } }, { id: 11, versione: 2, riepilogo: {} }], 10).corrente.versione, 1, 'scelta manuale');
  assert.deepEqual(riquadroListino([]), { corrente: null, prossima: 1, versioni: 0 });
});

test('listino unico: l\'XLSX di una revisione si rilegge con le stesse colonne', async () => {
  const righe = [{ codice: 'A1', descrizione: 'Glicemia', settore: 'Chimica', listino: 2.5, offerto: 2, sconto: 20 }, { codice: 'A2', descrizione: 'Emocromo', settore: 'Ematologia', listino: 4, offerto: 3.6, sconto: 10 }];
  const buf = await xlsxDaRighe(righe, { titolo: 'Listino v2' });
  const out = await leggiListino(buf, 'Listino_v2_revisione.xlsx');
  assert.deepEqual(out.mancanti, []);
  assert.deepEqual(out.righe.map((x) => [x.codice, x.listino, x.offerto]), [['A1', 2.5, 2], ['A2', 4, 3.6]]);
});

// ---------------------------------------------------------------- accessi al portale: regola pura
test('accessi: piano per N referenti (già con accesso, senza email, email ripetuta, da creare, solo il principale)', () => {
  const contatti = [
    { id: 1, nome: 'Maria Verdi', email: 'Maria.Verdi@lab.test', principale: true },
    { id: 2, nome: 'Luca Neri', email: 'luca.neri@lab.test' },
    { id: 3, nome: 'Senza Email', email: '' },
    { id: 4, nome: 'Doppione', email: 'luca.neri@lab.test' },
    { id: 5, nome: 'Errata', email: 'non-una-email' },
  ];
  const p = pianoAccessi({ contatti, accessi: [{ id: 99, email: 'maria.verdi@lab.test' }] });
  const by = Object.fromEntries(p.map((x) => [x.contatto_id, x]));
  assert.equal(by[1].esito, 'HA_ACCESSO'); assert.equal(by[1].user_id, 99);
  assert.equal(by[2].esito, 'DA_CREARE');
  assert.equal(by[3].esito, 'SALTATO'); assert.equal(by[3].motivo, 'senza email');
  assert.equal(by[4].esito, 'SALTATO'); assert.match(by[4].motivo, /altro referente/);
  assert.equal(by[5].esito, 'SALTATO'); assert.equal(by[5].motivo, 'email non valida');
  const solo = pianoAccessi({ contatti, accessi: [], soloPrincipale: true });
  assert.deepEqual(solo.filter((x) => x.esito === 'DA_CREARE').map((x) => x.contatto_id), [1], 'solo il principale');
  assert.equal(accessiPerTutti({}), true, 'predefinito: tutti');
  assert.equal(accessiPerTutti({ hub_accessi_portale: 'PRINCIPALE' }), false);
});

// ---------------------------------------------------------------- flusso sulla Suite vera
async function xlsx(righe) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Listino');
  ws.addRow(['Codice', 'Descrizione', 'Settore', 'Prezzo listino', 'Prezzo offerto']);
  for (const r of righe) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('flusso: listino unico tra contratto e account, accessi per tutti i referenti', { skip: SALTA, timeout: 300000 }, async () => {
  const s = await avviaSuite();
  try {
    const o = await entra(client(s.base), OWNER.email, OWNER.password, OWNER.finale);
    const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
    const up = async (p, campi) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(campi)) fd.append(k, v);
      const r = await fetch(s.base + p, { method: 'POST', body: fd, headers: { cookie: o.cookie, 'X-Requested-With': 'td-suite' } });
      const j = await r.json().catch(() => null); if (r.status >= 300) throw new Error(`${p}: ${r.status} ${JSON.stringify(j)}`); return j;
    };
    must(await o.post('/api/travaso/business/run', {}), 'avvio Business Hub');
    const acc = must(await o.post('/api/business/hub/accounts', { linea: 'SRV', nuova_org: { name: 'Laboratorio Listino Unico Prova S.r.l.', city: 'Prato', province: 'PO', email: 'info@lu.test', address: 'Via Roma 3', vat_number: '01234567892' } }), 'prospect');
    const a0 = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    const c = must(await o.post('/api/business/contracts', { kind: 'SRV', org_id: a0.organization_id, proposal_date: '2026-11-07', data: {} }), 'contratto');

    // 1) upload nel riquadro del contratto → versione v1 dell'account, file collegato nel contratto
    const r1 = await up(`/api/business/contracts/${c.id}/files`, { category: 'LISTINO_XLSX', files: new File([await xlsx([['A1', 'Glicemia', 'Chimica', 2.5, 2], ['A2', 'Emocromo', 'Ematologia', 4, 4]])], 'listino_contratto.xlsx', { type: MIME }) });
    assert.equal(r1.listino.versione, 1);
    assert.equal(r1.listino_account.corrente.versione, 1); assert.equal(r1.listino_account.prossima, 2);
    let x = r1.files.filter((f) => f.category === 'LISTINO_XLSX');
    assert.equal(x.length, 1); assert.equal(x[0].listino_versione, 1);
    let lst = must(await o.get(`/api/business/hub/accounts/${acc.id}/listini`), 'versioni');
    assert.equal(lst.versioni.length, 1); assert.equal(lst.versioni[0].filename, 'listino_contratto.xlsx');

    // 2) upload nella scheda Listino e offerta → v2, nel contratto sostituisce la copia della v1 (la v1 resta nello storico)
    const v2 = await up(`/api/business/hub/accounts/${acc.id}/listini`, { file: new File([await xlsx([['A1', 'Glicemia', 'Chimica', 2.5, 1.9], ['A2', 'Emocromo', 'Ematologia', 4, 4], ['A3', 'TSH', 'Endocrinologia', 12, 10]])], 'listino_account.xlsx', { type: MIME }) });
    assert.equal(v2.versione, 2); assert.equal(v2.contratto_id, c.id);
    let cc = must(await o.get(`/api/business/contracts/${c.id}`), 'contratto');
    x = cc.files.filter((f) => f.category === 'LISTINO_XLSX');
    assert.deepEqual(x.map((f) => [f.filename, f.listino_versione]), [['listino_account.xlsx', 2]]);
    assert.equal(cc.listino_account.corrente.versione, 2);
    lst = must(await o.get(`/api/business/hub/accounts/${acc.id}/listini`), 'versioni');
    assert.equal(lst.versioni.length, 2, 'la v1 resta nello storico dell\'account');

    // 3) offerta economica della v2 → LISTINO_PDF del contratto
    const off = must(await o.post(`/api/business/hub/listini/${v2.id}/offerta`, {}), 'offerta v2');
    cc = must(await o.get(`/api/business/contracts/${c.id}`), 'contratto');
    assert.deepEqual(cc.files.filter((f) => f.category === 'LISTINO_PDF').map((f) => [f.filename, f.listino_versione]), [[off.filename, 2]]);

    // 4) revisione dei prezzi → v3: XLSX ricostruito nel contratto al posto di quello della v2
    const righe = must(await o.get(`/api/business/hub/listini/${v2.id}`), 'righe').righe;
    const rv = must(await o.post(`/api/business/hub/accounts/${acc.id}/listini/${v2.id}/revisione`, { righe: [{ chiave: righe.find((r) => r.codice === 'A3').chiave, offerto: 9 }], motivo: 'prezzo concordato (prova)' }), 'revisione');
    assert.equal(rv.versione, 3);
    cc = must(await o.get(`/api/business/contracts/${c.id}`), 'contratto');
    assert.deepEqual(cc.files.filter((f) => f.category === 'LISTINO_XLSX').map((f) => [f.filename, f.listino_versione]), [['Listino_v3_revisione.xlsx', 3]]);
    assert.equal(cc.files.filter((f) => f.category === 'LISTINO_PDF').length, 1, 'il PDF della v2 resta finché non si genera l\'offerta della v3');
    const off3 = must(await o.post(`/api/business/hub/listini/${rv.id}/offerta`, {}), 'offerta v3');
    cc = must(await o.get(`/api/business/contracts/${c.id}`), 'contratto');
    assert.deepEqual(cc.files.filter((f) => f.category === 'LISTINO_PDF').map((f) => [f.filename, f.listino_versione]), [[off3.filename, 3]]);
    assert.ok(cc.events.some((e) => /dall'account/.test(e.note || '')), 'cronologia del contratto');

    // 5) accessi al portale per N referenti: uno già con accesso, uno senza email (saltato con il motivo), due da creare
    const ref = async (b) => must(await o.post(`/api/business/hub/accounts/${acc.id}/contatti`, b), `referente ${b.nome}`);
    await ref({ nome: 'Maria Verdi', ruolo: 'Direttrice', email: 'maria.verdi@lu.test', principale: true });
    await ref({ nome: 'Luca Neri', ruolo: 'Accettazione', email: 'luca.neri@lu.test' });
    await ref({ nome: 'Anna Blu', ruolo: 'Amministrazione', email: 'anna.blu@lu.test' });
    await ref({ nome: 'Paolo Senzamail', ruolo: 'Biologo' });
    must(await o.post(`/api/business/hub/accounts/${acc.id}/accesso`, {}), 'accesso del principale');
    let p = must(await o.get(`/api/business/hub/accounts/${acc.id}/accessi`), 'piano');
    assert.equal(p.impostazione, 'TUTTI');
    assert.deepEqual(p.righe.map((r) => r.esito).sort(), ['DA_CREARE', 'DA_CREARE', 'HA_ACCESSO', 'SALTATO']);
    const t = must(await o.post(`/api/business/hub/accounts/${acc.id}/accessi`, { tutti: true }), 'accessi per tutti');
    assert.equal(t.creati, 2);
    const by = Object.fromEntries(t.righe.map((r) => [r.nome, r]));
    assert.equal(by['Maria Verdi'].esito, 'HA_ACCESSO'); assert.equal(by['Luca Neri'].esito, 'CREATO'); assert.equal(by['Anna Blu'].esito, 'CREATO');
    assert.equal(by['Paolo Senzamail'].esito, 'SALTATO'); assert.equal(by['Paolo Senzamail'].motivo, 'senza email');
    assert.ok(!JSON.stringify(t.righe).includes('password_provvisoria'), 'nessuna password nelle righe');
    // idempotente
    const t2 = must(await o.post(`/api/business/hub/accounts/${acc.id}/accessi`, { tutti: true }), 'di nuovo');
    assert.equal(t2.creati, 0);
    const a = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    const inviti = a.attivita.filter((y) => y.sottotipo === 'INVITO_SUITE');
    assert.equal(inviti.length, 3, 'un invito a ciascuno, nessun doppione');
    assert.ok(inviti.every((y) => !y.email_cc), 'inviti senza copie');
    assert.ok(a.attivita.some((y) => y.tipo === 'ACCESSO' && /2 creati/.test(y.oggetto)), 'riepilogo nel diario');
    p = must(await o.get(`/api/business/hub/accounts/${acc.id}/accessi`), 'piano');
    assert.equal(p.righe.filter((r) => r.esito === 'HA_ACCESSO').length, 3);
  } finally { await s.stop(); }
});
