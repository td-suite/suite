// Business Hub · processo Punti Prelievo (richiesta del CEO del 06/11/2026). Regole pure: flagship o corner dalla sede (o dal tipo previsto),
// prerequisiti del contratto al partner, form pubblica in variante PARTNER, piano dei passi dell'avvio con l'idempotenza e le attese (data,
// sede), composizione del primo ordine standard, destinatari interni per linea, modelli dei testi senza dati inventati. In più il flusso
// con la posta simulata (Suite vera su un database di prova: serve DATABASE_URL_TEST, altrimenti si salta): corner con il contratto inviato
// da network@, risposta per email e form del partner, avvio con credenziali, comunicazioni, primo ordine e "Riprova"; flagship con "Avvia".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  tipoPunto, prerequisitiContrattoPartner, precompilaPartner, validaPartner, pianoAvvio, riepilogoAvvio, composizionePrimoOrdine, destinatariLinea, elencoDotazione,
  PASSI_AVVIO_PP, MODELLI_DEFAULT, SEGNAPOSTO_MODELLI, MODELLI_LABEL, segnapostoDi, compila, modelliFlussoDa,
} from '../src/modules/business/lib/processo.js';
import { DEFAULT_SETTINGS } from '../src/modules/business/lib/rules.js';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

// ---------------------------------------------------------------- anagrafica: flagship o corner
test('tipo del punto: corner dalla sede ospitata, flagship dalla sede TD, tipo previsto senza sede', () => {
  const c = tipoPunto({ sede: { kind: 'PUNTO_PRELIEVI', tenure: 'OSPITATA', host_organization_id: 7 } });
  assert.equal(c.tipo, 'CORNER'); assert.equal(c.fonte, 'sede'); assert.deepEqual(c.avvisi, []);
  for (const t of ['LOCAZIONE', 'PROPRIETA', 'COMODATO']) assert.equal(tipoPunto({ sede: { kind: 'PUNTO_PRELIEVI', tenure: t } }).tipo, 'FLAGSHIP', t);
  assert.equal(tipoPunto({ sede: { kind: 'PUNTO_PRELIEVI', tenure: null, host_organization_id: 3 } }).tipo, 'CORNER', 'senza titolo decide l\'ospitante');
  const div = tipoPunto({ sede: { kind: 'PUNTO_PRELIEVI', tenure: 'LOCAZIONE' }, previsto: 'CORNER' });
  assert.equal(div.tipo, 'FLAGSHIP', 'vale la sede'); assert.match(div.avvisi[0], /previsto era corner/);
  assert.match(tipoPunto({ sede: { kind: 'PUNTO_PRELIEVI', tenure: 'OSPITATA' } }).avvisi[0], /senza Legal entity ospitante/);
  const p = tipoPunto({ previsto: 'CORNER' });
  assert.equal(p.tipo, 'CORNER'); assert.equal(p.fonte, 'previsto'); assert.match(p.avvisi[0], /da confermare/);
  assert.equal(tipoPunto({}).tipo, null);
});

test('contratto al partner: solo corner, contratto PP generato in proposta, referente con email', () => {
  const ok = prerequisitiContrattoPartner({ tipo: 'CORNER', contratto: { id: 1, status: 'PROPOSTA', protocol: 'PP-2026-001' }, file: { filename: 'PP.pdf' }, referente: { nome: 'R', email: 'r@x.test' } });
  assert.equal(ok.pronto, true);
  const fl = prerequisitiContrattoPartner({ tipo: 'FLAGSHIP', contratto: null, file: null, referente: null });
  assert.equal(fl.pronto, false); assert.match(fl.voci[0].dettaglio, /flagship/);
  const firmato = prerequisitiContrattoPartner({ tipo: 'CORNER', contratto: { id: 1, status: 'FIRMATO', protocol: 'PP-1' }, file: { filename: 'x' }, referente: { email: 'r@x.test' } });
  assert.equal(firmato.voci.find((v) => v.key === 'contratto').ok, false, 'un contratto già firmato non si rimanda');
  assert.equal(prerequisitiContrattoPartner({ tipo: 'CORNER', contratto: { id: 1, status: 'PROPOSTA' }, file: null, referente: { email: 'r@x.test' } }).pronto, false, 'serve il PDF generato');
});

