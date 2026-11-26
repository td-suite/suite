// v0.98.0 · Circolari: più firmatari con i recapiti in fondo, interlinea singola senza spaziatura, colonne delle tabelle, documenti
// del SGI uniti al PDF. Funzioni pure più il flusso nella Suite (bozza, modifica, revisione). Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const xmlDi = (docx) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'circ-')); const f = path.join(d, 'c.docx'); fs.writeFileSync(f, docx); try { return execFileSync('unzip', ['-p', f, 'word/document.xml'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8'); } finally { fs.rmSync(d, { recursive: true, force: true }); } };
const pdfDi = async (n) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([300, 200]); return Buffer.from(await d.save()); };

describe('Circolari v0.98.0: impaginazione (funzioni pure)', () => {
  test('unione degli allegati del SGI: pagine in coda nell\'ordine, un allegato illeggibile non blocca', async () => {
    const { unisciAllegati } = await import('../src/modules/circolari/lib/allegatiSgi.js');
    const file = { 'stampabili/a.pdf': await pdfDi(2), 'docs/b.pdf': await pdfDi(3) };
    const u = await unisciAllegati(await pdfDi(4), [{ code: 'TD-SGI-DEX005_01', file: 'stampabili/a.pdf' }, { code: 'TD-SGI-XXX000_00', file: 'docs/manca.pdf' }, { code: 'TD-SGI-DEX018_00', file: 'docs/b.pdf' }],
      { leggi: async (f) => { if (!file[f]) throw new Error('File non disponibile'); return file[f]; } });
    assert.equal(u.pagine, 9); assert.equal((await PDFDocument.load(u.pdf)).getPageCount(), 9);
    assert.deepEqual(u.esito.map((x) => [x.code, x.ok, x.pagine ?? x.errore]), [['TD-SGI-DEX005_01', true, 2], ['TD-SGI-XXX000_00', false, 'File non disponibile'], ['TD-SGI-DEX018_00', true, 3]]);
    const nessuno = await unisciAllegati(await pdfDi(1), []); assert.deepEqual(nessuno.esito, []);
  });
  test('documento: due firmatari con i recapiti in fondo, allegati in testa, nessuna spaziatura tra i paragrafi', { skip: !process.env.DATABASE_URL_TEST }, async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_URL_TEST;
    const { renderDocx, firmatariDi } = await import('../src/modules/circolari/lib/render.js');
    const c = { stato: 'BOZZA', tipo: 'Comunicazione ai clienti', linea: 'Laboratorio di Analisi', titolo: 'Circolare di prova', destinatari: 'Clienti', oggetto: 'Prova', decorrenza: '', riferimenti: '', luogo: 'Sesto Fiorentino (FI)', data: '2026-11-25', sintesi: '',
      corpo: [{ type: 'paragrafo', text: 'Primo paragrafo di prova.' }, { type: 'paragrafo', text: 'Secondo paragrafo di prova.' }, { type: 'tabella', colonne: ['Cod.', 'Nota'], righe: [['A1', 'Internalizzazione con variazione codice e descrizione']] }],
      contatti: ['Servizio Clienti'], orientamento: 'AUTO', firma_nome: 'Vecchia Firma', firma_ruolo: 'Ruolo',
      firmatari: [{ nome: 'Prima Firmataria', ruolo: 'Chief Operating Officer', email: 'prima@esempio.test', telefono: '055 000001' }, { nome: 'Secondo Firmatario', ruolo: 'Direttore Sanitario', email: '', telefono: '' }],
      allegati_sgi: [{ code: 'TD-SGI-DEX005_01', titolo: 'Richiesta e consenso CDT', file: 'stampabili/a.pdf' }] };
    const xml = xmlDi((await renderDocx(c)).buffer);
    for (const s of ['Prima Firmataria', 'Secondo Firmatario', 'Direttore Sanitario', 'Prima Firmataria, Chief Operating Officer', 'Cell. 055 000001 – Mail: prima@esempio.test', 'Servizio Clienti', 'TD-SGI-DEX005 (Richiesta e consenso CDT)']) assert.ok(xml.includes(s), `nel documento: ${s}`);
    assert.ok(!xml.includes('Vecchia Firma'), 'con l\'elenco dei firmatari la firma singola non si usa');
    const par = xml.match(/<w:p>(?:(?!<\/w:p>).)*Primo paragrafo di prova\.(?:(?!<\/w:p>).)*<\/w:p>/s)?.[0] || '';
    assert.match(par, /w:after="0"/); assert.match(par, /w:line="240"/);
    assert.deepEqual(firmatariDi({ firmatari: [], firma_nome: 'Vecchia Firma', firma_ruolo: 'Ruolo' }), [{ nome: 'Vecchia Firma', ruolo: 'Ruolo', email: '', telefono: '' }], 'circolari precedenti: vale la firma singola');
  });
});

