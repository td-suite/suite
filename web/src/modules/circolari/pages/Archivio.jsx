import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { base, qs, useApi } from '../api.js';
import { useAuth, canEdit } from '../auth.jsx';
import { Card, Loading, Empty, Badge, PageHead, Field, Pager, SearchInput } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { STATO, SEGMENTO, itDate } from '../format.js';

export default function Archivio({ preset = {}, title = 'Archivio e ricerca' }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [text, setText] = useState(q);
  const [stato, setStato] = useState(preset.stato || sp.get('stato') || '');
  const [anno, setAnno] = useState(sp.get('anno') || '');
  const [segmento, setSegmento] = useState(sp.get('segmento') || '');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, stato, anno, segmento]);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  const url = `/circolari${qs({ q, stato, anno, segmento, page, pageSize: 25 })}`;
  const { data, loading, error } = useApi(url, [url]);
  const anni = useApi('/circolari/riepilogo');
  const sub = preset.stato === 'BOZZA' ? 'Circolari in lavorazione: si completano, si impaginano in anteprima e si pubblicano con il protocollo.' : 'La ricerca legge il contenuto delle circolari (titolo, sintesi, corpo, tabelle, testo della bozza di origine), non solo il titolo. Le circolari superate e annullate restano in archivio.';
  return (
    <div className="page">
      <PageHead title={title} icon={preset.stato === 'BOZZA' ? 'edit' : 'folder'} sub={sub} actions={canEdit(user) && <Link className="btn" to={`${base}/nuova`}><Icon name="plus" />Nuova circolare</Link>} />
      <div className="filters">
        <div style={{ minWidth: 320, flex: 1 }}><SearchInput value={text} onChange={setText} placeholder="Cerca nel contenuto: parole, protocollo, esami, date" autoFocus /></div>
        {!preset.stato && <Field label="Stato"><select value={stato} onChange={(e) => setStato(e.target.value)}><option value="">Tutte</option>{Object.entries(STATO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>}
        <Field label="Anno"><select value={anno} onChange={(e) => setAnno(e.target.value)}><option value="">Tutti</option>{(anni.data?.anni || []).map((a) => <option key={a.anno} value={a.anno}>{a.anno}</option>)}</select></Field>
        <Field label="Destinatari"><select value={segmento} onChange={(e) => setSegmento(e.target.value)}><option value="">Tutti</option>{Object.entries(SEGMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      <Card flush>
        {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data && loading ? <Loading /> : !data?.rows?.length ? <Empty icon="search" title={q ? 'Nessuna circolare contiene questi termini' : 'Nessuna circolare'}>{q ? 'Prova con parole diverse o togli i filtri.' : preset.stato === 'BOZZA' ? 'Nessuna bozza in lavorazione.' : 'L\'archivio è vuoto.'}</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Protocollo</th><th>Circolare</th><th>Destinatari</th><th>Data</th><th>Stato</th><th>File</th></tr></thead>
            <tbody>{data.rows.map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`${base}/${c.id}`)}>
                <td className="circ-prot">{c.protocollo || <span className="muted" style={{ fontWeight: 500 }}>bozza</span>}{c.revisione > 0 && c.protocollo && <div className="small muted">rev. {c.revisione}</div>}</td>
                <td style={{ minWidth: 320 }}><div className="strong">{c.titolo}</div><div className="small muted">{c.tipo} · {c.linea}{c.sorgente_nome ? ` · da ${c.sorgente_nome}` : ''}</div>{c.snippet && <div className="circ-snippet" dangerouslySetInnerHTML={{ __html: c.snippet }} />}</td>
                <td className="small">{SEGMENTO[c.segmento] || c.segmento}</td>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>{itDate(c.data)}</td>
                <td><Badge tone={STATO[c.stato].tone}>{STATO[c.stato].label}</Badge></td>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>{c.has_pdf && <Icon name="pdf" title="PDF" />} {c.has_docx && <Icon name="doc" title="Word" />} {c.orientamento_eff === 'ORIZZONTALE' && <span className="muted">orizz.</span>}</td>
              </tr>))}</tbody>
          </table></div>)}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </Card>
    </div>
  );
}
