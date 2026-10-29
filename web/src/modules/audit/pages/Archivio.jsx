// Archivio: tutti gli audit con filtri (tipo, sede/Legal entity, stato, periodo, testo), cestino a fine riga con conferma,
// download Excel (Archivio, Punteggi per sezione, NC) e PDF della lista filtrata.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiBase, base, qs, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Field, SearchInput, ConfirmModal, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isQualita, isSite } from '../index.jsx';
import { KindBadge, StatusBadge, ScoreCell, Level } from '../components/Score.jsx';
import { KIND, STATUS, dataAudit, soggetto } from '../format.js';

export default function Archivio() {
  const { user } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [site, setSite] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const filters = { q, kind, status, site_id: site, from, to };
  const url = `/archivio${qs(filters)}`;
  const { data, loading, error, reload } = useApi(url, [url]);
  const sites = useApi('/sites');
  const [del, setDel] = useState(null);
  const canDel = (a) => (isQualita(user) ? true : ['CHIUSO', 'VERIFICATO'].includes(a.status) ? false : isSite(user) ? a.kind === 'AUTO' && a.status === 'BOZZA' : true);
  const elimina = async (a) => { try { await api.del(`/audits/${a.id}`); toast('Audit eliminato'); window.dispatchEvent(new Event('suite:badges')); reload(); } catch (e) { toast(e, 'err'); throw e; } };
  return (
    <div className="page">
      <PageHead title="Archivio" icon="folder" sub="Tutti gli audit: auto-audit, interni, terze parti e partner ISO 37001. Il cestino a fine riga elimina la riga (gli audit chiusi o verificati solo Qualità; il site manager solo le proprie bozze)."
        actions={<><a className="btn sm ghost" href={`${apiBase}/archivio.xlsx${qs(filters)}`}><Icon name="sheet" />Excel</a><a className="btn sm ghost" href={`${apiBase}/archivio.pdf${qs({ ...filters, inline: 1 })}`} target="_blank" rel="noopener"><Icon name="pdf" />PDF</a></>} />
      <div className="au-filters">
        <div style={{ minWidth: 260, flex: 1 }}><SearchInput value={text} onChange={setText} placeholder="Cerca per sede, partner, ente, auditor, osservazioni" /></div>
        <Field label="Tipo"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Tutti</option>{Object.entries(KIND).filter(([k]) => !(isSite(user) && k === 'LEGAL_ENTITY')).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Sede"><select value={site} onChange={(e) => setSite(e.target.value)}><option value="">Tutte</option>{(sites.data?.rows || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Stato"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tutti</option>{Object.entries(STATUS).filter(([k]) => k !== 'MANCANTE').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Dal"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Al"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Card flush>
        {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data && loading ? <Loading /> : !data?.length ? <Empty icon="folder" title={q || kind || status || site ? 'Nessun audit corrisponde ai filtri' : 'Archivio vuoto'}>{q || kind || status ? 'Prova con filtri diversi.' : 'Gli audit compaiono qui appena creati.'}</Empty> : (
          <div className="table-wrap"><table className="t au-table">
            <thead><tr><th>Data / mese</th><th>Tipo</th><th>Sede / partner</th><th>Condotto da</th><th>Stato</th><th>Punteggio</th><th>Livello</th><th>NC</th><th>File</th><th></th></tr></thead>
            <tbody>{data.map((a) => <tr key={a.id}>
              <td><Link className="strong" to={`${base}/audit/${a.id}`}>{dataAudit(a)}</Link></td><td><KindBadge k={a.kind} /></td><td>{soggetto(a)}{a.kind === 'TERZI' && a.third_party?.ente && <div className="small muted">{a.third_party.ente}</div>}</td>
              <td className="small">{a.kind === 'TERZI' ? a.third_party?.ente_tipo : (a.header?.effettuato_da || a.conducted_by_name || '–')}</td><td><StatusBadge s={a.status} /></td><td><ScoreCell a={a} /></td><td><Level letter={a.level} short /></td><td>{a.n_nc || 0}</td><td>{a.n_files || 0}</td>
              <td className="actions au-acts"><a className="iconbtn" href={`${apiBase}/audits/${a.id}/export.xlsx`} title="Excel del singolo audit"><Icon name="sheet" /></a><a className="iconbtn" href={`${apiBase}/audits/${a.id}/export.pdf?inline=1`} target="_blank" rel="noopener" title="PDF del singolo audit"><Icon name="pdf" /></a>{canDel(a) ? <button className="iconbtn trash" title="Elimina" onClick={() => setDel(a)}><Icon name="trash" /></button> : <span className="iconbtn" style={{ visibility: 'hidden' }} />}</td>
            </tr>)}</tbody>
          </table></div>)}
      </Card>
      <div className="small muted" style={{ marginTop: 8 }}>{data ? `${data.length} audit` : ''}</div>
      {del && <ConfirmModal title="Elimina l'audit" danger confirmText="Elimina" text={`${del.kind_label} · ${soggetto(del)} · ${dataAudit(del)}: la riga viene eliminata dall'archivio (cestino, eliminazione logica tracciata nel registro della Suite).`} onConfirm={() => elimina(del)} onClose={() => setDel(null)} />}
    </div>
  );
}
