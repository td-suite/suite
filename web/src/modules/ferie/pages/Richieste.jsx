// Elenco dei periodi del piano. Viste: mie (i miei periodi e variazioni), da_approvare (variazioni in attesa dei dipendenti che gestisco;
// ADMIN tutte), tutte (storico: ADMIN e VIEWER tutto, il responsabile solo i dipendenti delle aree che gestisce). Filtri per anno,
// stato, area, ricerca.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { base, qs, useApi } from '../api.js';
import { useAuth, isHr } from '../auth.jsx';
import { Card, Loading, Empty, PageHead, Field, Pager, SearchInput } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { TabellaRichieste } from '../components.jsx';
import { STATO, oggiIso } from '../format.js';

const VISTE = {
  mie: { title: 'I miei periodi', icon: 'list', sub: 'Tutti i periodi dei tuoi piani e le variazioni: apri un periodo per vederne la cronologia.' },
  da_approvare: { title: 'Variazioni da decidere', icon: 'refresh', sub: 'Variazioni ai piani approvati proposte dai dipendenti delle aree che gestisci. L\'avviso di copertura non blocca: decidi tu. I piani da approvare sono nel Piano dell\'area.' },
  tutte: { title: 'Storico dei periodi', icon: 'folder', sub: 'Tutti i periodi che puoi vedere (la tua area, o tutte per l\'amministratore), con filtri per anno, stato e area.' },
};

export default function Richieste({ vista }) {
  const { user } = useAuth();
  const V = VISTE[vista];
  const anno0 = Number(oggiIso().slice(0, 4));
  const [text, setText] = useState(''); const [q, setQ] = useState('');
  const [anno, setAnno] = useState(vista === 'da_approvare' ? '' : String(anno0));
  const [stato, setStato] = useState('');
  const [gruppo, setGruppo] = useState('');
  const [copertura, setCopertura] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  useEffect(() => { setPage(1); }, [q, anno, stato, gruppo, copertura, vista]);
  const gruppi = useApi(vista === 'mie' ? null : '/gruppi');
  const url = `/richieste${qs({ vista, q, anno, stato, gruppo, sotto_copertura: copertura ? '1' : '', page, pageSize: 50 })}`;
  const { data, loading, error } = useApi(url, [url]);
  const anni = useMemo(() => [anno0 + 1, anno0, anno0 - 1, anno0 - 2], [anno0]);
  return (
    <div className="page">
      <PageHead title={V.title} icon={V.icon} sub={V.sub} actions={vista === 'mie' ? <Link className="btn" to={base}><Icon name="calendar" />Il mio piano</Link> : null} />
      <div className="filters">
        {vista !== 'mie' && <div style={{ minWidth: 240, flex: 1 }}><SearchInput value={text} onChange={setText} placeholder="Cerca per persona o note" /></div>}
        <Field label="Anno"><select value={anno} onChange={(e) => setAnno(e.target.value)}><option value="">Tutti</option>{anni.map((a) => <option key={a} value={a}>{a}</option>)}</select></Field>
        {vista !== 'da_approvare' && <Field label="Stato"><select value={stato} onChange={(e) => setStato(e.target.value)}><option value="">Tutti</option>{Object.entries(STATO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>}
        {vista !== 'mie' && <Field label="Area"><select value={gruppo} onChange={(e) => setGruppo(e.target.value)}><option value="">Tutte</option>{(gruppi.data?.gruppi || []).map((g) => <option key={g.key} value={g.key}>{g.area === 'Sedi' ? `Sede ${g.nome}` : g.nome}</option>)}</select></Field>}
        {vista !== 'mie' && <label className="fe-check"><input type="checkbox" checked={copertura} onChange={(e) => setCopertura(e.target.checked)} /> Solo sotto copertura</label>}
      </div>
      <Card flush>
        {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data && loading ? <Loading /> : (
          <TabellaRichieste rows={data?.rows} mostraPersona={vista !== 'mie'} mostraArea={vista !== 'mie'} vuoto={vista === 'da_approvare' ? 'Nessuna variazione in attesa' : 'Nessun periodo con questi filtri'} />)}
        {data && data.total > data.pageSize && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </Card>
      {vista === 'da_approvare' && isHr(user) && <div className="small muted" style={{ marginTop: 8 }}>Come amministratore vedi le variazioni di tutte le aree e puoi decidere al posto del responsabile.</div>}
    </div>
  );
}
