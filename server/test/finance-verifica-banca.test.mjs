// v0.98.0 · Scadenziario strutture: verifica dei pagamenti sul conto corrente. Abbinamento (funzione pura) e flusso nella Suite con
// movimenti bancari inseriti nel database di prova. Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;
describe('Scadenziario: abbinamento dei pagamenti (funzioni pure)', { skip: SALTA }, () => {
  let V;
  before(async () => { process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_URL_TEST; V = await import('../src/modules/finance/lib/verificaBanca.js'); });
  test('parole del nome e movimento che nomina il beneficiario o il codice dell\'utenza', () => {
    assert.deepEqual(V.paroleNome('E.ON Energia S.p.A.'), ['eon', 'energia']); assert.deepEqual(V.paroleNome('TECNOLIBRI DISTRIBUZIONE s.r.l.'), ['tecnolibri']);
    assert.equal(V.nomina({ controparte: 'E.ON ENERGIA SPA', causale: 'SDD' }, { nomi: ['E.ON Energia S.p.A.'] }), true);
    assert.equal(V.nomina({ controparte: 'LEONE ENERGIA', causale: '' }, { nomi: ['E.ON Energia S.p.A.'] }), false, '"eon" dentro "leone" non vale');
    assert.equal(V.nomina({ controparte: null, causale: 'Addebito SDD fattura 123 PDR 05250000188983' }, { nomi: ['Altro Fornitore'], codice: '05250000188983' }), true);
    assert.equal(V.nomina({ controparte: 'Bonifico a favore di terzi', causale: 'saldo' }, { nomi: ['Tecnolibri Distribuzione srl'] }), false);
  });
  test('certo se nomina il beneficiario, probabile se è l\'unico dello stesso importo, mai due scadenze sullo stesso movimento', () => {
    const scad = [
      { key: 'canone:lease:1:2026-10-15', date: '2026-10-15', amount: 7300, nomi: ['Tecnolibri Distribuzione s.r.l.'] },
      { key: 'canone:lease:1:2026-11-15', date: '2026-11-15', amount: 7300, nomi: ['Tecnolibri Distribuzione s.r.l.'] },
      { key: 'bolletta:utility:2:2026-11-05', date: '2026-11-05', amount: 2524, nomi: ['E.ON Energia S.p.A.'], codice: '05250000188983' },
      { key: 'bolletta:utility:2:2026-10-05', date: '2026-10-05', amount: 1594, nomi: ['E.ON Energia S.p.A.'] },
      { key: 'bolletta:utility:3:2026-11-10', date: '2026-11-10', amount: 99.9, nomi: ['Acque Toscane'] },
    ];
    const mov = [
      { id: 1, booking_date: '2026-10-16', importo: -7300, controparte: 'TECNOLIBRI DISTRIBUZIONE SRL', causale: 'Canone ottobre' },
      { id: 2, booking_date: '2026-11-20', importo: -2524, controparte: 'Fornitore gas', causale: 'SDD PDR 05250000188983' },
      { id: 3, booking_date: '2026-10-20', importo: -1594, controparte: 'Pagamento generico', causale: 'F24' },
      { id: 4, booking_date: '2026-11-11', importo: 99.9, controparte: 'ACQUE TOSCANE', causale: 'rimborso' },          // entrata: non conta
      { id: 5, booking_date: '2026-06-01', importo: -7300, controparte: 'TECNOLIBRI DISTRIBUZIONE SRL', causale: 'vecchio' }, // fuori finestra
    ];
    const a = V.abbinaPagamenti(scad, mov);
    assert.deepEqual([...a].map(([k, v]) => [k, v.livello, v.mov.id]), [['canone:lease:1:2026-10-15', 'CERTO', 1], ['bolletta:utility:2:2026-11-05', 'CERTO', 2], ['bolletta:utility:2:2026-10-05', 'PROBABILE', 3]]);
    assert.equal(V.abbinaPagamenti(scad, mov, new Set([1])).has('canone:lease:1:2026-10-15'), false, 'movimento già agganciato a un\'altra scadenza');
    assert.equal(V.abbinaPagamenti([{ key: 'k', date: '2026-10-15', amount: 7299.99, nomi: ['Tecnolibri'] }], mov).size, 0, 'importo diverso di un centesimo: nessun abbinamento');
  });
});

