// Archivio (richiesta del CEO): una riga per paziente con cognome e nome e tre icone: PDF di partenza, DOCX trasformato, PDF
// trasformato. Ricerca per nome e luogo di nascita, filtro date e sorgente; nascita (sesso, data, luogo se presente), accettazione, operatore.
// 31/10/2026: download di DOCX e PDF, apertura della scheda, origine (caricato o casella template@ con mittente), stato dell'invio al
// mittente, filtro per origine, referti riaperti (in modifica, file della versione emessa ancora scaricabili), "Reinvia al mittente".
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiBase, base, qs, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Field, SearchInput, Badge, ConfirmModal, useToast } from '../../../components/ui.jsx';
import { useAuth, isLab } from '../index.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { SORGENTE, ORIGINE, STATO_INVIO, itDate, itDateTime, kb } from '../format.js';
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
  const [origine, setOrigine] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const url = `/archivio${qs({ q, from, to, sorgente, origine })}`;
  const { data, loading, error, reload } = useApi(url, [url]);
  const { user } = useAuth();
  const toast = useToast();
  const lab = isLab(user);
  const [elimina, setElimina] = useState(null);
  // Eliminazione di un referto confermato (richiesta del CEO): il server chiede force per le schede confermate; tracciata nel registro
  const eliminaScheda = async (r) => {
    try { await api.del(`/schede/${r.id}`, { force: true }); toast(`Referto di ${r.cognome_nome} eliminato dall'archivio`); setElimina(null); reload(); }
    catch (e) { toast(e, 'err'); setElimina(null); }
  };
  const [reinvia, setReinvia] = useState(null);
  const reinviaScheda = async (r) => {
    try { const out = await api.post(`/schede/${r.id}/invia`, { reinvia: true }); toast(out.stato === 'FALLITO' ? `Invio non riuscito: ${out.errore}` : `Referto di ${r.cognome_nome} reinviato a ${out.to}`, out.stato === 'FALLITO' ? 'err' : 'ok'); reload(); }
    catch (e) { toast(e, 'err'); }
    setReinvia(null);
  };
  return (
    <div className="page">
      <PageHead title="Archivio" icon="folder" sub="Una riga per paziente: cognome e nome e i tre file del referto confermato. Le icone scaricano il DOCX (Word) e aprono il PDF di partenza e il PDF trasformato. Un referto si riapre per modificarlo dalla sua scheda (occhio a fine riga)." />
      <div className="filters">
        <div style={{ minWidth: 280, flex: 1 }}><SearchInput value={text} onChange={setText} placeholder="Cerca per cognome e nome, luogo di nascita, accettazione o nome del file" /></div>
        <Field label="Sorgente"><select value={sorgente} onChange={(e) => setSorgente(e.target.value)}><option value="">Tutte</option>{Object.entries(SORGENTE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Origine"><select value={origine} onChange={(e) => setOrigine(e.target.value)}><option value="">Tutte</option><option value="UPLOAD">Caricati dall'Inbox</option><option value="CASELLA">Dalla casella (mail)</option></select></Field>
        <Field label="Confermati dal"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="al"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Card flush>
        {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data && loading ? <Loading /> : !data?.length ? <Empty icon="folder" title={q ? 'Nessun referto corrisponde alla ricerca' : 'Archivio vuoto'}>{q ? 'Prova con parole diverse o togli i filtri.' : 'I referti confermati compaiono qui con i tre file.'}</Empty> : (
          <div className="table-wrap"><table className="t rf-table">
            <thead><tr><th>Cognome e nome</th><th>File</th><th>Sorgente e accettazione</th><th>Origine e invio</th><th>Confermato</th><th></th></tr></thead>
            <tbody>{data.map((r) => {
              const inv = r.ultimo_invio;
              return (
              <tr key={r.id} className={r.sostituita_da ? 'rf-sostituita' : ''}>
                <td><Link className="strong" to={`${base}/schede/${r.id}`}>{r.cognome_nome}</Link><div className="small muted ellipsis" style={{ maxWidth: 260 }} title={r.nome_file}>{r.nome_file}{r.versione > 1 ? ` · v${r.versione}` : ''}{r.sostituita_da ? ' · sostituito' : ''}{r.sostituisce_id ? ' · sostituisce il precedente' : ''}</div>
                  <div className="small muted">{[r.sesso, r.data_nascita].filter(Boolean).join(' · ')}{r.luogo_nascita ? ` · ${r.luogo_nascita}` : ''}</div>
                  {r.stato === 'BOZZA' && <Badge tone="amber" dot={false} title={`Riaperto il ${itDateTime(r.riaperta_at)}: i file sono quelli della versione emessa`}>Riaperto, in modifica</Badge>}</td>
                <td><FileIcons file={r.file} inline /></td>
                <td><SorgenteBadge s={r.sorgente} /><div className="small muted">{r.accettazione || r.referto_codice || '-'}{r.data ? ` · ${r.data}` : ''}</div></td>
                <td className="small"><Badge tone={ORIGINE[r.origine]?.tone || 'grey'} dot={false}>{ORIGINE[r.origine]?.label || r.origine}</Badge>{r.from_email && <div className="muted ellipsis" style={{ maxWidth: 200 }} title={r.from_name || r.from_email}>{r.from_email}</div>}
                  {inv ? <div><Badge tone={STATO_INVIO[inv.stato]?.tone || 'grey'} dot={false} title={inv.errore || `a ${inv.to_email}`}>{STATO_INVIO[inv.stato]?.breve || STATO_INVIO[inv.stato]?.label || inv.stato}</Badge> <span className="muted">{itDateTime(inv.at)}{inv.automatico ? ' · auto' : ''}</span></div> : r.origine === 'CASELLA' ? <div className="muted">non inviato</div> : null}
                  {r.da_reinviare && <div className="rf-ko">riconfermato dopo l'invio</div>}</td>
                <td className="small muted">{itDateTime(r.confirmed_at)}<div>{r.operatore || (r.confirmed_at ? 'automatica' : '')}</div></td>
                <td className="actions">
                  <div className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    <Link className="btn sm ghost" to={`${base}/schede/${r.id}`} title="Apri la scheda (riapri, invia al mittente)"><Icon name="eye" />Apri</Link>
                    {lab && r.da_reinviare && r.from_email && <button className="btn sm" onClick={() => setReinvia(r)} title="Riconfermato dopo l'ultimo invio"><Icon name="mail" />Reinvia</button>}
                    {lab && <button className="btn sm ghost danger" title="Elimina il referto e i suoi file" onClick={() => setElimina(r)}><Icon name="trash" /></button>}
                  </div>
                </td>
              </tr>); })}</tbody>
          </table></div>)}
      </Card>
      {reinvia && <ConfirmModal title="Reinvia al mittente" text={`Il referto di ${reinvia.cognome_nome} è stato riconfermato dopo l'ultimo invio: il PDF aggiornato parte a ${reinvia.from_email}.`} confirmText="Reinvia" onConfirm={() => reinviaScheda(reinvia)} onClose={() => setReinvia(null)} />}
      {elimina && <ConfirmModal title="Elimina il referto" danger confirmText="Elimina" text={`Il referto confermato di ${elimina.cognome_nome} ("${elimina.nome_file}") verrà rimosso dall'archivio con il DOCX, il PDF TD e il PDF di partenza della scheda. L'operazione resta nel registro.`} onConfirm={() => eliminaScheda(elimina)} onClose={() => setElimina(null)} />}
    </div>
  );
}