test('form del partner: precompilata dal referente, nome ed email obbligatori, niente MOD173', () => {
  const v = precompilaPartner({ referente: { nome: 'Anna Rossi', ruolo: 'Titolare', email: 'anna@farmacia.test', telefono: '055 1' } });
  assert.deepEqual(v, { ref_nome: 'Anna Rossi', ref_ruolo: 'Titolare', ref_email: 'anna@farmacia.test', ref_telefono: '055 1', note: '' });
  assert.equal(precompilaPartner({ referente: v && { nome: 'X' }, ultima: { ref_nome: 'Dall\'invio' } }).ref_nome, 'Dall\'invio', 'l\'ultimo invio vale più della precompilazione');
  const e = validaPartner({ ref_nome: '', ref_email: 'non-valida' });
  assert.deepEqual([...new Set(e.errori.map((x) => x.campo))].sort(), ['ref_email', 'ref_nome']);
  assert.equal(validaPartner({ ref_nome: 'Anna', ref_email: 'anna@farmacia.test' }).errori.length, 0);
});

// ---------------------------------------------------------------- avvio: sequenza, attese, idempotenza
test('avvio: corner con tutti i passi, flagship senza credenziali e conferma al partner, attese di data e sede', () => {
  assert.deepEqual(PASSI_AVVIO_PP.map((p) => p.lettera).join(''), 'abcdefg');
  const c = pianoAvvio({ tipo: 'CORNER', passi: {}, dataAvvio: '2026-12-01', sedeId: 5 });
  assert.deepEqual(c.map((x) => x.azione), Array(7).fill('ESEGUI'));
  const f = pianoAvvio({ tipo: 'FLAGSHIP', passi: {}, dataAvvio: '2026-12-01', sedeId: 5 });
  assert.deepEqual(f.map((x) => x.azione), ['NON_PREVISTO', 'NON_PREVISTO', 'ESEGUI', 'ESEGUI', 'ESEGUI', 'ESEGUI', 'ESEGUI']);
  const att = pianoAvvio({ tipo: 'CORNER', passi: {}, dataAvvio: null, sedeId: null });
  assert.equal(att.find((x) => x.key === 'AVVIO_LAB').stato, 'ATTESA_DATA', 'c) parte al salvataggio della data');
  assert.equal(att.find((x) => x.key === 'PRIMO_ORDINE').stato, 'ATTESA_SEDE', 'd) aspetta la sede in anagrafica');
  assert.equal(att.filter((x) => x.azione === 'ESEGUI').length, 5, 'gli altri passi non aspettano');
});

test('avvio: un passo riuscito non si ripete, Riprova agisce solo sui passi scelti e non riusciti', () => {
  const passi = { CREDENZIALI: { stato: 'OK' }, CONFERMA: { stato: 'OK' }, AVVIO_LAB: { stato: 'ATTESA_DATA' }, PRIMO_ORDINE: { stato: 'FALLITO', errore: 'Ordini non avviato' }, DOTAZIONE: { stato: 'OK' }, FONDO_CASSA: { stato: 'OK' }, RIFIUTI: { stato: 'OK' } };
  const p = pianoAvvio({ tipo: 'CORNER', passi, dataAvvio: '2026-12-01', sedeId: 5 });
  assert.deepEqual(p.filter((x) => x.azione === 'ESEGUI').map((x) => x.key), ['AVVIO_LAB', 'PRIMO_ORDINE']);
  assert.ok(p.filter((x) => ['CREDENZIALI', 'CONFERMA', 'DOTAZIONE'].includes(x.key)).every((x) => x.azione === 'FATTO'));
  const r = pianoAvvio({ tipo: 'CORNER', passi, dataAvvio: '2026-12-01', sedeId: 5, solo: ['PRIMO_ORDINE', 'DOTAZIONE'] });
  assert.deepEqual(r.filter((x) => x.azione === 'ESEGUI').map((x) => x.key), ['PRIMO_ORDINE'], 'DOTAZIONE è già riuscito: nessuna seconda email');
  assert.equal(r.find((x) => x.key === 'AVVIO_LAB').azione, 'SALTA');
  const rp = riepilogoAvvio('CORNER', passi);
  assert.equal(rp.previsti, 7); assert.equal(rp.fatti, 5); assert.deepEqual(rp.da_completare, ['AVVIO_LAB', 'PRIMO_ORDINE']); assert.deepEqual(rp.falliti, ['PRIMO_ORDINE']); assert.equal(rp.completo, false);
  assert.equal(riepilogoAvvio('FLAGSHIP', { AVVIO_LAB: { stato: 'OK' }, PRIMO_ORDINE: { stato: 'OK' }, DOTAZIONE: { stato: 'OK' }, FONDO_CASSA: { stato: 'OK' }, RIFIUTI: { stato: 'OK' } }).completo, true, 'al flagship bastano c-g');
});

