import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Modal, Badge, Field, useToast, Card, Kpi } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { pdfBase64 } from '../lib/exports.js';
import { meseTxt, thisMonth, addMonths, itD, oreTxt, eur, STATO_REND, pdfRendiconto } from '../lib/personale.js';

export default function Rendiconti() {
  const { user } = useAuth(); const toast = useToast();
  const [mese, setMese] = useState(addMonths(thisMonth(), -1));
  const { data, error, reload } = useApi(`/personale/rendiconti?mese=${mese}`, [mese]);
  const ant = useApi(`/personale/rendiconti/anteprima?mese=${mese}`, [mese]);
  const settings = useApi(user.role === 'ADMIN' ? '/settings' : null);
  const [open, setOpen] = useState(null);
  const genera = async (ids) => { try { const r = await api.post('/personale/rendiconti/genera', { mese, prof_ids: ids }); toast(`Rendiconti: ${r.created} creati, ${r.updated} rigenerati`); reload(); ant.reload(); } catch (e) { toast(e.message, 'err'); } };
  const stati = (data || []).reduce((a, x) => { a[x.stato] = (a[x.stato] || 0) + 1; return a; }, {});
  const tot = (data || []).reduce((a, x) => a + Number(x.importo), 0);
  const daGenerare = (ant.data || []).filter((x) => !x.esiste);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Rendiconti compensi</h1><div className="sub">Calcolo mensile dalle presenze confermate e dalle condizioni di compenso; controllo e approvazione del Responsabile del personale sanitario; invio automatico al professionista per la fattura.</div></div>
        <div className="row"><button className="btn ghost sm" onClick={() => setMese(addMonths(mese, -1))}>‹</button><b style={{ minWidth: 130, textAlign: 'center' }}>{meseTxt(mese)}</b><button className="btn ghost sm" onClick={() => setMese(addMonths(mese, 1))}>›</button></div></div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (<>
        <div className="grid g4" style={{ marginBottom: 14 }}>
          <Kpi label="Rendiconti" value={data.length} foot={Object.entries(stati).map(([k, v]) => `${v} ${STATO_REND[k]?.[0].toLowerCase()}`).join(' · ') || '—'} />
          <Kpi label="Imponibile totale" value={eur(tot)} foot={`ore ${oreTxt(data.reduce((a, x) => a + Number(x.ore), 0))}`} />
          <Kpi label="Da approvare" value={stati.DA_APPROVARE || 0} accent={(stati.DA_APPROVARE || 0) > 0} foot="in attesa del Responsabile" />
          <Kpi label="Inviati" value={stati.INVIATO || 0} foot="email con PDF al professionista" />
        </div>
        {daGenerare.length > 0 && <div className="alert info" style={{ marginBottom: 12 }}><div className="row"><span><b>{daGenerare.length}</b> professionisti con presenze confermate (o compenso fisso) non hanno ancora il rendiconto di {meseTxt(mese)}: {daGenerare.slice(0, 6).map((x) => x.nome).join(', ')}{daGenerare.length > 6 ? '…' : ''}{daGenerare.some((x) => x.tariffaMancante) && <span className="red"> · attenzione: alcuni non hanno la tariffa oraria in anagrafica</span>}</span><span className="spacer" /><button className="btn sm" onClick={() => genera(daGenerare.map((x) => x.prof_id))}>Genera i mancanti</button></div></div>}
        <Card flush>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Professionista</th><th>Profilo</th><th className="num">Ore</th><th className="num">Imponibile</th><th className="num">Tot. fattura</th><th>Stato</th><th>Approvato</th><th>Inviato</th><th /></tr></thead>
            <tbody>{data.map((r) => <tr key={r.id}><td className="strong">{r.nome}{!r.email && <Badge tone="red">senza email</Badge>}</td><td className="small">{r.profilo}</td><td className="num">{oreTxt(Number(r.ore))}</td><td className="num">{eur(r.importo)}</td><td className="num">{eur(r.totale_fattura)}</td><td><Badge tone={STATO_REND[r.stato]?.[1]}>{STATO_REND[r.stato]?.[0]}</Badge></td><td className="small">{r.approvato_da_nome ? `${r.approvato_da_nome} · ${itDateTime(r.approvato_at)}` : ''}</td><td className="small">{r.inviato_at ? itDateTime(r.inviato_at) : ''}</td><td className="num"><button className="btn sm ghost" onClick={() => setOpen(r.id)}>Apri</button></td></tr>)}
              {!data.length && <tr><td colSpan={9} className="empty">Nessun rendiconto per {meseTxt(mese)}. Dopo che i gestori di sede hanno confermato le presenze, genera i rendiconti da qui.</td></tr>}</tbody>
          </table></div>
          {data.some((x) => ['BOZZA', 'RESPINTO'].includes(x.stato)) && <div className="bd row" style={{ borderTop: '1px solid var(--line)' }}><button className="btn sm ghost" onClick={() => genera(data.filter((x) => ['BOZZA', 'RESPINTO'].includes(x.stato)).map((x) => x.prof_id))}>Ricalcola le bozze</button><span className="small muted">utile dopo nuove presenze o modifiche alle tariffe</span></div>}
        </Card>
        <p className="small muted" style={{ marginTop: 10 }}>Flusso: Bozza (calcolo) → Da approvare (invio al Responsabile) → Approvato e Inviato al professionista con copia a {settings.data?.rendiconto_cc || 'amministrazione e backoffice'} (modificabile in Impostazioni). Le presenze incluse in un rendiconto non sono più modificabili; per correggere, elimina la bozza, correggi le presenze e rigenera.</p>
      </>)}
      {open && <RendicontoModal id={open} user={user} onClose={() => setOpen(null)} onChanged={() => { reload(); }} toast={toast} />}
    </div>
  );
}

