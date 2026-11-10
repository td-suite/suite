// Retail · sezione B2B (service e medicina del lavoro), decisione del CEO del 09/11/2026 sera: "Il B2B deriva tutto da StudioLab".
// Ogni numero viene dalla copia Synclab (lib/synclab/letture.js, unica via di lettura): accettazioni e righe d'esame per la produzione,
// documenti economici per il fatturato, listino corrente del gestionale. Il Business Hub dà solo il listino concordato (confronto dei
// prezzi), il modulo NC le non conformità aperte (se LIVE), retail.budget_b2b gli obiettivi. Ripartizione B2B / Laboratorio in sede:
// impostazione `synclab_privati_in_b2c` (lib/b2b.js). Visibilità: tutti i profili del modulo (dati aggregati per cliente, nessun paziente);
// il budget lo scrivono ADMIN e RETAIL. Documentazione: docs/RETAIL.md.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, audit, bad, notFound, parse } from '../lib/util.js';
import { requireWrite } from '../lib/access.js';
import { toXlsx } from '../lib/exports.js';
import { privatiInB2c, listiniHub, ncAperte, budgetB2B, quadroB2B } from '../lib/b2b.js';
import {
  cruscottoB2B, produzioneClientiMesi, fatturatoClientiMesi, prezziApplicati, schedaClienteSynclab, statoCopia, periodoProfilo,
  produzioneGiornaliera, produzioneClientiGiorni, statiErogati, fonteProduzione, aggiornatoAlle, descriviStati,
} from '../../../lib/synclab/letture.js';

const r = Router();
const oggiRoma = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
/** Periodo dai parametri (periodo = 12m | AAAA-MM | AAAA-Qn | AAAA, oppure da/a); predefinito: ultimi 12 mesi fino a oggi. */
const periodo = (query) => periodoProfilo({ periodo: query.periodo || '12m', da: query.da || null, a: query.a || null, oggi: oggiRoma() });
// v0.68.5: ogni pagina dichiara la grandezza principale (produzione erogata) con gli stati, il netto e l'ora della copia
const fonte = async () => {
  const stato = await statoCopia();
  const stati = await statiErogati();
  const cp = stato?.insiemi?.requests?.checkpoint_at || null;
  return { fonte: 'StudioLab (Synclab Data API, copia locale in sola lettura)', stato, stati, stati_descritti: descriviStati(stati), fonte_produzione: fonteProduzione(stati, cp), aggiornato: aggiornatoAlle(cp, oggiRoma()) };
};

// Stato della copia Synclab (fonte e ultimo checkpoint), per le pagine che non chiamano altro
r.get('/stato', ah(async (_req, res) => res.json({ ...(await fonte()), privati_in_b2c: await privatiInB2c() })));

// Cruscotto B2B del mese
r.get('/cruscotto', ah(async (req, res) => {
  const mese = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mese || '')) ? req.query.mese : null;
  const privati = await privatiInB2c();
  const c = await cruscottoB2B({ mese, privatiInB2c: privati, oggi: oggiRoma() });
  const giornaliero = await produzioneGiornaliera({ da: c.periodo.da, a: c.periodo.a, privatiInB2c: privati, ripartizione: 'B2B' });
  res.json({ ...c, giornaliero, privati_in_b2c: privati, ...(await fonte()) });
}));