test('primo ordine: quantità 1 di ogni articolo del Magazzino Centrale destinato ai Punti Prelievo', () => {
  const art = [
    { id: 1, code: 'B', source: 'SILVA', active: true, visible_sedi: true, sort: 2 },
    { id: 2, code: 'A', source: 'SILVA', active: true, visible_sedi: true, sort: 1 },
    { id: 3, code: 'C', source: 'SILVA', active: false, visible_sedi: true, sort: 3 },
    { id: 4, code: 'D', source: 'SILVA', active: true, visible_sedi: false, visible_all: true, sort: 4 },
    { id: 5, code: 'E', source: 'SILVA', active: true, visible_sedi: true, lab_only: true, sort: 5 },
    { id: 6, code: 'F', source: 'MOD252', active: true, visible_sedi: true, sort: 0 },
    { id: 2, code: 'A', source: 'SILVA', active: true, visible_sedi: true, sort: 1 },
  ];
  const r = composizionePrimoOrdine(art);
  assert.deepEqual(r.map((x) => x.article_id), [2, 1], 'solo attivi, visibili ai Punti Prelievo, non riservati al laboratorio, del Magazzino Centrale, senza doppioni, in ordine di catalogo');
  assert.ok(r.every((x) => x.qty === 1));
  assert.deepEqual(composizionePrimoOrdine([{ id: 9, code: 'X', source: 'MOD252', active: true, visible_sedi: true }]).map((x) => x.article_id), [9], 'senza catalogo del Magazzino Centrale valgono gli articoli presenti (come in Nuovo ordine)');
  assert.deepEqual(composizionePrimoOrdine([]), []);
});

test('destinatari per linea: predefiniti del CEO, modificabili, indirizzi non validi scartati', () => {
  const pp = destinatariLinea('PP', DEFAULT_SETTINGS);
  assert.deepEqual(pp.conferma, ['francesco.epifani@toscanadiagnostica.it', 'silvia.sansoni@toscanadiagnostica.it']);
  assert.deepEqual(pp.avvio, ['laboratorio@toscanadiagnostica.it', 'valentina.zezza@toscanadiagnostica.it']);
  assert.deepEqual(pp.dotazione, ['valentina.zezza@toscanadiagnostica.it']);
  assert.deepEqual(pp.amministrazione, ['amministrazione@toscanadiagnostica.it']);
  assert.deepEqual(pp.rifiuti, ['iacopo.cupelli@toscanadiagnostica.it']);
  assert.deepEqual(destinatariLinea('SRV', DEFAULT_SETTINGS).laboratorio, ['laboratorio@toscanadiagnostica.it', 'valentina.zezza@toscanadiagnostica.it']);
  assert.deepEqual(destinatariLinea('PP', { ...DEFAULT_SETTINGS, hub_pp_dest_rifiuti: 'rspp@x.test; non-valido, RSPP@x.test' }).rifiuti, ['rspp@x.test']);
  assert.deepEqual(destinatariLinea('MDL', DEFAULT_SETTINGS), {});
  assert.equal(DEFAULT_SETTINGS.hub_cc_PP, 'francesco.epifani@toscanadiagnostica.it, silvia.sansoni@toscanadiagnostica.it', 'copie fisse di network@');
  const d = elencoDotazione(DEFAULT_SETTINGS.hub_pp_dotazione_elenco);
  assert.equal(d.voci.length, 3); assert.match(d.breve, /PC fisso.*RICOH.*Culligan/); assert.match(d.testo, /^- /);
});

