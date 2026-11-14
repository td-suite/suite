// Amministrazione > Pulizia allegati: ricerca per nome e per contenuto negli allegati dei moduli, eliminazione definitiva solo del titolare.
// Dati sintetici: nessun documento reale.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const SALTA = !process.env.DATABASE_URL_TEST;
const docx = async (testo) => {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<Types/>');
  z.file('word/document.xml', `<w:document><w:body><w:p><w:r><w:t>${testo}</w:t></w:r></w:p></w:body></w:document>`);
  return z.generateAsync({ type: 'nodebuffer' });
};

describe('Pulizia allegati: termini ed estrazione del testo', () => {
  test('Synlab non colpisce Synclab; confine di parola; docx letto dal suo XML', async () => {
    const P = await import('../src/lib/puliziaAllegati.js');
    const re = P.reTermini(P.normTermini(['Fanfani', 'Synlab', 'ab']));
    assert.ok(re.test('Contratto Punto Prelievi - Fanfani e Altro V.1.docx'));
    assert.ok(re.test('offerta SYNLAB 2024.pdf'));
    assert.ok(!re.test('Dati Synclab novembre.xlsx'));
    assert.deepEqual(P.normTermini(['ab', ' Fanfani ']), ['Fanfani']);
    const x = await P.estraiTestoAllegato('contratto.docx', await docx('tra Istituto Fanfani e la struttura ospitante'));
    assert.equal(x.esito, 'OK'); assert.ok(re.test(x.testo));
    assert.equal((await P.estraiTestoAllegato('foto.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00]))).esito, 'NON_ANALIZZABILE');
  });
});

describe('Pulizia allegati nella Suite (integrazione)', { skip: SALTA }, () => {
  let H, S, db, D, ids = {};
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    D = await H.datiProva(S.base);
    assert.equal((await D.o.post('/api/travaso/business/run')).s, 200);
    await D.o.get('/api/business/contracts');   // crea l'utente del modulo per il titolare
    const u = (await db.query(`SELECT id FROM business.users ORDER BY id LIMIT 1`)).rows[0]?.id;
    const org = (await db.query(`INSERT INTO organizations (kind, name) VALUES ('PARTNER','Struttura di prova pulizia') RETURNING id`)).rows[0].id;
    ids.c = (await db.query(`INSERT INTO business.contracts (kind, protocol, status, title, proposal_date, org_id, created_by) VALUES ('SRV','SRV-PUL1','ATTIVO','Punto Prelievi di prova','2026-05-01',$1,$2) RETURNING id`, [org, u || 1])).rows[0].id;
    ids.d = (await db.query(`INSERT INTO business.dossiers (contract_id, org_id, status) VALUES ($1,$2,'AUTORIZZATO') RETURNING id`, [ids.c, org])).rows[0].id;
    const file = async (nome, buf) => (await db.query(`INSERT INTO business.dossier_files (dossier_id, doc_key, source, filename, mime, size, sha256, data) VALUES ($1,'contratto_locali','UPLOAD',$2,'application/octet-stream',$3,'x',$4) RETURNING id`,
      [ids.d, nome, buf.length, buf])).rows[0].id;
    ids.nome = await file('Contratto Punto Prelievi - Fanfani e Prova V.1.docx', await docx('testo neutro'));
    ids.cont = await file('Contratto firmato.docx', await docx('subentro a Istituto Fanfani dal 2026'));
    ids.pulito = await file('Modello_5.docx', await docx('domanda al Comune, dati dal gestionale Synclab'));
    ids.img = await file('planimetria.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00]));
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  const attendi = async () => {
    for (let i = 0; i < 100; i += 1) {
      const r = await D.o.get('/api/admin/pulizia-allegati');
      assert.equal(r.s, 200, r.text);
      if (r.j.scansione && !r.j.scansione.in_corso) return r.j.scansione;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error('scansione non conclusa');
  };

  test('solo il titolare; trova per nome e per contenuto, non tocca Synclab, elenca i non leggibili; elimina con conferma', async () => {
    assert.equal((await D.cliente.get('/api/admin/pulizia-allegati')).s, 403);
    assert.equal((await D.o.post('/api/admin/pulizia-allegati/scansione', {})).s, 202);
    const s = await attendi();
    assert.equal(s.errore, null);
    const per = Object.fromEntries(s.righe.map((r) => [r.id, r]));
    assert.deepEqual(per[ids.nome].nel_nome, ['fanfani']); assert.deepEqual(per[ids.nome].nel_contenuto, []);
    assert.deepEqual(per[ids.cont].nel_nome, []); assert.deepEqual(per[ids.cont].nel_contenuto, ['fanfani']);
    assert.equal(per[ids.cont].delicato, true);
    assert.equal(per[ids.pulito], undefined, 'Synclab non è Synlab');
    assert.ok(s.non_analizzati.some((r) => r.id === ids.img));
    const voci = [{ sorgente: 'business.dossier_files', id: ids.nome }];
    assert.equal((await D.o.post('/api/admin/pulizia-allegati/elimina', { conferma: 'si', voci })).s, 400);
    const e = await D.o.post('/api/admin/pulizia-allegati/elimina', { conferma: 'ELIMINA', voci });
    assert.equal(e.s, 200, e.text); assert.equal(e.j.eliminati.length, 1);
    const rimasti = (await db.query('SELECT id FROM business.dossier_files WHERE dossier_id=$1 ORDER BY id', [ids.d])).rows.map((x) => x.id);
    assert.deepEqual(rimasti, [ids.cont, ids.pulito, ids.img]);
    const a = (await db.query(`SELECT data FROM audit_log WHERE action='PULIZIA_ALLEGATI_ELIMINATI' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.equal(a.data.eliminati[0].nome, 'Contratto Punto Prelievi - Fanfani e Prova V.1.docx');
  });
});