// Aziende e strutture: clienti attivi e contrattualizzati della Suite (quadro esistente, ponte dei codici delle vendite) con i numeri di
// Synclab del mese (produzione e fatturato da documenti), il listino applicato (Synclab e Business Hub) e i client Synclab B2B che non
// sono nel quadro (Legal entity esterne non clienti attivi, client non abbinati)
r.get('/clienti', ah(async (req, res) => {
  const privati = await privatiInB2c();
  const oggi = oggiRoma();
  const mese = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mese || '')) ? req.query.mese : oggi.slice(0, 7);
  const p = periodoProfilo({ periodo: mese, oggi });
  const quadro = await quadroB2B({ q: req.query.q || '' });
  const prod = await produzioneClientiMesi({ da: p.da, a: p.a, privatiInB2c: privati, ripartizione: 'B2B' });
  const fat = await fatturatoClientiMesi({ da: p.da, a: p.a, privatiInB2c: privati, ripartizione: 'B2B' });
  const clients = await many(`SELECT organization_id, string_agg(DISTINCT client_code, ', ') AS codici,
      string_agg(DISTINCT (SELECT l.code FROM synclab.price_lists l WHERE l.instance_id = m.instance_id AND l.id = m.price_list_id LIMIT 1), ', ') AS listino_synclab
    FROM synclab.clients_td m WHERE organization_id IS NOT NULL AND disponibilita = 'ATTIVO' GROUP BY organization_id`).catch(() => []);
  const cliDi = new Map(clients.map((x) => [x.organization_id, x]));
  const orgIds = [...new Set([...quadro.clienti.map((c) => c.organization_id), ...prod.clienti.map((c) => c.organization_id).filter(Boolean)])];
  const hub = await listiniHub(orgIds);
  const prodDi = new Map(prod.clienti.map((c) => [c.chiave, c.totale]));
  const fatDi = new Map(fat.clienti.map((c) => [c.chiave, c.totale]));
  const synclab = (orgId) => {
    const h = hub.per_org.get(orgId);
    return { produzione: prodDi.get(String(orgId)) || null, fatturato: fatDi.get(String(orgId)) || null, codici_synclab: cliDi.get(orgId)?.codici || null,
      listino_synclab: cliDi.get(orgId)?.listino_synclab || null, listino_hub: h ? { versione: h.versione, linea: h.linea, esami: h.prezzi.size, account_id: h.account_id } : null };
  };
  const nelQuadro = new Set(quadro.clienti.map((c) => String(c.organization_id)));
  const t = String(req.query.q || '').trim().toLowerCase();
  const altri = prod.clienti.filter((c) => !nelQuadro.has(c.chiave) && (!t || String(c.cliente).toLowerCase().includes(t)))
    .map((c) => ({ chiave: c.chiave, cliente: c.cliente, organization_id: c.organization_id, stato_abbinamento: c.stato_abbinamento, perimetro_b2b: c.perimetro_b2b, ...(c.organization_id ? synclab(c.organization_id) : { produzione: c.totale, fatturato: fatDi.get(c.chiave) || null }) }));
  res.json({ ...quadro, clienti: quadro.clienti.map((c) => ({ ...c, synclab: synclab(c.organization_id) })), synclab_altri: altri, mese, periodo: p,
    hub: { disponibile: hub.disponibile, nota: hub.nota }, privati_in_b2c: privati, ...(await fonte()) });
}));

// Scheda cliente B2B: chiave = id della Legal entity oppure 'c-<id client Synclab>'
r.get('/clienti/:chiave', ah(async (req, res) => {
  const chiave = String(req.params.chiave);
  if (!/^\d+$/.test(chiave) && !/^c-.+/.test(chiave)) throw bad('Cliente non valido');
  const privati = await privatiInB2c();
  const p = periodo(req.query);
  const s = await schedaClienteSynclab({ chiave, da: p.da, a: p.a, privatiInB2c: privati });
  const orgId = /^\d+$/.test(chiave) ? Number(chiave) : s.organization_id;
  const org = orgId ? await one(`SELECT o.id, o.name, o.kind, o.vat_number, o.tax_code, o.city, o.province, o.email, o.active, public.cliente_livello(o.id) AS livello FROM public.organizations o WHERE o.id = $1`, [orgId]) : null;
  if (!org && !s.clients.length && !s.totale.accettazioni && !s.documenti.length) throw notFound('Cliente non trovato tra i client Synclab né tra le Legal entity');
  const hub = orgId ? await listiniHub([orgId]) : { disponibile: false, nota: 'Client Synclab non abbinato a una Legal entity: nessun listino del Business Hub', per_org: new Map() };
  const h = orgId ? hub.per_org.get(orgId) : null;
  const prezzi = s.prezzi.map((x) => { const b = h?.prezzi.get(x.codice); const pr = b?.prezzo ?? null;
    return { ...x, listino_hub: pr, scost_hub: x.prezzo_medio != null && pr != null ? Math.round((x.prezzo_medio - pr) * 100) / 100 : null, scost_hub_pct: x.prezzo_medio != null && pr ? Math.round(((x.prezzo_medio - pr) / pr) * 1000) / 10 : null }; });
  const nc = orgId ? await ncAperte(orgId) : { disponibile: false, nota: 'Client non abbinato a una Legal entity' };
  const codici = orgId ? await many(`SELECT id, external_code, abbinamento FROM customers WHERE kind = 'B2B' AND NOT demo AND organization_id = $1 ORDER BY external_code`, [orgId]) : [];
  res.json({ ...s, prezzi, periodo: p, org, nc, codici_vendite: codici, privati_in_b2c: privati,
    hub: { disponibile: hub.disponibile, nota: hub.nota || (orgId && !h && hub.disponibile ? 'Nessun listino del Business Hub per questa Legal entity' : null), versione: h?.versione ?? null, linea: h?.linea ?? null, account_id: h?.account_id ?? null },
    link: { business_hub: h?.account_id ? `/business/account/${h.account_id}` : null, clienti_synclab: '/admin/connectors/synclab' }, ...(await fonte()) });
}));