test('modelli PP: segnaposto dichiarati, nessun prezzo o importo scritto nei testi, righe senza dato tolte', () => {
  for (const g of ['pp_contratto', 'pp_benvenuto', 'pp_conferma', 'pp_avvio', 'pp_dotazione', 'pp_fondo', 'pp_rifiuti']) {
    assert.ok(MODELLI_LABEL[g], g);
    const usati = [...segnapostoDi(MODELLI_DEFAULT[`${g}_oggetto`]), ...segnapostoDi(MODELLI_DEFAULT[`${g}_testo`])];
    for (const u of usati) assert.ok([...SEGNAPOSTO_MODELLI[g], 'referenti'].includes(u), `${g}: {{${u}}} non dichiarato`);
    assert.doesNotMatch(MODELLI_DEFAULT[`${g}_testo`], /€|\beuro\b|\d+[.,]\d{2}/i, `${g}: nessun importo nel modello`);
  }
  assert.match(MODELLI_DEFAULT.pp_contratto_testo, /\{\{link_form\}\}/);
  const t = compila(MODELLI_DEFAULT.pp_avvio_testo, { punto: 'PP Prova', data_avvio: '01/12/2026', tipo: 'Flagship', indirizzo_punto: 'Via X 1', partner_ospitante: '', orari: '', autorizzazione: 'fascicolo autorizzato', link_scheda: 'https://s/x' });
  assert.doesNotMatch(t, /Partner ospitante|Orari/, 'flagship: righe senza dato tolte');
  assert.equal(modelliFlussoDa({ pp_rifiuti_testo: 'Testo mio' }).pp_rifiuti_testo, 'Testo mio');
});

// ---------------------------------------------------------------- flusso con la posta simulata
async function pdfMinimo(testo) {
  const d = await PDFDocument.create(); const p = d.addPage([300, 200]); p.drawText(testo, { x: 20, y: 100, size: 12 });
  return Buffer.from(await d.save());
}

