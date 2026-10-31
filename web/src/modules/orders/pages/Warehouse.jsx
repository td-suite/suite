import React, { useMemo, useState } from 'react';
import { api, API_BASE } from '../api.js';
import { useApi, Field, Loading, ErrorBox, Card, Badge, Icon, Modal, useToast } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { PhaseBanner } from '../components/phase.jsx';
import { itDate, itDateTime, dec } from '../format.js';

// Fase 0 · Magazzino Centrale (gestito dal fornitore Silva, letto dall'API Silva): giacenze (lotti, scadenze, quantità) e visibilità
// degli articoli per tipologia di struttura: Tutti, Punti Prelievo, Centro Polidiagnostico, Laboratorio di Analisi, Service
const VIS = [
  { k: 'visible_all', label: 'Tutti', title: 'Visibile a tutte le strutture' },
  { k: 'visible_sedi', label: 'Punti Prelievo', title: 'Punti prelievo' },
  { k: 'visible_poli', label: 'Centro Polidiagnostico', title: 'Centri diagnostici, poliambulatori e centri medici' },
  { k: 'visible_lab', label: 'Laboratorio di Analisi', title: 'Laboratorio di analisi' },
  { k: 'visible_service', label: 'Service', title: 'Clienti service e Legal entity' },
];
const visibile = (r) => VIS.some((v) => r[v.k]);
export default function Warehouse() {
  const toast = useToast();
  const { data, reload } = useApi('/warehouse');
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('STOCK');
  const [detail, setDetail] = useState(null);
  const [sel, setSel] = useState(new Set());
  const rows = useMemo(() => (data?.rows || []).filter((r) => (filter === 'STOCK' ? Number(r.qty) > 0 : filter === 'HIDDEN' ? !visibile(r) : filter === 'NEW' ? r.source === 'SILVA' : true) && (!search || `${r.code} ${r.silva_code || ''} ${r.name}`.toLowerCase().includes(search.toLowerCase()))), [data, filter, search]);
  const setVis = async (r, k, v) => { setErr(null); try { await api.put(`/warehouse/articles/${r.article_id}/visibility`, { [k]: v }); reload(); } catch (e) { setErr(e); } };
  const bulk = async (k, v) => { if (!sel.size) return; setErr(null); try { await api.put('/warehouse/visibility', { ids: [...sel], [k]: v }); toast(`${sel.size} articoli aggiornati`); setSel(new Set()); reload(); } catch (e) { setErr(e); } };
  const [syncing, setSyncing] = useState(false);
  const syncSilva = async (force) => {
    setErr(null); setSyncing(true);
    try { const r = await api.post('/warehouse/silva/sync', { force }); const e = r.esiti || []; toast(e.map((x) => x.error ? `${x.anno}: errore ${x.error}` : x.skipped ? `${x.anno}: ${x.skipped}` : `${x.anno}: ${x.mode === 'COMPLETO' ? 'catalogo completo' : 'modifiche'}, ${x.items ?? 0} articoli${x.newArticles ? `, ${x.newArticles} nuovi` : ''}${x.removed ? `, ${x.removed} eliminati` : ''}`).join(' · ') || 'Nessun anno da sincronizzare', e.some((x) => x.error) ? 'err' : 'ok'); reload(); }
    catch (e) { setErr(e); }
    setSyncing(false);
  };
  const importFile = async (f) => { setErr(null); const fd = new FormData(); fd.append('file', f); try { const r = await api.upload('/warehouse/import', fd); toast(`Feed importato: ${r.items} righe, ${r.newArticles} articoli nuovi${r.errors.length ? `, ${r.errors.length} righe scartate` : ''}`); reload(); } catch (e) { setErr(e); } };
  const Chk = ({ r, k }) => <input type="checkbox" checked={!!r[k]} onChange={(e) => setVis(r, k, e.target.checked)} title={VIS.find((v) => v.k === k)?.title} />;
  return (
    <div className="page">
      <PhaseBanner n="0" title="Magazzino Centrale: materiale a disposizione" desc="Il magazzino centrale (gestito da Silva, letto dall'API Silva) aggiorna le giacenze: articoli, lotti, scadenze, quantità. Qui l'Area Operations decide a quali tipologie di struttura rendere visibile ogni articolo nel catalogo: le strutture vedono solo l'articolo, mai quantità, lotti o scadenze." next="Fase 1: le strutture ordinano dal catalogo" />
      <div className="page-head">
        <div><h1>Magazzino Centrale</h1><div className="sub">{data?.last_feed_at ? `Ultimo aggiornamento dal fornitore: ${itDateTime(data.last_feed_at)}` : 'Nessun aggiornamento ricevuto: leggi il catalogo Silva o importa il file'}{data?.last_poll_at ? ` · ultima lettura ordini: ${itDateTime(data.last_poll_at)}` : ''}</div>
          {data?.silva && <div className="small" style={{ marginTop: 4 }}>{data.silva.api_key ? <>API Silva attiva ({data.silva.base_url}) · anni {data.silva.years.join(', ')} · ogni {data.silva.sync_minutes} min{data.silva.last_sync_at ? <> · ultima lettura {itDateTime(data.silva.last_sync_at)} <Badge tone={data.silva.last_sync_status === 'OK' ? 'green' : 'red'}>{data.silva.last_sync_status || '–'}</Badge></> : ' · mai letta'}{data.silva.key_expires_at && <> · chiave valida fino al {itDate(data.silva.key_expires_at)}{(new Date(data.silva.key_expires_at) - Date.now()) < 30 * 86400000 && <Badge tone="red">{new Date(data.silva.key_expires_at) < Date.now() ? 'scaduta' : 'in scadenza'}: rinnovala su Silva e aggiornala in Connettori</Badge>}</>}{data.silva.last_sync_status === 'ERRORE' && data.silva.last_sync_message && <div className="red">{data.silva.last_sync_message}</div>}</> : <span className="muted">API Silva non attiva: inserisci la chiave X-API-KEY in Amministrazione › Connettori › Silva.</span>}</div>}</div>
        <div className="row">
          <Field label="Cerca"><input placeholder="Codice o descrizione" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <Field label="Mostra"><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="STOCK">Con giacenza</option><option value="ALL">Tutti gli articoli</option><option value="NEW">Creati dal feed</option><option value="HIDDEN">Non visibili a nessuno</option></select></Field>
          {data?.silva?.api_key && <button className="btn" disabled={syncing} onClick={() => syncSilva(false)}><Icon name="refresh" size={16} />{syncing ? 'Lettura in corso' : 'Leggi da Silva'}</button>}
          {data?.silva?.api_key && <button className="btn ghost" disabled={syncing} title="Fotografia completa del catalogo (ignora il riferimento salvato)" onClick={() => syncSilva(true)}>Catalogo completo</button>}
          <a className="btn ghost" href={`${API_BASE}/warehouse/import/template.xlsx`}><Icon name="download" size={16} />Modello</a>
          <label className="btn ghost"><Icon name="upload" size={16} />Importa feed<input type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} /></label>
        </div>
      </div>
      <ErrorBox error={err} />
      {sel.size > 0 && <div className="alert info" style={{ marginBottom: 12 }}><div className="row"><b>{sel.size} selezionati:</b>{VIS.map((v) => <button key={v.k} className="btn sm ghost" onClick={() => bulk(v.k, true)}>{v.k === 'visible_all' ? 'Visibili a tutti' : `+ ${v.label}`}</button>)}<button className="btn sm danger" onClick={async () => { await bulk('visible_all', false); }}>Togli "tutti"</button><button className="btn sm link" onClick={() => setSel(new Set())}>Annulla selezione</button></div></div>}
      <Card flush>
        {!data ? <Loading /> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th><input type="checkbox" checked={rows.length > 0 && rows.every((r) => sel.has(r.article_id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.article_id)) : new Set())} /></th><th>Articolo</th><th>Codice Silva</th><th className="num">Giacenza magazzino</th><th className="num">Lotti</th><th>Prima scadenza</th>{VIS.map((v) => <th key={v.k} title={v.title} style={{ textAlign: 'center', whiteSpace: 'normal', lineHeight: 1.25, width: 92 }}>{v.label}</th>)}<th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.article_id} className={!visibile(r) ? 'warnrow' : ''}>
                <td><input type="checkbox" checked={sel.has(r.article_id)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(r.article_id) : s.delete(r.article_id); setSel(s); }} /></td>
                <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt icon={r.icon} color={r.color} size={30} /><div><div className="strong">{r.name}{r.source === 'SILVA' && <> <Badge tone="mauve">dal feed</Badge></>}</div><div className="small muted">{r.pack_label} · <span className="mono">{r.code}</span></div></div></div></td>
                <td className="mono small">{r.silva_code || <span className="muted">–</span>}</td>
                <td className="num strong">{dec(r.qty, 0)} <span className="small muted">{r.unit}</span></td>
                <td className="num">{r.lots}</td>
                <td className="small">{r.next_expiry ? itDate(r.next_expiry) : '–'}</td>
                {VIS.map((v) => <td key={v.k} style={{ textAlign: 'center' }}><Chk r={r} k={v.k} /></td>)}
                <td className="num"><button className="btn sm ghost" onClick={() => setDetail(r)}>Lotti</button></td>
              </tr>))}</tbody>
          </table>{!rows.length && <div className="empty">Nessun articolo per questo filtro</div>}</div>
        )}
      </Card>
      {data?.feeds?.length > 0 && (
        <Card title="Aggiornamenti ricevuti" className="mt" flush>
          <table className="t"><thead><tr><th>Quando</th><th>Origine</th><th className="num">Righe</th><th className="num">Articoli nuovi</th><th>Righe scartate</th></tr></thead>
            <tbody>{data.feeds.map((f) => <tr key={f.id}><td className="small">{itDateTime(f.received_at)}</td><td className="small">{f.source}</td><td className="num">{f.items}</td><td className="num">{f.new_articles}</td><td className="small red">{f.errors ? f.errors.slice(0, 3).join('; ') + (f.errors.length > 3 ? '…' : '') : ''}</td></tr>)}</tbody></table>
        </Card>
      )}
      {detail && (
        <Modal title={`${detail.name} · lotti in magazzino`} onClose={() => setDetail(null)}>
          {!detail.lot_detail?.length ? <div className="empty">Nessun lotto</div> : (
            <table className="t"><thead><tr><th>Lotto</th><th>Scadenza</th><th className="num">Quantità</th><th>Codice a barre</th></tr></thead>
              <tbody>{detail.lot_detail.map((l, i) => <tr key={i}><td className="mono">{l.lot || '–'}</td><td>{itDate(l.expiry) || '–'}</td><td className="num">{dec(l.qty, 0)}</td><td className="mono small">{l.barcode || '–'}</td></tr>)}</tbody></table>
          )}
        </Modal>
      )}
    </div>
  );
}
