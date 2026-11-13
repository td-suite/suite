// Rimborso Spese · export Excel per P&C (utile per il cedolino). TeamSystem HR è citato nei moduli SGI ma NON c'è integrazione: solo
// export. Fogli: Riepilogo (una riga per dipendente e mese con totali e saldo), Per categoria (dipendente, mese, categoria, importo),
// Spese e Chilometri (tutte le righe). Le righe escluse dal responsabile sono segnate e non entrano nei totali.
import ExcelJS from 'exceljs';
import { many } from '../db.js';
import { nomeMese, STATO_LABEL, METODI } from './calcoli.js';

const TEAL = 'FF1C505E';
const intest = (ws) => { const r = ws.getRow(1); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
const euro = '#,##0.00';

/** filtri: { anno, mese?, stati: [..], personIds?: [..] } */
export async function exportXlsx({ anno, mese = null, stati, personIds = null }) {
  const par = [anno, stati];
  let w = 'n.anno = $1 AND n.stato = ANY($2::text[])';
  if (mese) { par.push(mese); w += ` AND n.mese = $${par.length}`; }
  if (personIds) { par.push(personIds); w += ` AND n.person_id = ANY($${par.length}::int[])`; }
  const note = await many(`SELECT n.*, p.last_name, p.first_name, p.tax_code, s.name AS sede
      FROM note n JOIN public.people p ON p.id = n.person_id LEFT JOIN public.sites s ON s.id = p.site_id WHERE ${w} ORDER BY lower(p.last_name), lower(p.first_name), n.mese`, par);
  const ids = note.map((n) => n.id);
  const spese = ids.length ? await many(`SELECT s.*, c.nome AS categoria, c.tipo AS categoria_tipo, o.name AS cliente FROM spese s JOIN categorie c ON c.id = s.categoria_id LEFT JOIN public.organizations o ON o.id = s.cliente_org_id WHERE s.nota_id = ANY($1::int[]) ORDER BY s.nota_id, s.data, s.id`, [ids]) : [];
  const viaggi = ids.length ? await many(`SELECT v.*, o.name AS cliente FROM viaggi v LEFT JOIN public.organizations o ON o.id = v.cliente_org_id WHERE v.nota_id = ANY($1::int[]) ORDER BY v.nota_id, v.data, v.id`, [ids]) : [];
  const byId = new Map(note.map((n) => [n.id, n]));
  const nome = (n) => `${n.last_name} ${n.first_name}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Suite TD · Rimborso Spese';
  const r = wb.addWorksheet('Riepilogo');
  r.columns = [
    { header: 'Dipendente', key: 'p', width: 28 }, { header: 'Codice fiscale', key: 'cf', width: 18 }, { header: 'Sede', key: 'sede', width: 22 }, { header: 'Anno', key: 'anno', width: 7 }, { header: 'Mese', key: 'mese', width: 12 },
    { header: 'Stato', key: 'stato', width: 16 }, { header: 'Spese documentate', key: 'spese', width: 14, style: { numFmt: euro } }, { header: 'Km', key: 'km', width: 8 },
    { header: 'Rimborso km', key: 'kmi', width: 13, style: { numFmt: euro } }, { header: 'Pedaggi', key: 'ped', width: 11, style: { numFmt: euro } }, { header: 'Parcheggi', key: 'par', width: 11, style: { numFmt: euro } },
    { header: 'Totale rimborsabile', key: 'tot', width: 15, style: { numFmt: euro } }, { header: 'Anticipi', key: 'ant', width: 11, style: { numFmt: euro } }, { header: 'Saldo (+ dipendente, - azienda)', key: 'saldo', width: 16, style: { numFmt: euro } },
    { header: 'Carta aziendale / fuel card (non rimborsabile)', key: 'carta', width: 18, style: { numFmt: euro } }, { header: 'Escluso dal responsabile', key: 'escl', width: 14, style: { numFmt: euro } },
    { header: 'Data liquidazione', key: 'ld', width: 13 }, { header: 'Importo liquidato', key: 'li', width: 13, style: { numFmt: euro } }, { header: 'Riferimento cedolino o bonifico', key: 'rif', width: 24 },
  ];
  for (const n of note) {
    r.addRow({ p: nome(n), cf: n.tax_code || '', sede: n.sede || '', anno: n.anno, mese: nomeMese(n.anno, n.mese).split(' ')[0], stato: STATO_LABEL[n.stato], spese: Number(n.tot_spese), km: Number(n.tot_km), kmi: Number(n.tot_km_importo),
      ped: Number(n.tot_pedaggi), par: Number(n.tot_parcheggi), tot: Number(n.tot_rimborsabile), ant: Number(n.anticipi), saldo: Number(n.saldo), carta: Number(n.tot_carta), escl: Number(n.tot_escluso),
      ld: n.liquidazione_data || '', li: n.liquidazione_importo != null ? Number(n.liquidazione_importo) : null, rif: n.liquidazione_rif || '' });
  }
  intest(r);

  const c = wb.addWorksheet('Per categoria');
  c.columns = [{ header: 'Dipendente', key: 'p', width: 28 }, { header: 'Anno', key: 'anno', width: 7 }, { header: 'Mese', key: 'mese', width: 12 }, { header: 'Categoria', key: 'cat', width: 22 }, { header: 'Pagamento', key: 'met', width: 24 }, { header: 'Importo', key: 'imp', width: 12, style: { numFmt: euro } }, { header: 'Righe', key: 'n', width: 7 }];
  const agg = new Map();
  for (const s of spese.filter((x) => !x.esclusa)) {
    const n = byId.get(s.nota_id);
    const k = `${n.id}|${s.categoria}|${s.metodo}`;
    const a = agg.get(k) || { p: nome(n), anno: n.anno, mese: nomeMese(n.anno, n.mese).split(' ')[0], cat: s.categoria, met: METODI[s.metodo], imp: 0, n: 0 };
    a.imp += Number(s.importo); a.n++; agg.set(k, a);
  }
  for (const n of note) if (Number(n.tot_km_importo) > 0) agg.set(`${n.id}|km`, { p: nome(n), anno: n.anno, mese: nomeMese(n.anno, n.mese).split(' ')[0], cat: 'Rimborso chilometrico', met: METODI.DIPENDENTE, imp: Number(n.tot_km_importo), n: viaggi.filter((v) => v.nota_id === n.id && v.rimborsabile && !v.esclusa).length });
  for (const a of agg.values()) c.addRow({ ...a, imp: Math.round(a.imp * 100) / 100 });
  intest(c);

  const sp = wb.addWorksheet('Spese');
  sp.columns = [{ header: 'Dipendente', key: 'p', width: 26 }, { header: 'Mese', key: 'mese', width: 14 }, { header: 'Data', key: 'data', width: 11 }, { header: 'Descrizione', key: 'd', width: 36 }, { header: 'Categoria', key: 'cat', width: 20 },
    { header: 'Importo', key: 'imp', width: 11, style: { numFmt: euro } }, { header: 'Pagamento', key: 'met', width: 22 }, { header: 'Motivazione', key: 'mot', width: 30 }, { header: 'Cliente', key: 'cli', width: 22 }, { header: 'Progetto', key: 'prog', width: 18 }, { header: 'Esclusa (motivo)', key: 'escl', width: 28 }];
  for (const s of spese) { const n = byId.get(s.nota_id); sp.addRow({ p: nome(n), mese: nomeMese(n.anno, n.mese), data: s.data, d: s.descrizione, cat: s.categoria, imp: Number(s.importo), met: METODI[s.metodo], mot: s.motivazione || '', cli: s.cliente || '', prog: s.progetto || '', escl: s.esclusa ? s.esclusa_motivo || 'sì' : '' }); }
  intest(sp);

  const km = wb.addWorksheet('Chilometri');
  km.columns = [{ header: 'Dipendente', key: 'p', width: 26 }, { header: 'Mese', key: 'mese', width: 14 }, { header: 'Data', key: 'data', width: 11 }, { header: 'Tratta', key: 't', width: 36 }, { header: 'Motivazione', key: 'mot', width: 30 },
    { header: 'Km', key: 'km', width: 8 }, { header: 'Veicolo', key: 'v', width: 30 }, { header: 'Tariffa EUR/km', key: 'tar', width: 12 }, { header: 'Fonte tariffa', key: 'fonte', width: 24 }, { header: 'Importo', key: 'imp', width: 11, style: { numFmt: euro } }, { header: 'Rimborsabile', key: 'rimb', width: 12 }, { header: 'Escluso (motivo)', key: 'escl', width: 26 }];
  for (const v of viaggi) { const n = byId.get(v.nota_id); km.addRow({ p: nome(n), mese: nomeMese(n.anno, n.mese), data: v.data, t: `${v.partenza} - ${v.arrivo}${v.andata_ritorno ? ' (A/R)' : ''}`, mot: v.motivazione || '', km: Number(v.km_totali), v: v.veicolo_testo || '', tar: v.tariffa != null ? Number(v.tariffa) : null, fonte: v.tariffa_fonte || '', imp: Number(v.importo), rimb: v.rimborsabile ? 'sì' : 'no (vettura aziendale)', escl: v.esclusa ? v.esclusa_motivo || 'sì' : '' }); }
  intest(km);

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), note: note.length };
}