describe('Scadenziario: verifica sul conto nella Suite', { skip: SALTA }, () => {
  let H, S, db, O, D, lf = null; const must = (r, cosa) => { assert.ok(r.s < 300, `${cosa}: ${r.s} ${r.text}`); return r.j; };
  before(async () => { H = await import('./helpers/suiteTest.mjs'); const pg = (await import('pg')).default; S = await H.avviaSuite({}); db = new pg.Client({ connectionString: S.url }); await db.connect(); D = await H.datiProva(S.base); O = D.o; }, { timeout: 240000 });
  after(async () => { if (lf) await db?.query(`DROP DATABASE IF EXISTS ${lf} WITH (FORCE)`).catch(() => {}); await db?.end().catch(() => {}); await S?.stop(); });
  test('canone pagato trovato sul conto: segnato da solo; uscita senza nome: proposta da confermare', async () => {
    // Finance Management si avvia con il travaso: sorgente = un database vuoto di prova, poi LIVE (come anagrafica-blocco3)
    const pg = (await import('pg')).default; lf = `${S.url.match(/\/([^/?]+)(\?|$)/)[1]}_lf`;
    const adm = new pg.Client({ connectionString: S.url }); await adm.connect(); await adm.query(`CREATE DATABASE ${lf}`); await adm.end();
    must(await O.put('/api/legacy/sources/finance/credential', { database_url: S.url.replace(/\/([^/?]+)(\?|$)/, `/${lf}$2`) + (S.url.includes('?') ? '&' : '?') + 'sslmode=disable' }), 'sorgente');
    must(await O.post('/api/travaso/finance/run', {}), 'travaso finance'); must(await O.post('/api/travaso/finance/live', {}), 'finance LIVE');
    const oggi = new Date(); const g = (n) => new Date(oggi.getTime() + n * 86400000).toISOString().slice(0, 10);
    const loc = must(await O.post('/api/organizations', { name: 'Immobiliare Verifica Srl', kind: 'FORNITORE', vat_number: '05555555551' }), 'locatore').id;
    const l = must(await O.post('/api/finance/scadenziario/leases', { site_id: D.site.hq, landlord_org_id: loc, kind: 'COMMERCIALE_6_6', start_date: g(-70), first_due: g(-40), first_term_years: 6, renewal_years: 6, period_months: 1, amount: 1234.56 }), 'contratto');
    const mov = (data, importo, controparte, causale) => db.query(`INSERT INTO bank_transactions (iban, chiave, booking_date, importo, controparte, causale) VALUES ('IT00TEST', $1, $2, $3, $4, $5) RETURNING id`, [`k${Math.random()}`, data, importo, controparte, causale]).then((r) => Number(r.rows[0].id));
    await mov(g(-39), -1234.56, 'IMMOBILIARE VERIFICA SRL', 'Canone di locazione');
    const anonimo = await mov(g(-8), -1234.56, 'Bonifico', 'pagamento');
    const ev = must(await O.get('/api/finance/scadenziario/events'), 'agenda');
    assert.equal(ev.banca.verificate, 1);
    const canoni = ev.events.filter((e) => e.kind === 'canone' && e.ref === l.id && e.days <= 0).sort((a, b) => a.date.localeCompare(b.date));
    assert.equal(canoni[0].done, true); assert.equal(canoni[0].done_source, 'BANCA'); assert.match(canoni[0].done_note, /Pagamento trovato sul conto .*IMMOBILIARE VERIFICA SRL/);
    assert.equal(canoni[1].done, false); assert.equal(canoni[1].bank.id, anonimo, 'il secondo canone ha una proposta dal conto');
    assert.equal(must(await O.get('/api/finance/scadenziario/events'), 'agenda bis').banca.verificate, 0, 'nessuna doppia registrazione');
    must(await O.post('/api/finance/scadenziario/events/done', { key: canoni[1].key, bank_tx_id: anonimo }), 'conferma dal conto');
    const dopo = must(await O.get('/api/finance/scadenziario/events'), 'agenda dopo').events.find((e) => e.key === canoni[1].key);
    assert.equal(dopo.done, true); assert.equal(dopo.done_source, 'BANCA_CONFERMATA');
    assert.equal((await O.post('/api/finance/scadenziario/events/done', { key: canoni[0].key, bank_tx_id: anonimo })).s, 400, 'un movimento chiude una sola scadenza');
  });
});
