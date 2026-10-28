// Registro delle operazioni (evidenza del controllo): data, operatore, azione, sorgente, paziente, accettazione, file prodotti,
// anomalie segnalate, sostituzioni. Export XLSX con gli stessi filtri.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiBase, base, qs, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Field, SearchInput, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { itDateTime } from '../format.js';
import { SorgenteBadge } from './Inbox.jsx';

const AZIONI = { CARICATO: 'Caricamento', SCARTATO: 'PDF scartato', MODIFICATA: 'Correzione', CONFERMATA: 'Conferma', SOSTITUZIONE: 'Sostituzione', SCARTATA: 'Scheda scartata', IMPOSTAZIONI: 'Impostazioni', TEMPLATE: 'Template' };
const TONE = { CARICATO: 'blue', SCARTATO: 'red', MODIFICATA: 'amber', CONFERMATA: 'green', SOSTITUZIONE: 'mauve', SCARTATA: 'grey', IMPOSTAZIONI: 'teal', TEMPLATE: 'teal' };

function Dettagli({ r }) {
  const d = r.dettagli || {};
  const parti = [];
  if (d.motivo) parti.push(`Motivo: ${d.motivo}`);
  if (d.schede != null) parti.push(`${d.schede} ${d.schede === 1 ? 'scheda' : 'schede'}, ${d.pagine} ${d.pagine === 1 ? 'pagina' : 'pagine'}`);
  if (d.ocr) parti.push('OCR');
  if (d.forzata) parti.push('conferma forzata: controllo di coerenza non superato');
  if (d.suffisso) parti.push('nome con suffisso (esisteva già)');
  if (d.sostituisce_scheda_id) parti.push(`sostituisce la scheda n. ${d.sostituisce_scheda_id}`);
  if (d.pdf_sorgente_intero) parti.push('PDF sorgente intero');
  if (d.pdf === false) parti.push('solo DOCX');
  if (Array.isArray(d.campi)) parti.push(`campi: ${d.campi.join(', ')}`);
  if (Array.isArray(d.chiavi)) parti.push(d.chiavi.join(', '));
  if (d.filename) parti.push(d.filename);
  if (d.rimosso) parti.push('template rimosso: carta intestata predefinita');
  if (d.template && d.template !== 'predefinito') parti.push(`template ${d.template}`);
  return <span className="small muted">{parti.join(' · ')}</span>;
}

export default function Registro() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [azione, setAzione] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const filters = { q, azione, from, to };
  const url = `/registro${qs(filters)}`;
  const { data, loading, error } = useApi(url, [url]);
  return (
    <div className="page">
      <PageHead title="Registro" icon="list" sub="Tutte le operazioni sui referti esterni: caricamenti, scarti, correzioni, conferme (con forzature e suffissi), sostituzioni, impostazioni. Serve anche come evidenza del controllo per il sistema qualità."
        actions={<a className="btn ghost" href={`${apiBase}/registro.xlsx${qs(filters)}`} target="_blank" rel="noopener"><Icon name="sheet" />Esporta XLSX</a>} />
      <div className="filters">
        <div style={{ minWidth: 280, flex: 1 }}><SearchInput value={text} onChange={setText} placeholder="Cerca per paziente, accettazione, file o operatore" /></div>
        <Field label="Azione"><select value={azione} onChange={(e) => setAzione(e.target.value)}><option value="">Tutte</option>{Object.entries(AZIONI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Dal"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="al"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Card flush>
        {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data && loading ? <Loading /> : !data?.length ? <Empty icon="list" title="Nessuna operazione registrata" /> : (
          <div className="table-wrap"><table className="t rf-table">
            <thead><tr><th>Data e ora</th><th>Operatore</th><th>Azione</th><th>Sorgente</th><th>Paziente</th><th>Accettazione</th><th>File</th><th>Anomalie</th><th className="rf-dett">Dettagli</th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id}>
                <td className="small nowrap">{itDateTime(r.at)}</td>
                <td className="small">{r.operatore || '-'}</td>
                <td><Badge tone={TONE[r.azione] || 'grey'} dot={false}>{r.azione_nome}</Badge></td>
                <td>{r.sorgente ? <SorgenteBadge s={r.sorgente} /> : <span className="muted small">-</span>}</td>
                <td className="small">{r.scheda_id ? <Link to={`${base}/schede/${r.scheda_id}`} className="strong">{r.cognome_nome || `scheda ${r.scheda_id}`}</Link> : <span className="muted">-</span>}</td>
                <td className="small">{r.accettazione || '-'}</td>
                <td className="small ellipsis" style={{ maxWidth: 240 }} title={r.nome_file || r.elaborazione_filename}>{r.nome_file || r.elaborazione_filename || '-'}</td>
                <td className="small">{r.scheda_id ? (r.n_anomalie ? <Badge tone="amber" dot={false} title={(r.anomalie || []).map((a) => a.testo).join('\n')}>{r.n_anomalie}</Badge> : <span className="muted">0</span>) : ''}</td>
                <td className="rf-dett"><Dettagli r={r} /></td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}