describe('Circolari v0.98.0: nella Suite', { skip: !process.env.DATABASE_URL_TEST }, () => {
  let H, S, O; const must = (r, cosa) => { assert.ok(r.s < 300, `${cosa}: ${r.s} ${r.text}`); return r.j; };
  before(async () => { H = await import('./helpers/suiteTest.mjs'); S = await H.avviaSuite({}); O = (await H.datiProva(S.base)).o; }, { timeout: 240000 });
  after(async () => { await S?.stop(); });
  test('firmatari e allegati del SGI: bozza, modifica, revisione, compatibilità con la firma singola', async () => {
    must(await O.post('/api/travaso/circolari/run'), 'avvio circolari');
    const corpo = [{ type: 'paragrafo', text: 'Testo.' }];
    const vecchia = must(await O.post('/api/circolari/circolari', { titolo: 'Con firma singola', firma_nome: 'Nome Vecchio', firma_ruolo: 'Ruolo vecchio', corpo }), 'bozza con firma singola');
    assert.deepEqual(vecchia.firmatari.map((f) => [f.nome, f.ruolo]), [['Nome Vecchio', 'Ruolo vecchio']]);
    const firmatari = [{ nome: 'Prima Firmataria', ruolo: 'COO', email: 'prima@esempio.test', telefono: '055 1' }, { nome: 'Secondo Firmatario', ruolo: 'Direttore Sanitario' }];
    const allegati_sgi = [{ code: 'TD-SGI-DEX005_01', titolo: 'Richiesta e consenso CDT', file: 'stampabili/TD-SGI-DEX005_01 - Richiesta.pdf' }];
    const b = must(await O.post('/api/circolari/circolari', { titolo: 'Con due firmatari', firmatari, allegati_sgi, corpo }), 'bozza');
    assert.equal(b.firmatari.length, 2); assert.equal(b.firma_nome, 'Prima Firmataria'); assert.equal(b.allegati_sgi[0].code, 'TD-SGI-DEX005_01');
    const m = must(await O.put(`/api/circolari/circolari/${b.id}`, { ...b, firmatari: [firmatari[1]], allegati_sgi: [] }), 'modifica');
    assert.deepEqual(m.firmatari.map((f) => f.nome), ['Secondo Firmatario']); assert.equal(m.firma_nome, 'Secondo Firmatario'); assert.deepEqual(m.allegati_sgi, []);
    const m2 = must(await O.put(`/api/circolari/circolari/${b.id}`, { titolo: 'Con due firmatari (titolo cambiato)' }), 'modifica del solo titolo'); assert.equal(m2.firmatari.length, 1, 'i firmatari restano');
    assert.equal((await O.post('/api/circolari/circolari', { titolo: 'Allegato non valido', allegati_sgi: [{ code: 'X', file: '../../etc/passwd' }], corpo })).s, 400);
    assert.equal((await O.post('/api/circolari/circolari', { titolo: 'Troppi firmatari', firmatari: Array(7).fill(firmatari[0]), corpo })).s, 400);
    const s = must(await O.get('/api/circolari/sgi-documenti?q=DEX'), 'ricerca nel SGI'); assert.ok(Array.isArray(s.righe) && typeof s.disponibile === 'boolean');
    must(await O.put(`/api/circolari/circolari/${b.id}`, { firmatari, allegati_sgi }), 'ripristino');
    must(await O.post(`/api/circolari/circolari/${b.id}/pubblica`), 'pubblica');
    const rev = must(await O.post(`/api/circolari/circolari/${b.id}/revisione`), 'revisione');
    assert.equal(rev.firmatari.length, 2); assert.equal(rev.allegati_sgi.length, 1, 'la revisione porta firmatari e allegati');
  });

  test('v0.99.2 · firmatari dal personale con i contatti di lavoro dell\'UTENTE (email, cellulare, sede), mai quelli della scheda del dipendente', async () => {
    const pg = (await import('pg')).default; const db = new pg.Client({ connectionString: S.url }); await db.connect();
    try {
      const uno = async (t, p) => (await db.query(t, p)).rows[0];
      const sede = await uno(`INSERT INTO public.sites (code, name, kind, address, zip, city, province) VALUES ('SED-FIR', 'Sede di prova', 'POLIAMBULATORIO', 'Via del Lavoro 1', '50019', 'Sesto Fiorentino', 'FI') RETURNING id`);
      const pers = async (cognome, nome, kind, extra = '') => (await uno(`INSERT INTO public.people (kind, status, last_name, first_name, email, phone, phone_office, job_title, address, city) VALUES ($1, 'ATTIVO', $2, $3, $4, '333 0000000', '055 999888', $5, 'Via di Casa 9', 'Firenze') RETURNING id`, [kind, cognome, nome, `${nome.toLowerCase()}.privata@posta-personale.test`, extra])).id;
      const dip = await pers('Firmataria', 'Dipendente', 'DIPENDENTE', 'Ruolo della scheda');
      const lp = await pers('Firmatario', 'Libero', 'LP', 'Direttore Sanitario');
      const senza = await pers('Senzautente', 'Persona', 'DIPENDENTE', 'Addetta');
      await pers('Esterno', 'Referente', 'ESTERNO');
      const utente = (pid, email, phone, title, site) => db.query(`INSERT INTO public.users (email, full_name, title, phone, status, auth_provider, person_id, site_id) VALUES ($1, 'x', $2, $3, 'ACTIVE', 'LOCAL', $4, $5)`, [email, title, phone, pid, site]);
      await utente(dip, 'dip.firma@azienda.test', '345 1112223', 'Chief Operating Officer', sede.id);
      await utente(lp, 'lp.firma@azienda.test', null, null, null);
      const el = must(await O.get('/api/circolari/personale-firmatari'), 'elenco');
      const d = el.find((x) => x.person_id === dip);
      assert.deepEqual([d.nome, d.ruolo, d.email, d.telefono, d.indirizzo, d.tipo, d.utente], ['Dipendente Firmataria', 'Chief Operating Officer', 'dip.firma@azienda.test', '345 1112223', 'Sede di prova, Via del Lavoro 1, 50019 Sesto Fiorentino (FI)', 'DIPENDENTE', true]);
      const l = el.find((x) => x.person_id === lp);
      assert.deepEqual([l.tipo, l.email, l.telefono, l.ruolo], ['LP', 'lp.firma@azienda.test', '', 'Direttore Sanitario'], 'anche i liberi professionisti; cellulare assente nel profilo = vuoto, non quello della scheda');
      const sz = el.find((x) => x.person_id === senza);
      assert.deepEqual([sz.utente, sz.email, sz.telefono, sz.indirizzo], [false, '', '', ''], 'senza utente: nessun contatto');
      assert.ok(!el.some((x) => x.nome === 'Referente Esterno'), 'gli esterni no');
      const tutto = JSON.stringify(el);
      for (const personale of ['333 0000000', '055 999888', 'posta-personale', 'Via di Casa']) assert.ok(!tutto.includes(personale), `mai i dati della scheda del dipendente: ${personale}`);
      const corpo = [{ type: 'paragrafo', text: 'Testo.' }];
      // basta la persona: ciò che scrive il client viene sostituito dai dati dell'utente; il nome scritto a mano si collega da solo
      const b = must(await O.post('/api/circolari/circolari', { titolo: 'Firmatari dal personale', corpo, firmatari: [{ person_id: dip, nome: 'xx', email: 'falsa@esempio.test', telefono: '333 0000000' }, { nome: 'Firmatario Libero' }] }), 'bozza');
      assert.deepEqual(b.firmatari.map((f) => [f.person_id, f.nome, f.email, f.telefono, f.indirizzo]), [[dip, 'Dipendente Firmataria', 'dip.firma@azienda.test', '345 1112223', 'Sede di prova, Via del Lavoro 1, 50019 Sesto Fiorentino (FI)'], [lp, 'Libero Firmatario', 'lp.firma@azienda.test', '', '']]);
      // il profilo utente cambia: la bozza riletta porta il contatto nuovo
      await db.query(`UPDATE public.users SET phone = '345 9998887' WHERE person_id = $1`, [lp]);
      const r = must(await O.get(`/api/circolari/circolari/${b.id}`), 'rilettura');
      assert.equal(r.firmatari[1].telefono, '345 9998887');
      // nel documento: cellulare, mail e indirizzo di lavoro
      const { renderDocx } = await import('../src/modules/circolari/lib/render.js');
      const PizZip = (await import('pizzip')).default;
      const xml = new PizZip((await renderDocx({ ...r, data: new Date() })).buffer).file('word/document.xml').asText();
      assert.ok(xml.includes('Cell. 345 1112223') && xml.includes('dip.firma@azienda.test') && xml.includes('Via del Lavoro 1'), 'contatti di lavoro in fondo alla circolare');
    } finally { await db.end(); }
  });
});
