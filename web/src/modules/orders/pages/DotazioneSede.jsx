import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, API_BASE, BASE } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Field, Loading, ErrorBox, Card, Badge, Icon, Modal, useToast } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { itDate, itDateTime, today, SITE_KIND, ORG_KIND } from '../format.js';
import { ArticlePicker, STATO_DOTAZIONE, giorniLabel } from './Dotazione.jsx';

// Scheda della dotazione di avvio di una sede o Legal entity: parte dal modello della tipologia ("Genera dal modello"), si adatta
// alla singola struttura (aggiungi, togli, cambia quantità), "Salva piano", ordine facoltativo al Magazzino Centrale, stampa PDF e
// "Registra la Giacenza 0" (confezioni INIZIALE in giacenza alla data scelta); "Annulla Giacenza 0" solo super amministratore.
export default function DotazioneSede() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const toast = useToast();
  const { data, error, reload } = useApi(`/dotazione/sedi/${id}`, [id]);
  const [det, setDet] = useState(null);
  const [lines, setLines] = useState([]);
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState(null);
  const [g0, setG0] = useState(null);
  const [confirm, setConfirm] = useState(null);
  useEffect(() => { if (data) apply(data); }, [data]);
  function apply(d) { setDet(d); setLines(d.lines.map((l) => ({ ...l }))); setNote(d.load?.note || ''); setDirty(false); window.dispatchEvent(new Event('suite:badges')); }
  const run = async (fn, msg) => { setErr(null); try { const r = await fn(); const d = r?.dettaglio || (r?.struttura ? r : null); if (d) apply(d); else reload(); if (msg) toast(typeof msg === 'function' ? msg(r) : msg); return r; } catch (e) { setErr(e); return null; } };
  if (error) return <div className="page"><ErrorBox error={error} /><Link to={`${BASE}/dotazione?tab=sedi`}>Torna alle sedi</Link></div>;
  if (!det) return <div className="page"><Loading /></div>;
  const s = det.struttura;
  const st = STATO_DOTAZIONE[s.stato];
  const locked = s.stato === 'CONSEGNATA';
  const setLine = (i, k, v) => { setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l))); setDirty(true); };
  const add = (a) => { setLines((ls) => [...ls, { article_id: a.id, article_name: a.article_name, pack_label: a.pack_label, icon: a.icon, color: a.color, silva_code: a.silva_code, article_code: a.article_code, category_name: a.category_name, packs_planned: 1, lot: '', expiry: '', note: '' }]); setDirty(true); };
  const tot = lines.reduce((a, l) => a + (Number(l.packs_planned) || 0), 0);
  const savePlan = () => run(() => api.put(`/dotazione/sedi/${s.id}/piano`, { note: note || null, lines: lines.map((l) => ({ article_id: l.article_id, packs_planned: Number(l.packs_planned) || 0, lot: l.lot || null, expiry: l.expiry || null, note: l.note || null })) }), 'Piano salvato');
  const genera = () => run(() => api.post(`/dotazione/sedi/${s.id}/genera`), (r) => `Generato dal modello ${det.modello.name}: ${r.lines.length} articoli`);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="small"><Link to={`${BASE}/dotazione?tab=sedi`}>‹ Dotazione di avvio sedi</Link></div>
          <h1>{s.name}</h1>
          <div className="sub">{s.origin === 'ORG' ? <>Legal entity · {ORG_KIND[s.org_kind] || s.org_kind}</> : <>Sede · {SITE_KIND[s.site_kind] || s.site_kind}</>} · <span className="mono">{s.code}</span>{s.city ? ` · ${s.city}` : ''} · tipologia <b>{s.tipologia_name}</b></div>
        </div>
        <div className="row">
          <Badge tone={st.tone}>{st.label}</Badge>
          <a className="btn ghost" href={`${API_BASE}/dotazione/sedi/${s.id}/pdf`} target="_blank" rel="noreferrer" onClick={(e) => { if (!det.lines.length) { e.preventDefault(); setErr(new Error('Salva prima il piano: la stampa usa le righe salvate')); } }}><Icon name="download" size={16} />Stampa PDF</a>
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card kpi accent">
          <div className="lbl">{s.origin === 'ORG' ? 'Data di avvio del rapporto' : 'Data di effettiva apertura'}</div>
          <input type="date" value={s.opened_at || ''} onChange={(e) => run(() => api.put(`/dotazione/sedi/${s.id}/apertura`, { opened_at: e.target.value || null }), s.origin === 'ORG' ? 'Data di avvio salvata' : 'Data di apertura salvata in anagrafica')} style={{ marginTop: 6 }} />
          <div className="foot">{giorniLabel(s.giorni) || 'da indicare'}{s.origin === 'SITE' && <> · <Link to="/admin/sites" style={{ color: 'inherit', textDecoration: 'underline' }}>Amministrazione › Sedi</Link></>}</div>
        </div>
        <div className="card kpi"><div className="lbl">Confezioni pianificate</div><div className="val">{det.totali.pianificate}</div><div className="foot">{det.totali.articoli} articoli{det.load?.planned_at ? ` · piano del ${itDateTime(det.load.planned_at)}${det.load.planned_by_name ? ` (${det.load.planned_by_name})` : ''}` : ''}</div></div>
        <div className="card kpi"><div className="lbl">Ordine al Magazzino Centrale</div><div className="val" style={{ fontSize: 18 }}>{s.order_id ? <Link to={`${BASE}/ordini/${s.order_id}`}>{s.order_number}</Link> : '–'}</div><div className="foot">facoltativo: ordine in bozza con le righe pianificate</div></div>
        <div className="card kpi"><div className="lbl">Giacenza 0</div><div className="val" style={{ fontSize: 18 }}>{det.load?.delivered_at ? itDate(det.load.delivered_at) : 'da registrare'}</div><div className="foot">{det.load?.delivered_at ? <>{det.totali.consegnate} confezioni · {det.load.delivered_by_name} · <Link to={`${BASE}/giacenza?struttura_id=${s.id}`}>Giacenza della struttura</Link></> : 'confezioni in giacenza alla consegna'}</div></div>
      </div>

      <Card title={`Materiale di avvio${dirty ? ' · modifiche non salvate' : ''}`} flush actions={!locked && <div className="row">
        <button className="btn ghost sm" onClick={() => (lines.length ? setConfirm('genera') : genera())} title={`${det.modello.lines} articoli, ${det.modello.packs} confezioni nel modello`}><Icon name="refresh" size={15} />Genera dal modello {det.modello.name}</button>
        <button className="btn sm" disabled={!lines.length} onClick={savePlan}><Icon name="check" size={15} />Salva piano</button>
      </div>}>
        {!locked && <div className="row" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}><ArticlePicker onPick={add} exclude={lines.map((l) => l.article_id)} /><div className="small muted">{lines.length} articoli · {tot} confezioni</div></div>}
        {!lines.length ? <div className="empty">Nessuna riga: "Genera dal modello" copia l'elenco della tipologia {det.modello.name} ({det.modello.lines} articoli), poi si adatta alla struttura.</div> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Articolo</th><th className="num" style={{ width: 100 }}>Confezioni</th>{locked && <th className="num">Consegnate</th>}<th>Lotto</th><th>Scadenza</th><th>Note</th>{!locked && <th />}</tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={l.article_id}>
                <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt icon={l.icon} color={l.color} size={34} /><div><div className="strong">{l.article_name}</div><div className="small muted">{l.pack_label} · <span className="mono">{l.silva_code || l.article_code}</span></div></div></div></td>
                <td className="num">{locked ? <span className="strong">{l.packs_planned}</span> : <input className={`qin ${det.lines.find((x) => x.article_id === l.article_id)?.packs_planned !== Number(l.packs_planned) ? 'changed' : ''}`} inputMode="numeric" value={l.packs_planned} onChange={(e) => setLine(i, 'packs_planned', e.target.value.replace(/\D/g, ''))} />}</td>
                {locked && <td className="num strong">{l.packs_delivered ?? '–'}</td>}
                <td>{locked ? <span className="mono small">{l.lot || '–'}</span> : <input value={l.lot || ''} placeholder="facoltativo" onChange={(e) => setLine(i, 'lot', e.target.value)} style={{ maxWidth: 120 }} />}</td>
                <td>{locked ? <span className="small">{itDate(l.expiry) || '–'}</span> : <input type="date" value={l.expiry || ''} onChange={(e) => setLine(i, 'expiry', e.target.value)} style={{ maxWidth: 150 }} />}</td>
                <td>{locked ? <span className="small">{l.note || ''}</span> : <input value={l.note || ''} onChange={(e) => setLine(i, 'note', e.target.value)} />}</td>
                {!locked && <td className="num"><button className="btn sm ghost danger" onClick={() => { setLines((ls) => ls.filter((_, j) => j !== i)); setDirty(true); }}>Togli</button></td>}
              </tr>))}</tbody>
          </table></div>
        )}
        {!locked && <div style={{ padding: '10px 14px' }}><Field label="Note del piano"><input value={note} onChange={(e) => { setNote(e.target.value); setDirty(true); }} placeholder="es. consegna con il primo giro logistico" /></Field></div>}
      </Card>

      <Card title="Consegna" className="mt">
        <div className="row">
          {s.stato !== 'NON_PIANIFICATA' && !locked && (!s.order_id || s.order_status === 'ANNULLATO') && <button className="btn ghost" disabled={dirty} title={dirty ? 'Salva prima il piano' : ''} onClick={() => setConfirm('ordine')}><Icon name="send" size={16} />Crea ordine al Magazzino Centrale</button>}
          {s.stato === 'PIANIFICATA' && <button className="btn" disabled={dirty} title={dirty ? 'Salva prima il piano' : ''} onClick={() => setG0({ date: s.opened_at || today(), lines: det.lines.map((l) => ({ article_id: l.article_id, article_name: l.article_name, icon: l.icon, color: l.color, pack_label: l.pack_label, packs_delivered: l.packs_planned, lot: l.lot || '', expiry: l.expiry || '' })) })}><Icon name="check" size={16} />Registra la Giacenza 0</button>}
          {locked && sup && <button className="btn danger ghost" onClick={() => setConfirm('annulla')}>Annulla Giacenza 0</button>}
          {locked && <Link className="btn ghost" to={`${BASE}/giacenza?struttura_id=${s.id}`}><Icon name="orders" size={16} />Giacenza per struttura</Link>}
          {s.stato === 'NON_PIANIFICATA' && <div className="small muted">Salva il piano per creare l'ordine o registrare la Giacenza 0.</div>}
        </div>
        {locked && <div className="small muted" style={{ marginTop: 8 }}>Giacenza 0 registrata il {itDate(det.load.delivered_at)}: {det.packages.ricevute} confezioni ancora in giacenza{det.packages.movimentate ? `, ${det.packages.movimentate} già messe in uso o rettificate` : ''}. Il piano non è più modificabile.</div>}
      </Card>

      {confirm === 'genera' && <Modal title="Genera dal modello" onClose={() => setConfirm(null)} footer={<><button className="btn ghost" onClick={() => setConfirm(null)}>Annulla</button><button className="btn" onClick={async () => { setConfirm(null); await genera(); }}>Sostituisci le righe</button></>}>
        <p className="small">Le righe attuali ({lines.length}) vengono sostituite dal modello {det.modello.name} ({det.modello.lines} articoli, {det.modello.packs} confezioni). Le modifiche fatte per questa struttura si perdono.</p></Modal>}
      {confirm === 'ordine' && <Modal title="Ordine al Magazzino Centrale" onClose={() => setConfirm(null)} footer={<><button className="btn ghost" onClick={() => setConfirm(null)}>Annulla</button><button className="btn" onClick={async () => { setConfirm(null); const r = await run(() => api.post(`/dotazione/sedi/${s.id}/ordine`), (x) => `Ordine ${x.number} creato in bozza`); if (r) nav(`${BASE}/ordini/${r.id}`); }}>Crea l'ordine</button></>}>
        <p className="small">Si crea un ordine in bozza per {s.name} con le {det.totali.articoli} righe pianificate ({det.totali.pianificate} confezioni) e nota "Dotazione di avvio". L'ordine segue poi il flusso normale: verifica, approvazione, trasmissione al Magazzino Centrale.</p></Modal>}
      {confirm === 'annulla' && <Modal title="Annulla Giacenza 0" onClose={() => setConfirm(null)} footer={<><button className="btn ghost" onClick={() => setConfirm(null)}>Indietro</button><button className="btn danger" onClick={async () => { setConfirm(null); await run(() => api.post(`/dotazione/sedi/${s.id}/annulla-giacenza-zero`), (r) => `Giacenza 0 annullata: ${r.tolte} confezioni tolte${r.restano_movimentate ? `, ${r.restano_movimentate} già movimentate restano` : ''}`); }}>Annulla la Giacenza 0</button></>}>
        <p className="small">Si tolgono le {det.packages.ricevute} confezioni della Giacenza 0 ancora in giacenza; quelle già messe in uso o rettificate restano. Il piano torna "Pianificata" e si può registrare di nuovo.</p></Modal>}
      {g0 && (
        <Modal wide title={`Registra la Giacenza 0 · ${s.name}`} onClose={() => setG0(null)} footer={<><button className="btn ghost" onClick={() => setG0(null)}>Annulla</button><button className="btn" onClick={async () => { const body = { date: g0.date, lines: g0.lines.map((l) => ({ article_id: l.article_id, packs_delivered: Number(l.packs_delivered) || 0, lot: l.lot || null, expiry: l.expiry || null })) }; const r = await run(() => api.post(`/dotazione/sedi/${s.id}/giacenza-zero`, body), (x) => `Giacenza 0 registrata: ${x.confezioni} confezioni`); if (r) setG0(null); }}>Registra {g0.lines.reduce((a, l) => a + (Number(l.packs_delivered) || 0), 0)} confezioni</button></>}>
          <ErrorBox error={err} />
          <div className="row" style={{ marginBottom: 10 }}><Field label="Data di consegna"><input type="date" value={g0.date} onChange={(e) => setG0({ ...g0, date: e.target.value })} /></Field><div className="small muted" style={{ maxWidth: 520 }}>Le confezioni entrano nella giacenza della struttura con questa data (carico iniziale, origine INIZIALE). Lotto e scadenza sono facoltativi. La registrazione non è ripetibile.</div></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Articolo</th><th className="num">Consegnate</th><th>Lotto</th><th>Scadenza</th></tr></thead>
            <tbody>{g0.lines.map((l, i) => { const set = (k, v) => setG0({ ...g0, lines: g0.lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }); return (
              <tr key={l.article_id}>
                <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt icon={l.icon} color={l.color} size={28} /><div><div className="strong small">{l.article_name}</div><div className="small muted">{l.pack_label}</div></div></div></td>
                <td className="num"><input className="qin" inputMode="numeric" value={l.packs_delivered} onChange={(e) => set('packs_delivered', e.target.value.replace(/\D/g, ''))} /></td>
                <td><input value={l.lot} onChange={(e) => set('lot', e.target.value)} style={{ maxWidth: 120 }} /></td>
                <td><input type="date" value={l.expiry} onChange={(e) => set('expiry', e.target.value)} style={{ maxWidth: 150 }} /></td>
              </tr>); })}</tbody>
          </table></div>
        </Modal>
      )}
    </div>
  );
}
