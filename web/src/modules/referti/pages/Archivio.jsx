// Archivio (richiesta del CEO): una riga per paziente con cognome e nome e tre icone: PDF di partenza, DOCX trasformato, PDF
// trasformato. Ricerca per nome, filtro date e sorgente; accettazione, data, operatore.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiBase, base, qs, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Field, SearchInput, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { SORGENTE, itDate, itDateTime, kb } from '../format.js';
import { SorgenteBadge } from './Inbox.jsx';

const FILE = { SORGENTE_PDF: { icon: 'pdf', label: 'PDF di partenza', cls: 'src' }, DOCX: { icon: 'doc', label: 'DOCX trasformato', cls: 'docx' }, PDF: { icon: 'pdf', label: 'PDF trasformato', cls: 'pdf' } };

export function FileIcons({ file, inline }) {
  return (
    <div className="rf-files">
      {['SORGENTE_PDF', 'DOCX', 'PDF'].map((k) => {
        const f = (file || []).find((x) => x.kind === k);
        const m = FILE[k];
        if (!f) return <span key={k} className={`rf-fi off`} title={`${m.label}: non prodotto`}><Icon name={m.icon} /></span>;
        return <a key={k} className={`rf-fi ${m.cls}`} href={`${apiBase}/file/${f.id}${inline && k !== 'DOCX' ? '?inline=1' : ''}`} target={inline && k !== 'DOCX' ? '_blank' : undefined} rel="noopener" title={`${m.label}: ${f.filename} (${kb(f.size)})${f.intero ? ' · PDF intero, ritaglio non disponibile' : ''}`}><Icon name={m.icon} /><span>{k === 'SORGENTE_PDF' ? 'Partenza' : k}</span></a>;
      })}
    </div>
  );
}

export default function Archivio() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sorgente, setSorgente] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const url = `/archivio${qs({ q, from, to, sorgente })}`;
  const { data, loading, error } = useApi(url, [url]);
  return (
    <div className="page">
      <PageHead title="Archivio" icon="folder" sub="Una riga per paziente: cognome e nome e i tre file del referto confermato. Le icone aprono il PDF di partenza, il DOCX trasformato e il PDF trasformato." />
      <div className="filters">
        <div style={{ minWidth: 280, flex: 1 }}><SearchInput value={text} onChange={setText} placeholder="Cerca per cognome e nome, accettazione, referto o nome del file" /></div>
        <Field label="Sorgente"><select value={sorgente} onChange={(e) => setSorgente(e.target.value)}><option value="">Tutte</option>{Object.entries(SORGENTE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Confermati dal"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="al"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Card flush>
        {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data && loading ? <Loading /> : !data?.length ? <Empty icon="folder" title={q ? 'Nessun referto corrisponde alla ricerca' : 'Archivio vuoto'}>{q ? 'Prova con parole diverse o togli i filtri.' : 'I referti confermati compaiono qui con i tre file.'}</Empty> : (
          <div className="table-wrap"><table className="t rf-table">
            <thead><tr><th>Cognome e nome</th><th>File</th><th>Sorgente</th><th>Accettazione</th><th>Data</th><th>Confermato</th><th>Operatore</th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className={r.sostituita_da ? 'rf-sostituita' : ''}>
                <td><Link className="strong" to={`${base}/schede/${r.id}`}>{r.cognome_nome}</Link><div className="small muted ellipsis" style={{ maxWidth: 260 }} title={r.nome_file}>{r.nome_file}{r.sostituita_da ? ' · sostituito' : ''}{r.sostituisce_id ? ' · sostituisce il precedente' : ''}</div></td>
                <td><FileIcons file={r.file} inline /></td>
                <td><SorgenteBadge s={r.sorgente} /></td>
                <td className="small">{r.accettazione || r.referto_codice || '-'}</td>
                <td className="small">{r.data || '-'}</td>
                <td className="small muted">{itDateTime(r.confirmed_at)}</td>
                <td className="small">{r.operatore || '-'}</td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}