// Produzione per cliente e mese (B2B) e il suo export Excel
const leggiProduzione = async (query) => {
  const privati = await privatiInB2c();
  const p = periodo(query);
  const rip = query.ripartizione === 'LAB_SEDE' ? 'LAB_SEDE' : query.ripartizione === 'tutte' ? null : 'B2B';
  return { p, privati, rip, dati: await produzioneClientiMesi({ da: p.da, a: p.a, privatiInB2c: privati, ripartizione: rip }) };
};
r.get('/produzione', ah(async (req, res) => {
  const { p, privati, rip, dati } = await leggiProduzione(req.query);
  res.json({ ...dati, periodo: p, ripartizione: rip || 'tutte', privati_in_b2c: privati, ...(await fonte()) });
}));
r.get('/produzione/export.xlsx', ah(async (req, res) => {
  const { p, rip, dati } = await leggiProduzione(req.query);
  const stato = await statoCopia();
  const colMese = (mk) => [{ key: `${mk}_e`, header: `${mk} esami`, int: true, width: 12 }, { key: `${mk}_v`, header: `${mk} produzione erogata`, money: true, width: 16 }];
  const righe = dati.clienti.map((c) => ({ cliente: c.cliente, chiave: c.chiave, abbinamento: c.stato_abbinamento, acc: c.totale.accettazioni, esami: c.totale.esami, valore: c.totale.valore,
    ...Object.fromEntries(dati.mesi.flatMap((mk) => [[`${mk}_e`, c.mesi[mk]?.esami || 0], [`${mk}_v`, c.mesi[mk]?.valore ?? null]])) }));
  const buf = await toXlsx([
    { name: 'Produzione cliente × mese', columns: [{ key: 'cliente', header: 'Cliente', width: 40 }, { key: 'chiave', header: 'Chiave', width: 14 }, { key: 'abbinamento', header: 'Abbinamento', width: 14 },
      { key: 'acc', header: 'Accettazioni', int: true }, { key: 'esami', header: 'Esami', int: true }, { key: 'valore', header: 'Valore', money: true, width: 14 }, ...dati.mesi.flatMap(colMese)], rows: righe },
    { name: 'Note', columns: [{ key: 'k', header: 'Voce', width: 28 }, { key: 'v', header: 'Valore', width: 110 }], rows: [
      { k: 'Fonte', v: 'StudioLab (Synclab Data API): produzione erogata (accettazioni ATTIVE in stato erogato con almeno una riga d\'esame non cancellata)' },
      { k: 'Perimetro', v: rip === 'LAB_SEDE' ? 'Laboratorio in sede (client abbinati a sedi TD)' : rip ? 'B2B (client abbinati a Legal entity esterne o non abbinati)' : 'Tutti i client Synclab' },
      { k: 'Esami', v: 'Righe d\'esame non cancellate' },
      { k: 'Valore', v: 'Σ netto di riga × quantità × (1 − sconto di testata), applicato una volta; righe senza prezzo escluse dal valore e contate (valore parziale)' },
      { k: 'Periodo', v: `${p.etichetta} (${p.da} - ${p.a})` },
      { k: 'Ultimo checkpoint accettazioni', v: stato.insiemi.requests?.checkpoint_at ? new Date(stato.insiemi.requests.checkpoint_at).toISOString() : 'nessuno' },
    ] },
  ]);
  await audit(req, 'B2B_PRODUZIONE_EXPORT', 'synclab', null, { periodo: p.etichetta, clienti: dati.clienti.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="produzione-b2b_${p.da}_${p.a}.xlsx"`);
  res.send(buf);
}));

// Produzione erogata per cliente e GIORNO di un mese (dettaglio giornaliero, v0.68.5) e il suo export Excel
const leggiGiorni = async (query) => {
  const privati = await privatiInB2c();
  const oggi = oggiRoma();
  const mese = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(query.mese || '')) ? query.mese : oggi.slice(0, 7);
  const p = periodoProfilo({ periodo: mese, oggi });
  const a = p.a > oggi && p.da <= oggi ? oggi : p.a;   // mese in corso: fino a oggi
  return { mese, p: { ...p, a }, privati, dati: await produzioneClientiGiorni({ da: p.da, a, privatiInB2c: privati, ripartizione: 'B2B' }) };
};
r.get('/produzione/giorni', ah(async (req, res) => {
  const { mese, p, privati, dati } = await leggiGiorni(req.query);
  res.json({ ...dati, mese, periodo: p, privati_in_b2c: privati, ...(await fonte()) });
}));
r.get('/produzione/giorni/export.xlsx', ah(async (req, res) => {
  const { mese, p, dati } = await leggiGiorni(req.query);
  const f = await fonte();
  const righe = dati.clienti.map((c) => ({ cliente: c.cliente, chiave: c.chiave, acc: c.totale.accettazioni, esami: c.totale.esami, valore: c.totale.valore,
    ...Object.fromEntries(dati.giorni.map((g) => [`g${g}`, c.giorni[g]?.valore ?? null])) }));
  const buf = await toXlsx([
    { name: 'Produzione cliente × giorno', columns: [{ key: 'cliente', header: 'Cliente', width: 40 }, { key: 'chiave', header: 'Chiave', width: 14 }, { key: 'acc', header: 'Accettazioni erogate', int: true },
      { key: 'esami', header: 'Esami', int: true }, { key: 'valore', header: 'Produzione erogata', money: true, width: 16 }, ...dati.giorni.map((g) => ({ key: `g${g}`, header: g.slice(8, 10) + '/' + g.slice(5, 7), money: true, width: 11 }))], rows: righe },
    { name: 'Note', columns: [{ key: 'k', header: 'Voce', width: 28 }, { key: 'v', header: 'Valore', width: 110 }], rows: [
      { k: 'Fonte', v: f.fonte_produzione }, { k: 'Stati erogati', v: f.stati_descritti }, { k: 'Mese', v: `${mese} (${p.da} - ${p.a})` },
      { k: 'Valore', v: 'Σ netto di riga × quantità × (1 − sconto di testata) delle righe d\'esame non cancellate; righe senza prezzo escluse dal valore e contate' } ] },
  ]);
  await audit(req, 'B2B_PRODUZIONE_GIORNI_EXPORT', 'synclab', null, { mese, clienti: dati.clienti.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="produzione-b2b-giornaliera_${mese}.xlsx"`);
  res.send(buf);
}));

// Fatturato da documenti per cliente e mese (dato secondario: "Documenti emessi")
r.get('/fatturato', ah(async (req, res) => {
  const privati = await privatiInB2c();
  const p = periodo(req.query);
  const d = await fatturatoClientiMesi({ da: p.da, a: p.a, privatiInB2c: privati, ripartizione: 'B2B' });
  res.json({ ...d, periodo: p, privati_in_b2c: privati, ...(await fonte()) });
}));

// Listini applicati: prezzo netto medio per esame e cliente (Synclab) contro listino corrente Synclab e listino del Business Hub
r.get('/listini', ah(async (req, res) => {
  const privati = await privatiInB2c();
  const p = periodo(req.query);
  const chiave = req.query.chiave ? String(req.query.chiave) : null;
  const rows = await prezziApplicati({ da: p.da, a: p.a, privatiInB2c: privati, ripartizione: 'B2B', chiave });
  const hub = await listiniHub(rows.map((x) => (/^\d+$/.test(x.chiave) ? Number(x.chiave) : null)).filter(Boolean));
  const soglia = Number(req.query.soglia ?? 0) || 0;
  const righe = rows.map((x) => {
    const h = /^\d+$/.test(x.chiave) ? hub.per_org.get(Number(x.chiave)) : null;
    const pr = h?.prezzi.get(x.codice)?.prezzo ?? null;
    return { ...x, listino_hub: pr, versione_hub: h?.versione ?? null, scost_hub: x.prezzo_medio != null && pr != null ? Math.round((x.prezzo_medio - pr) * 100) / 100 : null,
      scost_hub_pct: x.prezzo_medio != null && pr ? Math.round(((x.prezzo_medio - pr) / pr) * 1000) / 10 : null };
  }).filter((x) => !soglia || Math.abs(x.scost_hub_pct ?? 0) >= soglia || Math.abs(x.scost_synclab_pct ?? 0) >= soglia);
  const clienti = [...new Map(rows.map((x) => [x.chiave, { chiave: x.chiave, cliente: x.cliente }])).values()];
  res.json({ righe, clienti, periodo: p, hub: { disponibile: hub.disponibile, nota: hub.nota }, privati_in_b2c: privati, ...(await fonte()),
    regola: 'Prezzo netto medio = Σ netto di riga × quantità / Σ quantità sulle righe con prezzo; listino Synclab = listino corrente del client (base, poi extra): non ricostruisce i prezzi storici; listino Business Hub = versione corrente, prezzo offerto (altrimenti di listino)' });
}));

// Budget B2B (obiettivi per cliente e mese su produzione e fatturato) con il consuntivo Synclab dello stesso anno
r.get('/budget', ah(async (req, res) => {
  const anno = Number(req.query.anno) || Number(oggiRoma().slice(0, 4));
  const privati = await privatiInB2c();
  const da = `${anno}-01-01`, a = `${anno}-12-31`;
  const [righe, prod, fat] = await Promise.all([budgetB2B(anno), produzioneClientiMesi({ da, a, privatiInB2c: privati, ripartizione: 'B2B' }), fatturatoClientiMesi({ da, a, privatiInB2c: privati, ripartizione: 'B2B' })]);
  const chiavi = new Map();
  for (const c of prod.clienti) chiavi.set(c.chiave, { chiave: c.chiave, cliente: c.cliente, organization_id: c.organization_id });
  for (const c of fat.clienti) if (!chiavi.has(c.chiave)) chiavi.set(c.chiave, { chiave: c.chiave, cliente: c.cliente, organization_id: c.organization_id });
  for (const b of righe) if (!chiavi.has(b.chiave)) chiavi.set(b.chiave, { chiave: b.chiave, cliente: b.cliente, organization_id: b.organization_id });
  const prodDi = new Map(prod.clienti.map((c) => [c.chiave, c])), fatDi = new Map(fat.clienti.map((c) => [c.chiave, c]));
  const clienti = [...chiavi.values()].map((c) => ({ ...c, mesi: Array.from({ length: 12 }, (_, i) => {
    const mk = `${anno}-${String(i + 1).padStart(2, '0')}`; const b = righe.find((x) => x.chiave === c.chiave && x.mese === i + 1);
    return { mese: i + 1, budget_produzione: b?.produzione ?? null, budget_fatturato: b?.fatturato ?? null, budget_esami: b?.esami ?? null,
      produzione: prodDi.get(c.chiave)?.mesi[mk]?.valore ?? null, esami: prodDi.get(c.chiave)?.mesi[mk]?.esami || 0, fatturato: fatDi.get(c.chiave)?.mesi[mk]?.fatturato ?? null };
  }) })).sort((x, y) => String(x.cliente).localeCompare(String(y.cliente), 'it'));
  res.json({ anno, clienti, privati_in_b2c: privati, ...(await fonte()) });
}));
const budgetSchema = z.object({
  anno: z.number().int().min(2000).max(2100),
  righe: z.array(z.object({ chiave: z.string().min(1).max(200), cliente: z.string().max(300).nullable().optional(), mese: z.number().int().min(1).max(12),
    produzione: z.number().nonnegative().nullable().optional(), fatturato: z.number().nullable().optional(), esami: z.number().int().nonnegative().nullable().optional(), note: z.string().max(1000).nullable().optional() })).max(5000),
});
r.put('/budget', requireWrite, ah(async (req, res) => {
  const d = parse(budgetSchema, req.body || {});
  let scritte = 0, tolte = 0;
  for (const x of d.righe) {
    if (!/^\d+$/.test(x.chiave) && !/^c-.+/.test(x.chiave)) throw bad(`Cliente non valido: ${x.chiave}`);
    const orgId = /^\d+$/.test(x.chiave) ? Number(x.chiave) : null;
    if (x.produzione == null && x.fatturato == null && x.esami == null) {
      tolte += (await q('DELETE FROM budget_b2b WHERE chiave=$1 AND anno=$2 AND mese=$3', [x.chiave, d.anno, x.mese])).rowCount; continue;
    }
    await q(`INSERT INTO budget_b2b (chiave, organization_id, cliente, anno, mese, produzione, fatturato, esami, note, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
      ON CONFLICT (chiave, anno, mese) DO UPDATE SET organization_id=EXCLUDED.organization_id, cliente=coalesce(EXCLUDED.cliente, budget_b2b.cliente), produzione=EXCLUDED.produzione, fatturato=EXCLUDED.fatturato,
        esami=EXCLUDED.esami, note=coalesce(EXCLUDED.note, budget_b2b.note), updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [x.chiave, orgId, orgId ? null : (x.cliente || null), d.anno, x.mese, x.produzione ?? null, x.fatturato ?? null, x.esami ?? null, x.note ?? null, req.user?.id || null]);
    scritte++;
  }
  await audit(req, 'B2B_BUDGET_UPDATE', 'budget_b2b', String(d.anno), { scritte, tolte });
  res.json({ ok: true, scritte, tolte });
}));

export default r;
