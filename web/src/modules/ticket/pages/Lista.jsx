// Elenco dei ticket con filtri e ricerca. Preset: miei (richiesti da me o osservati), gestione (caselle di cui sono responsabile),
// archivio (tutti i ticket visibili). Esportazione XLSX con gli stessi filtri.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiBase, base, qs, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Field, Pager, SearchInput } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { StatoBadge, PrioBadge, UnitSelect } from '../components.jsx';
import { STATO, PRIORITA, itDateTime, residuo } from '../format.js';

const PRESET = {
  miei: { title: 'I miei ticket', icon: 'user', sub: 'I ticket che hai aperto o che osservi: segui lo stato, rispondi ai commenti, conferma la chiusura o riapri.', fixed: { mine: 1 }, defaults: { aperti: '1' } },
  gestione: { title: 'Da gestire', icon: 'users', sub: 'I ticket delle caselle di cui sei responsabile (e di quelle sotto), quelli assegnati a te e le escalation arrivate alla tua casella.', fixed: { gestiti: 1 }, defaults: { aperti: '1' } },
  archivio: { title: 'Archivio', icon: 'folder', sub: 'Tutti i ticket che puoi vedere, chiusi compresi. La ricerca legge protocollo, titolo e descrizione.', fixed: {}, defaults: {} },
};