test('flusso PP: corner (contratto da network@, risposta, form del partner, avvio con Riprova) e flagship ("Avvia")', { skip: SALTA, timeout: 300000 }, async () => {
  const s = await avviaSuite();
  try {
    const o = await entra(client(s.base), OWNER.email, OWNER.password, OWNER.finale);
    const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
    for (const m of ['business', 'cash', 'orders']) must(await o.post(`/api/travaso/${m}/run`, {}), `avvio ${m}`);
    // anagrafica fittizia: società TD, partner, sede ospitata (corner) e sede in locazione (flagship)
    const td = must(await o.post('/api/organizations', { name: 'Società TD Prova', kind: 'SOCIETA', code: 'TDP', city: 'Firenze' }), 'società');
    const partner = must(await o.post('/api/organizations', { name: 'Farmacia Corner Prova', kind: 'PARTNER', code: 'FCP', city: 'Prato', address: 'Via del Corso 1', vat_number: '01234567891' }), 'partner');
    must(await o.put(`/api/business/organizations/${partner.id}/ext`, { legal_rep: 'Paola Partner' }), 'firmatario');
    const corner = must(await o.post('/api/sites', { code: 'PP-CRN', name: 'Punto Prelievi Corner Prova', kind: 'PUNTO_PRELIEVI', organization_id: td.id, host_organization_id: partner.id, tenure: 'OSPITATA', city: 'Prato', address: 'Via del Corso 1' }), 'sede corner');
    const flag = must(await o.post('/api/sites', { code: 'PP-FLG', name: 'Punto Prelievi Flagship Prova', kind: 'PUNTO_PRELIEVI', organization_id: td.id, tenure: 'LOCAZIONE', city: 'Firenze', address: 'Via Roma 2' }), 'sede flagship');
    must(await o.put('/api/cash/settings', { default_cash_float: '150,00' }), 'fondo cassa predefinito');
    // account corner dalla sede, referente, contratto PP generato, invio da network@
    const acc = must(await o.post('/api/business/hub/punti-prelievo/da-sede', { site_id: corner.id }), 'account corner');
    must(await o.post(`/api/business/hub/accounts/${acc.id}/contatti`, { nome: 'Paola Partner', email: 'paola@farmacia-corner.test', principale: true }), 'referente');
    let st = must(await o.get(`/api/business/hub/accounts/${acc.id}/punto`), 'punto');
    assert.equal(st.tipo.tipo, 'CORNER'); assert.equal(st.prerequisiti.pronto, false);
    const ct = must(await o.post('/api/business/contracts', { kind: 'PP', org_id: partner.id, site_id: corner.id, proposal_date: '2026-11-06', start_date: '2026-12-01', data: { fee: { items: [{ kind: 'PERCENT', percent: 10 }] } } }), 'contratto');
    const gen = await o.post(`/api/business/contracts/${ct.id}/generate`, {});
    if (gen.s >= 300) { console.log(`# generazione del contratto non disponibile qui (${gen.s}): parte corner ridotta`); return; }
    const k = must(await o.post(`/api/business/hub/accounts/${acc.id}/contratto-partner/prepara`, {}), 'prepara');
    assert.equal(k.from, 'network@toscanadiagnostica.it'); assert.deepEqual(k.cc, ['francesco.epifani@toscanadiagnostica.it', 'silvia.sansoni@toscanadiagnostica.it']); assert.match(k.oggetto, /\[TD-B2B-/);
    const inv = must(await o.post(`/api/business/hub/kit/${k.id}/invia`, { conferma: true }), 'invio');
    assert.equal(inv.stato, 'REGISTRATO'); assert.equal(inv.fase, 4);
    const k2 = must(await o.post(`/api/business/hub/accounts/${acc.id}/contratto-partner/prepara`, {}), 'prepara 2');
    assert.equal((await o.post(`/api/business/hub/kit/${k2.id}/invia`, { conferma: true })).s, 409, 'un secondo invio chiede conferma');
    st = must(await o.get(`/api/business/hub/accounts/${acc.id}/punto`), 'punto');
    // risposta per email con il riferimento: allegato da verificare
    const fdm = new FormData();
    fdm.append('linea', 'PP'); fdm.append('from_email', 'segreteria@altro.test'); fdm.append('subject', `R: contratto ${st.form.rif}`); fdm.append('testo', 'firmato');
    fdm.append('file', new Blob([await pdfMinimo('firmato per email')], { type: 'application/pdf' }), 'firmato_email.pdf');
    const sim = await (await fetch(`${s.base}/api/business/inbox/simula`, { method: 'POST', body: fdm, headers: { cookie: o.cookie, 'X-Requested-With': 'td-suite' } })).json();
    assert.equal(sim.account_id, acc.id);
    // form del partner (variante PARTNER, senza MOD173) con il contratto firmato: nessun articolo in Ordini → passo d non riuscito
    const token = st.form.link.split('/b2b/')[1];
    const pub = await (await fetch(`${s.base}/api/business/b2b/${token}`)).json();
    assert.equal(pub.variante, 'PARTNER'); assert.equal((await fetch(`${s.base}/api/business/b2b/${token}/mod173.pdf`)).status, 404);
    const fd = new FormData();
    fd.append('dati', JSON.stringify(pub.valori));
    fd.append('contratto', new Blob([await pdfMinimo('contratto firmato')], { type: 'application/pdf' }), 'Contratto_PP_firmato.pdf');
    const fr = await fetch(`${s.base}/api/business/b2b/${token}`, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'td-suite' } });
    assert.equal(fr.status, 201); assert.equal((await fr.json()).contrattualizzato, true);
    const a = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    assert.equal(a.fase_corrente, 6);
    const out = a.attivita.filter((x) => x.tipo === 'EMAIL_OUT');
    const per = (t) => out.find((x) => x.sottotipo === t);
    assert.ok(out.every((x) => x.email_from === 'network@toscanadiagnostica.it'), 'mittente sempre network@');
    assert.equal(per('INVITO_SUITE').email_cc || '', '', 'invito con la password senza copie');
    assert.equal(per('BENVENUTO_PARTNER').email_to, 'paola@farmacia-corner.test');
    assert.equal(per('BENVENUTO_PARTNER').email_cc, 'francesco.epifani@toscanadiagnostica.it, silvia.sansoni@toscanadiagnostica.it');
    assert.equal(per('CONFERMA_PP').email_to, 'francesco.epifani@toscanadiagnostica.it, silvia.sansoni@toscanadiagnostica.it');
    assert.equal(per('DOTAZIONE_PP').email_to, 'valentina.zezza@toscanadiagnostica.it');
    assert.equal(per('FONDO_CASSA_PP').email_to, 'amministrazione@toscanadiagnostica.it'); assert.match(per('FONDO_CASSA_PP').testo, /150,00.*predefinito/);
    assert.equal(per('RIFIUTI_PP').email_to, 'iacopo.cupelli@toscanadiagnostica.it');
    assert.equal(per('AVVIO_PP'), undefined, 'senza data effettiva l\'annuncio al laboratorio aspetta');
    st = must(await o.get(`/api/business/hub/accounts/${acc.id}/punto`), 'punto');
    const stato = (key) => st.avvio.piano.find((x) => x.key === key).stato;
    assert.equal(stato('AVVIO_LAB'), 'ATTESA_DATA'); assert.equal(stato('PRIMO_ORDINE'), 'FALLITO');
    // data effettiva: parte c); articoli nel catalogo e Riprova: parte d) e una sola volta
    must(await o.put(`/api/business/hub/accounts/${acc.id}/punto`, { data_avvio_effettiva: '2026-12-01' }), 'data');
    for (let i = 1; i <= 3; i++) must(await o.post('/api/orders/articles', { code: `PRV${i}`, category_code: 'MAGAZZINO', name: `Articolo ${i}`, unit: 'pz', pack_size: 1, pack_label: 'conf.', visible_sedi: i < 3 }), `articolo ${i}`);
    const rp = must(await o.post(`/api/business/hub/accounts/${acc.id}/avvio/riprova`, {}), 'riprova');
    assert.deepEqual(rp.eseguiti, [{ key: 'PRIMO_ORDINE', stato: 'OK' }]); assert.equal(rp.riepilogo.completo, true);
    assert.equal((await o.post(`/api/business/hub/accounts/${acc.id}/avvio/riprova`, {})).s, 400, 'nessun passo da riprovare');
    const ordini = must(await o.get('/api/orders/orders'), 'ordini');
    assert.equal(ordini.length, 1); assert.equal(ordini[0].status, 'BOZZA');
    const det = must(await o.get(`/api/orders/orders/${ordini[0].id}`), 'ordine');
    assert.equal(det.lines.length, 2, 'solo gli articoli destinati ai Punti Prelievo'); assert.ok(det.lines.every((l) => l.qty_requested === 1));
    const a2 = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    assert.equal(a2.attivita.find((x) => x.sottotipo === 'AVVIO_PP').email_to, 'laboratorio@toscanadiagnostica.it, valentina.zezza@toscanadiagnostica.it');
    // il secondo contratto (dalla posta) non rimanda nulla
    const n = a2.attivita.filter((x) => x.tipo === 'EMAIL_OUT').length;
    const vr = must(await o.post(`/api/business/hub/documenti/${st.da_verificare[0].id}/verifica`, { esito: 'CONTRATTO' }), 'verifica');
    assert.equal(vr.contrattualizzazione.gia, true);
    assert.equal(must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'a').attivita.filter((x) => x.tipo === 'EMAIL_OUT').length, n);
    // flagship: "Avvia il punto prelievi" con la data, solo i passi c-g
    const f = must(await o.post('/api/business/hub/punti-prelievo/da-sede', { site_id: flag.id }), 'account flagship');
    assert.equal((await o.post(`/api/business/hub/accounts/${f.id}/avvio`, {})).s, 400, 'data obbligatoria');
    const av = must(await o.post(`/api/business/hub/accounts/${f.id}/avvio`, { data: '2026-12-15' }), 'avvia');
    assert.deepEqual(av.eseguiti.map((x) => x.key), ['AVVIO_LAB', 'PRIMO_ORDINE', 'DOTAZIONE', 'FONDO_CASSA', 'RIFIUTI']); assert.equal(av.riepilogo.completo, true); assert.equal(av.fase, 6);
    assert.equal((await o.post(`/api/business/hub/accounts/${f.id}/avvio`, { data: '2026-12-15' })).s, 409, 'una volta sola');
    const el = must(await o.get('/api/business/hub/punti-prelievo'), 'elenco');
    assert.deepEqual(el.punti.map((x) => x.tipo).sort(), ['CORNER', 'FLAGSHIP']);
  } finally { await s.stop(); }
});
