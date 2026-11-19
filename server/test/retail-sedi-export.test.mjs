// v0.88.0 · Retail > B2C > Sedi del network: estrazione dell'elenco in Excel e in PDF, per la linguetta selezionata.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Retail: estrazione delle sedi in XLSX e PDF', { skip: SALTA }, () => {
  let H, S, O, db;
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    const D = await H.datiProva(S.base); O = D.o;
    assert.equal((await O.post('/api/travaso/retail/run')).s, 200);
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  const scarica = async (p) => { const r = await fetch(`${S.base}${p}`, { headers: { cookie: O.cookie, 'X-Requested-With': 'td-suite' } }); return { s: r.status, tipo: r.headers.get('content-type'), nome: r.headers.get('content-disposition'), buf: Buffer.from(await r.arrayBuffer()) }; };

  test('Excel: una riga per sede della linguetta, con totale; nome del file con l\'ambito', async () => {
    const elenco = (await O.get('/api/retail/sites?all=1')).j;
    const network = elenco.filter((s) => s.active && s.in_network);
    assert.ok(network.length > 0);
    const r = await scarica('/api/retail/sites/export.xlsx');
    assert.equal(r.s, 200); assert.match(r.tipo, /spreadsheetml/); assert.match(r.nome, /sedi_network_\d{4}-\d{2}-\d{2}\.xlsx/);
    const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf);
    const ws = wb.worksheets[0];
    assert.equal(ws.getRow(1).getCell(2).value, 'Sede');
    const nomi = []; ws.eachRow((row, n) => { if (n > 1) nomi.push(row.getCell(2).value); });
    assert.deepEqual(nomi.filter(Boolean).sort(), network.map((s) => s.name).sort());
    assert.equal(ws.getRow(network.length + 2).getCell(1).value, 'Totale');
    const tutte = await scarica('/api/retail/sites/export.xlsx?scope=all'); assert.equal(tutte.s, 200); assert.match(tutte.nome, /sedi_tutte_/);
    const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(tutte.buf);
    assert.equal(wb2.worksheets[0].rowCount, elenco.length + 2);
  });

  test('PDF: infografica della rete in una pagina per ogni ambito; ambito sconosciuto = network', async () => {
    for (const [scope, nome] of [['network', 'network'], ['active', 'attive'], ['all', 'tutte'], ['altro', 'network']]) {
      const r = await scarica(`/api/retail/sites/export.pdf?scope=${scope}`);
      assert.equal(r.s, 200, scope); assert.match(r.tipo, /application\/pdf/); assert.match(r.nome, new RegExp(`sedi_${nome}_`));
      assert.equal(r.buf.subarray(0, 5).toString(), '%PDF-'); assert.ok(r.buf.length > 3000);
      assert.equal((r.buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1, 'infografica in una sola pagina');
    }
    if (process.env.SALVA_PDF) (await import('node:fs')).writeFileSync(process.env.SALVA_PDF, (await scarica('/api/retail/sites/export.pdf?scope=all')).buf);
  });

  test('la scheda della sede resta raggiungibile (le rotte di estrazione non la coprono)', async () => {
    const id = (await O.get('/api/retail/sites')).j[0].id;
    assert.equal((await O.get(`/api/retail/sites/${id}`)).s, 200);
    assert.equal((await O.get('/api/retail/sites/999999')).s, 404);
  });
});