export default function Lista({ preset = 'archivio' }) {
  const P = PRESET[preset];
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [text, setText] = useState(sp.get('q') || '');
  const [q, setQ] = useState(text);
  const [stato, setStato] = useState(sp.get('stato') || '');
  const [aperti, setAperti] = useState(sp.get('stato') ? '' : sp.get('aperti') ?? P.defaults.aperti ?? '');
  const [priorita, setPriorita] = useState(sp.get('priorita') || '');
  const [categoria, setCategoria] = useState(sp.get('categoria') || '');
  const [unitId, setUnitId] = useState(sp.get('unit_id') ? Number(sp.get('unit_id')) : null);
  const [sforati, setSforati] = useState(sp.get('sforati') || '');
  const [anno, setAnno] = useState(sp.get('anno') || '');
  const [perConto, setPerConto] = useState(sp.get('per_conto') || '');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, stato, aperti, priorita, categoria, unitId, sforati, anno, perConto]);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  useEffect(() => { setStato(sp.get('stato') || ''); setSforati(sp.get('sforati') || ''); if (sp.get('stato')) setAperti(''); }, [sp]);
  const cat = useApi('/catalogo');
  const filters = { ...P.fixed, q, stato, aperti, priorita, categoria, unit_id: unitId || '', sforati, anno, per_conto: perConto };
  const url = `/tickets${qs({ ...filters, page, pageSize: 25 })}`;
  const { data, loading, error } = useApi(url, [url]);
  const anni = useMemo(() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2]; }, []);
  return (
    <div className="page">
      <PageHead title={P.title} icon={P.icon} sub={P.sub} actions={<><a className="btn ghost" href={`${apiBase}/export/tickets.xlsx${qs(filters)}`} target="_blank" rel="noopener"><Icon name="sheet" />XLSX</a><Link className="btn" to={`${base}/nuovo`}><Icon name="plus" />Nuovo ticket</Link></>} />
      <div className="filters">
        <div style={{ minWidth: 280, flex: 1 }}><SearchInput value={text} onChange={setText} placeholder="Cerca per protocollo, titolo o parole della descrizione" /></div>
        <Field label="Stato"><select value={aperti === '1' ? '__aperti' : stato} onChange={(e) => { const v = e.target.value; if (v === '__aperti') { setAperti('1'); setStato(''); } else { setAperti(''); setStato(v); } }}><option value="">Tutti</option><option value="__aperti">Non chiusi</option>{Object.entries(STATO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Priorità"><select value={priorita} onChange={(e) => setPriorita(e.target.value)}><option value="">Tutte</option>{Object.entries(PRIORITA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Categoria"><select value={categoria} onChange={(e) => setCategoria(e.target.value)}><option value="">Tutte</option>{(cat.data?.categorie || []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
        <Field label="Casella (con le sottostanti)" className="tk-f-unit"><UnitSelect units={cat.data?.unita || []} value={unitId} onChange={setUnitId} emptyLabel="Tutte le caselle" /></Field>
        <Field label="Per conto di"><select value={perConto} onChange={(e) => setPerConto(e.target.value)}><option value="">Tutte le strutture</option><optgroup label="Sedi TD">{(cat.data?.sedi || []).map((s) => <option key={`s${s.id}`} value={`site:${s.id}`}>{s.name}</option>)}</optgroup><optgroup label="Legal entity">{(cat.data?.organizzazioni || []).map((o) => <option key={`o${o.id}`} value={`org:${o.id}`}>{o.name}</option>)}</optgroup></select></Field>
        <Field label="Anno"><select value={anno} onChange={(e) => setAnno(e.target.value)}><option value="">Tutti</option>{anni.map((a) => <option key={a} value={a}>{a}</option>)}</select></Field>
        <label className="tk-check"><input type="checkbox" checked={sforati === '1'} onChange={(e) => setSforati(e.target.checked ? '1' : '')} /> Solo SLA sforati</label>
      </div>
      <Card flush>
        {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data && loading ? <Loading /> : !data?.rows?.length ? <Empty icon="search" title={q ? 'Nessun ticket corrisponde alla ricerca' : 'Nessun ticket'}>{q ? 'Prova con parole diverse o togli i filtri.' : preset === 'gestione' ? 'Nessun ticket da gestire con questi filtri.' : 'Nessun ticket con questi filtri.'}</Empty> : (
          <div className="table-wrap"><table className="t tk-table">
            <thead><tr><th>Protocollo</th><th>Titolo</th><th>Categoria</th><th>Casella</th><th>Richiedente</th><th>Per conto di</th><th>Priorità</th><th>Stato</th><th>Assegnatario</th><th>Risoluzione</th><th>Aperto</th></tr></thead>
            <tbody>{data.rows.map((t) => (
              <tr key={t.id} className="click" onClick={() => nav(`${base}/${t.id}`)}>
                <td className="tk-prot">{t.protocollo}{t.escalation_unit_id && <div className="small tk-late">escalation</div>}</td>
                <td style={{ minWidth: 240 }}><div className="strong">{t.riservato && <Icon name="lock" title="Riservato" />} {t.titolo}</div>{t.riaperture > 0 && <div className="small muted">riaperto {t.riaperture} {t.riaperture === 1 ? 'volta' : 'volte'}</div>}</td>
                <td className="small">{t.categoria_nome}</td>
                <td className="small" title={t.unit_path}>{t.unit_nome}</td>
                <td className="small">{t.richiedente_nome}</td>
                <td className="small">{t.per_conto || <span className="muted">-</span>}</td>
                <td><PrioBadge priorita={t.priorita} /></td>
                <td><StatoBadge stato={t.stato} /></td>
                <td className="small">{t.assegnatario_nome || <span className="muted">-</span>}</td>
                <td className={`small ${t.sla_risoluzione_in_ritardo || t.sla_risoluzione_sforato ? 'tk-late' : ''}`} style={{ whiteSpace: 'nowrap' }}>{t.risolto_at ? (t.sla_risoluzione_sforato ? 'fuori tempo' : 'nei tempi') : t.stato === 'IN_ATTESA' ? 'congelata' : ['CHIUSO', 'ANNULLATO'].includes(t.stato) ? '-' : residuo(t.sla_risoluzione_scadenza)}</td>
                <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{itDateTime(t.created_at)}</td>
              </tr>))}</tbody>
          </table></div>)}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </Card>
    </div>
  );
}