export function RendicontoModal({ id, user, onClose, onChanged, toast, portale = false }) {
  const [r, setR] = useState(null); const [busy, setBusy] = useState(false); const [nota, setNota] = useState('');
  const load = () => api.get(portale ? `/portale/rendiconti/${id}` : `/personale/rendiconti/${id}`).then(setR).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, [id]);
  if (!r) return <Modal title="Rendiconto" onClose={onClose}><Loading /></Modal>;
  const det = r.dettaglio || {}; const o = det.oneri || {};
  const gest = ['ADMIN', 'RESP_SAN'].includes(user.role);
  const act = async (fn, msg) => { setBusy(true); try { await fn(); toast(msg); await load(); onChanged?.(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  const approva = () => { if (!window.confirm(`Approvare il rendiconto di ${r.nome} per ${meseTxt(r.mese)} e inviarlo via email al professionista (con copia ad amministrazione/backoffice)?`)) return; act(async () => { const { doc, filename } = pdfRendiconto({ ...r, approvato_da_nome: user.full_name, approvato_at: new Date().toISOString(), stato: 'APPROVATO' }); const res = await api.post(`/personale/rendiconti/${r.id}/approva`, { attachment: { filename, base64: pdfBase64(doc) }, nota: nota || null }); if (res.mail && res.mail !== 'INVIATA') throw new Error(res.mail === 'NON_CONFIGURATA' ? 'Approvato, ma l\'email non è configurata: il PDF è scaricabile da qui' : `Approvato, ma invio non riuscito: ${res.error || res.mail}`); }, 'Rendiconto approvato e inviato'); };
  return (
    <Modal title={`Rendiconto ${meseTxt(r.mese)} · ${r.nome}`} onClose={onClose} wide footer={<>
      <button className="btn ghost" onClick={() => { const { doc, filename } = pdfRendiconto(r); doc.save(filename); }}>Scarica PDF</button>
      {!portale && gest && r.stato !== 'INVIATO' && <button className="btn ghost" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => window.confirm('Eliminare il rendiconto? Le presenze tornano modificabili.') && act(async () => { await api.del(`/personale/rendiconti/${r.id}`); onClose(); }, 'Rendiconto eliminato')}>Elimina</button>}
      <span className="spacer" />
      {!portale && gest && r.stato === 'BOZZA' && <button className="btn ghost" disabled={busy} onClick={() => act(() => api.post(`/personale/rendiconti/${r.id}/stato`, { stato: 'DA_APPROVARE' }), 'Inviato al Responsabile per approvazione')}>Invia in approvazione</button>}
      {!portale && gest && ['BOZZA', 'DA_APPROVARE'].includes(r.stato) && <button className="btn ghost" disabled={busy} onClick={() => act(() => api.post(`/personale/rendiconti/${r.id}/stato`, { stato: 'RESPINTO', nota }), 'Rendiconto respinto')}>Respingi</button>}
      {!portale && gest && ['BOZZA', 'DA_APPROVARE', 'APPROVATO', 'RESPINTO'].includes(r.stato) && <button className="btn" disabled={busy} onClick={approva}>{r.stato === 'APPROVATO' ? 'Reinvia email' : 'Approva e invia'}</button>}
    </>}>
      <div className="row" style={{ gap: 14, marginBottom: 10 }}><Badge tone={STATO_REND[r.stato]?.[1]}>{STATO_REND[r.stato]?.[0]}</Badge><span className="small muted">{r.profilo} · generato {itDateTime(r.generato_at)}{r.generato_da_nome ? ' da ' + r.generato_da_nome : ''}{r.approvato_at ? ` · approvato ${itDateTime(r.approvato_at)} da ${r.approvato_da_nome}` : ''}{r.inviato_at ? ` · inviato ${itDateTime(r.inviato_at)}` : ''}</span></div>
      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Kpi label="Ore confermate" value={oreTxt(Number(r.ore))} foot={det.tipo === 'FISSO' ? 'compenso fisso' : `tariffa ${det.compenso?.tariffaOraria ? eur(det.compenso.tariffaOraria) + '/h' : 'per sede'}`} />
        <Kpi label="Imponibile" value={eur(o.imponibile)} foot={det.compenso?.regime || ''} />
        <Kpi label="Totale fattura" value={eur(o.totaleFattura)} foot={`${det.compenso?.cassaPct ? 'cassa ' + det.compenso.cassaPct + '% ' : ''}${det.compenso?.ivaPct ? 'IVA ' + det.compenso.ivaPct + '%' : 'senza IVA'}`} />
        <Kpi label="Netto a pagare" value={eur(o.netto)} foot={det.compenso?.ritPct ? `ritenuta ${det.compenso.ritPct}%` : 'nessuna ritenuta'} />
      </div>
      <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}><table className="t"><thead><tr><th>Data</th><th>Sede</th><th>Orario</th><th className="num">Ore</th><th className="num">Tariffa</th><th className="num">Importo</th><th>Attività</th><th>Nota</th></tr></thead>
        <tbody>{(det.righe || []).map((x, i) => <tr key={i}><td>{itD(x.data)}</td><td>{x.sede}</td><td className="mono">{x.oraDa}–{x.oraA}</td><td className="num">{oreTxt(x.ore)}</td><td className="num">{det.tipo === 'FISSO' ? '—' : x.tariffa ? eur(x.tariffa) : <span className="red">manca</span>}</td><td className="num">{det.tipo === 'FISSO' ? '—' : eur(x.importo)}</td><td className="small">{x.attivita}</td><td className="small">{x.nota}</td></tr>)}
          {!(det.righe || []).length && <tr><td colSpan={8} className="empty">Nessuna presenza confermata nel mese</td></tr>}</tbody></table></div>
      {(det.perSede || []).length > 1 && <div className="row" style={{ gap: 8, marginTop: 8 }}>{det.perSede.map((s) => <span key={s.sedeId} className="chip">{s.sede}: {oreTxt(s.ore)} · {eur(s.importo)}</span>)}</div>}
      {!portale && gest && r.stato !== 'INVIATO' && <Field label="Nota (per il professionista o per il respingimento)" className="mt"><input value={nota} onChange={(e) => setNota(e.target.value)} placeholder={r.nota || ''} /></Field>}
      {r.nota && <p className="small muted">Nota: {r.nota}</p>}
    </Modal>
  );
}
