import React, { useState } from 'react';
import { api, API_BASE } from '../api.js';
import { useApi, Field, Loading, Empty, ErrorBox, Card, Icon, useToast, Badge, Modal } from '../components/ui.jsx';

// Correlazione esame StudioLab -> materiale consumato (es. 0014 Emocromo -> Tappo Viola, 1 provetta per esame)
export default function Mappings() {
  const toast = useToast();
  const { data, reload } = useApi('/mappings');
  const [search, setSearch] = useState('');
  const shown = (data || []).filter((m) => !search || `${m.exam_code} ${m.exam_name || ''} ${m.article_name}`.toLowerCase().includes(search.toLowerCase()));
  const FONTE = { MANUALE: ['Manuale', 'grey'], LISTINO: ['Listino', 'blue'], SYNCLAB: ['Synclab', 'teal'] };
  const articles = useApi('/articles');
  const gest = useApi('/mappings/synclab/esami');
  const cont = useApi('/mappings/synclab/contenitori');
  const [prop, setProp] = useState(null);
  const G = gest.data || {};
  const descr = (m) => G[m.exam_code]?.descrizione || m.exam_name;
  // il contenitore più frequente nel gestionale è abbinato a un articolo diverso da quello della correlazione
  const diverso = (m) => { const g = G[m.exam_code]; return g?.articolo_id && g.articolo_id !== m.article_id && !(data || []).some((x) => x.exam_code === m.exam_code && x.article_id === g.articolo_id && x.active); };
  const abbina = async (c, articolo_id) => { setErr(null); try { await api.put(`/mappings/synclab/contenitori/${c.id}`, { articolo_id: articolo_id ? Number(articolo_id) : null }); cont.reload(); gest.reload(); } catch (e2) { setErr(e2); } };
  const aggiornaCont = async () => { setErr(null); try { const r = await api.post('/mappings/synclab/contenitori/aggiorna'); toast(`Contenitori aggiornati: ${r.coppie} coppie`); cont.reload(); gest.reload(); } catch (e2) { setErr(e2); } };
  const anteprima = async () => { setErr(null); try { setProp(await api.post('/mappings/synclab/proponi', { conferma: false })); } catch (e2) { setErr(e2); } };
  const applica = async () => { setErr(null); try { const r = await api.post('/mappings/synclab/proponi', { conferma: true }); toast(`Correlazioni da Synclab applicate: ${r.applicate}`); setProp(null); reload(); gest.reload(); } catch (e2) { setErr(e2); } };
  const [f, setF] = useState({ exam_code: '', exam_name: '', article_id: '', qty_per_exam: 1 });
  const [err, setErr] = useState(null);
  const add = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api.post('/mappings', { ...f, article_id: Number(f.article_id), qty_per_exam: Number(f.qty_per_exam) || 1 }); toast('Correlazione salvata'); setF({ ...f, exam_code: '', exam_name: '' }); reload(); } catch (e2) { setErr(e2); }
  };
  const importFile = async (f, replace) => {
    setErr(null);
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api.upload(`/mappings/import${replace ? '?replace=1' : ''}`, fd); toast(`Importate ${r.rows} correlazioni${replace ? ' (tabella sostituita)' : ''}`); reload(); } catch (e2) { setErr(e2); }
  };
  const del = async (m) => { if (!window.confirm(`Eliminare la correlazione ${m.exam_code} → ${m.article_name}?`)) return; await api.del(`/mappings/${m.id}`); reload(); };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Correlazione esami e materiali</h1><div className="sub">Ogni codice esame di StudioLab consuma uno o più articoli: con questa tabella la produzione mensile diventa consumo di materiale e sostiene la verifica degli ordini e l'ordine automatico delle sedi. Precaricata dal listino esami del 20/10/2026: da validare. Con Synclab: i contenitori visti nei campioni del gestionale propongono le correlazioni (fonte Synclab) e segnalano quelle che non coincidono.</div></div>
        <div className="row">
          <a className="btn ghost" href={`${API_BASE}/mappings/export.xlsx`}><Icon name="download" size={16} />Excel</a>
          <label className="btn ghost"><Icon name="upload" size={16} />Importa (aggiorna)<input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && importFile(e.target.files[0], false)} /></label>
          <label className="btn ghost"><Icon name="upload" size={16} />Importa (sostituisci tutto)<input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && window.confirm('Sostituire l\'intera tabella con il file?') && importFile(e.target.files[0], true)} /></label>
        </div>
      </div>
      <ErrorBox error={err} />
      <Card title="Nuova correlazione" className="mb">
        <form className="row" onSubmit={add}>
          <Field label="Codice esame StudioLab"><input value={f.exam_code} onChange={(e) => setF({ ...f, exam_code: e.target.value })} required style={{ width: 150 }} /></Field>
          <Field label="Descrizione"><input value={f.exam_name} onChange={(e) => setF({ ...f, exam_name: e.target.value })} style={{ width: 220 }} /></Field>
          <Field label="Materiale"><select value={f.article_id} onChange={(e) => setF({ ...f, article_id: e.target.value })} required style={{ minWidth: 280 }}><option value="">Scegli…</option>{(articles.data || []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.unit})</option>)}</select></Field>
          <Field label="Unità per esame"><input type="number" step="0.01" min="0.01" value={f.qty_per_exam} onChange={(e) => setF({ ...f, qty_per_exam: e.target.value })} style={{ width: 110 }} /></Field>
          <button className="btn" style={{ marginTop: 18 }}><Icon name="plus" size={16} />Aggiungi</button>
        </form>
        <div className="small muted" style={{ marginTop: 8 }}>Esempio: 0014 Emocromo → Tappo Viola, 1 provetta. Un esame può consumare più materiali (una riga per ciascuno).</div>
      </Card>
      <Card flush className="mb" title="Contenitori visti nel gestionale (Synclab)" actions={<div className="row">
        <button className="btn sm ghost" disabled={!cont.data?.disponibile} onClick={aggiornaCont}><Icon name="flask" size={16} />Aggiorna i contenitori</button>
        <button className="btn sm" disabled={!cont.data?.disponibile || !(cont.data?.contenitori || []).some((c) => c.articolo_id)} onClick={anteprima}><Icon name="link" size={16} />Proponi correlazioni da Synclab</button></div>}>
        {!cont.data ? <Loading /> : !cont.data.disponibile ? <Empty>{cont.data.motivo}</Empty> : !cont.data.contenitori.length ? <Empty>Nessuna coppia ancora: premi "Aggiorna i contenitori"</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Materiale</th><th>Contenitore</th><th className="num">Campioni</th><th className="num">Esami</th><th>Articolo del catalogo</th></tr></thead>
            <tbody>{cont.data.contenitori.map((c) => <tr key={c.id}><td className="strong">{c.material || <span className="muted">non indicato</span>}</td><td>{c.container || <span className="muted">non indicato</span>}</td><td className="num">{Number(c.osservazioni).toLocaleString('it-IT')}</td><td className="num">{c.esami}</td>
              <td><select value={c.articolo_id || ''} onChange={(e) => abbina(c, e.target.value)} style={{ minWidth: 240 }}><option value="">Non abbinato</option>{(articles.data || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></td></tr>)}</tbody>
          </table></div>)}
        <div className="small muted" style={{ padding: '8px 12px' }}>Coppie materiale/contenitore dei campioni delle accettazioni attive. Abbina ogni coppia all'articolo che la rappresenta (es. SIERO · PROVETTA → Tappo Giallo): "Proponi correlazioni da Synclab" crea o aggiorna, per gli esami il cui contenitore più frequente è abbinato, le correlazioni con fonte Synclab; quelle manuali o del listino non si toccano.</div>
      </Card>
      <Card flush title={`${shown.length} correlazioni`} actions={<input placeholder="Cerca esame o materiale" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />}>
        {!data ? <Loading /> : !shown.length ? <Empty>Nessuna correlazione: la verifica con la produzione non è ancora possibile</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Codice esame</th><th>Descrizione</th><th>Materiale</th><th className="num">Unità per esame</th><th>Fonte</th><th>Dal gestionale</th><th /></tr></thead>
            <tbody>{shown.slice(0, 500).map((m) => { const g = G[m.exam_code]; const f = FONTE[m.source] || [m.source || 'Manuale', 'grey']; return <tr key={m.id}><td className="mono strong">{m.exam_code}</td><td>{descr(m)}</td><td>{m.article_name} <span className="muted small">({m.unit})</span></td><td className="num">{Number(m.qty_per_exam).toLocaleString('it-IT')}</td>
              <td><Badge tone={f[1]}>{f[0]}</Badge></td>
              <td className="small">{g ? <>{[g.material, g.container].filter(Boolean).join(' · ') || 'non indicato'} <span className="muted">{g.pct?.toLocaleString('it-IT')}% di {g.tot}</span>{diverso(m) && <> <Badge tone="red">diverso: {g.article_name}</Badge></>}</> : <span className="muted">–</span>}</td>
              <td className="num"><button className="iconbtn" onClick={() => del(m)} aria-label="Elimina"><Icon name="trash" size={16} /></button></td></tr>; })}</tbody>
          </table>{shown.length > 500 && <div className="empty">Mostrate le prime 500: usa la ricerca o scarica l'Excel</div>}</div>
        )}
      </Card>
      {prop && <Modal title="Proposta di correlazioni da Synclab" onClose={() => setProp(null)} wide footer={<><button className="btn ghost" onClick={() => setProp(null)}>Annulla</button><button className="btn" disabled={!(prop.sintesi.nuove + prop.sintesi.cambiano)} onClick={applica}>Applica {prop.sintesi.nuove + prop.sintesi.cambiano} correlazioni</button></>}>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}><Badge tone="green">{prop.sintesi.nuove} nuove</Badge><Badge tone="blue">{prop.sintesi.cambiano} cambiano</Badge><Badge tone="red">{prop.sintesi.conflitti} in conflitto con una manuale (non toccate)</Badge><Badge tone="grey">{prop.sintesi.invariate + prop.sintesi.coincidono} già a posto</Badge>{prop.sintesi.esami_senza_abbinamento > 0 && <Badge tone="grey">{prop.sintesi.esami_senza_abbinamento} esami con il contenitore non abbinato</Badge>}</div>
        <div className="table-wrap" style={{ maxHeight: 420 }}><table className="t"><thead><tr><th>Esame</th><th>Contenitore più frequente</th><th>Proposta</th><th>Attuale</th><th>Esito</th></tr></thead>
          <tbody>{prop.voci.filter((v) => v.esito !== 'INVARIATA' && v.esito !== 'COINCIDE').map((v) => <tr key={v.exam_code}><td><span className="mono strong">{v.exam_code}</span> <span className="small">{v.descrizione}</span></td><td className="small">{[v.material, v.container].filter(Boolean).join(' · ')} · {v.pct}% ({v.osservazioni})</td><td>{v.articolo}</td><td className="small">{v.attuale || '–'}</td>
            <td><Badge tone={v.esito === 'NUOVA' ? 'green' : v.esito === 'CAMBIA' ? 'blue' : 'red'}>{v.esito === 'NUOVA' ? 'nuova' : v.esito === 'CAMBIA' ? 'cambia' : 'conflitto: resta la manuale'}</Badge></td></tr>)}</tbody></table></div>
      </Modal>}
    </div>
  );
}
