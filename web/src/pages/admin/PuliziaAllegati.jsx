import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useApi, Card, Badge, Skeleton, Empty, ErrorBox, Modal, Field, PageHead, useToast } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { fmtBytes, fmtDateTime } from '../../format.js';

// Amministrazione > Pulizia allegati (solo titolare): cerca i termini della gestione precedente negli allegati di Business Hub, Room
// Planning e sedi, per nome del file e per contenuto, e li elimina definitivamente dopo conferma (parola ELIMINA). I file il cui
// contenuto non si può leggere (scansioni senza testo, firmati non apribili) sono elencati a parte: vanno guardati a mano.
const ESITO = { OK: 'letto', SOLO_IMMAGINE: 'scansione senza testo', NON_ANALIZZABILE: 'formato non leggibile', TROPPO_GRANDE: 'oltre 60 MB', ERRORE: 'errore di lettura', NON_LETTO: 'contenuto non letto' };
const chiave = (r) => `${r.sorgente}#${r.id}`;

export function PuliziaAllegati() {
  const { data, error, loading, reload } = useApi('/admin/pulizia-allegati');
  const [termini, setTermini] = useState('');
  const [contenuto, setContenuto] = useState(true);
  const [sel, setSel] = useState({});
  const [conf, setConf] = useState(null);
  const [parola, setParola] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const s = data?.scansione;
  useEffect(() => { if (data && !termini) setTermini((s?.termini || data.termini_default).join(', ')); }, [data]);
  useEffect(() => { if (!s?.in_corso) return undefined; const t = setInterval(reload, 2000); return () => clearInterval(t); }, [s?.in_corso]);
  // preselezione: solo i file che hanno il termine nel NOME; quelli trovati solo nel contenuto li sceglie il titolare
  useEffect(() => { if (s && !s.in_corso) setSel(Object.fromEntries(s.righe.filter((r) => r.nel_nome.length && !r.delicato).map((r) => [chiave(r), true]))); }, [s?.id, s?.in_corso]);
  const righe = s?.righe || [];
  const scelte = useMemo(() => righe.filter((r) => sel[chiave(r)]), [righe, sel]);
  const avvia = async () => {
    setBusy(true);
    try { await api.post('/admin/pulizia-allegati/scansione', { termini: termini.split(',').map((x) => x.trim()).filter(Boolean), contenuto }); setSel({}); await reload(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const elimina = async () => {
    setBusy(true);
    try {
      const r = await api.post('/admin/pulizia-allegati/elimina', { conferma: parola, voci: scelte.map((x) => ({ sorgente: x.sorgente, id: x.id })) });
      toast(`Eliminati ${r.eliminati.length} allegati`); setConf(null); setParola(''); setSel({}); await reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Skeleton rows={6} />;
  return (
    <div className="page">
      <PageHead title="Pulizia allegati" icon="trash" sub="Cerca un termine negli allegati di Business Hub, Room Planning e sedi (nome del file e contenuto) ed elimina definitivamente quelli scelti. Riservata al titolare." />
      <Card title="Ricerca" icon="search">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Termini da cercare (separati da virgola)" className="" ><input style={{ minWidth: 320 }} value={termini} onChange={(e) => setTermini(e.target.value)} placeholder="Fanfani, Synlab" /></Field>
          <label className="check-riga" style={{ marginBottom: 10 }}><input type="checkbox" checked={contenuto} onChange={(e) => setContenuto(e.target.checked)} /><span>Leggi anche il contenuto dei file (più lento)</span></label>
          <button className="btn" disabled={busy || s?.in_corso} onClick={avvia}><Icon name="search" />{s?.in_corso ? 'Ricerca in corso…' : 'Cerca'}</button>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Archivi controllati: {(data.sorgenti || []).map((x) => `${x.modulo} · ${x.tipo}`).join('; ') || 'nessuno'}. "Synlab" non colpisce "Synclab" (il gestionale di laboratorio).
        </div>
        {s && <div className="small" style={{ marginTop: 8 }}>{s.in_corso ? `Letti ${s.letti} file su ${s.totale}…` : `Ultima ricerca: ${fmtDateTime(s.finita_at)} · ${s.letti} file letti · ${righe.length} con il termine · ${s.non_analizzati.length} non leggibili nel contenuto`}{s.errore ? ` · errore: ${s.errore}` : ''}</div>}
      </Card>
      {s && !s.in_corso && (
        <Card title={`File che contengono il termine (${righe.length})`} icon="file" flush
          actions={<button className="btn danger" disabled={!scelte.length} onClick={() => setConf(true)}><Icon name="trash" />Elimina i {scelte.length} selezionati</button>}>
          {!righe.length ? <Empty icon="check" title="Nessun allegato con questi termini" /> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th style={{ width: 34 }}><input type="checkbox" aria-label="Seleziona tutti" checked={scelte.length === righe.length} onChange={(e) => setSel(e.target.checked ? Object.fromEntries(righe.map((r) => [chiave(r), true])) : {})} /></th><th>File</th><th>Dove si trova</th><th>Trovato</th></tr></thead>
              <tbody>{righe.map((r) => (
                <tr key={chiave(r)}>
                  <td><input type="checkbox" aria-label={`Seleziona ${r.nome}`} checked={Boolean(sel[chiave(r)])} onChange={(e) => setSel((o) => ({ ...o, [chiave(r)]: e.target.checked }))} /></td>
                  <td><strong>{r.nome}</strong><div className="small muted">{fmtBytes(r.size)} · caricato il {fmtDateTime(r.created_at)}</div></td>
                  <td><Link to={r.link}>{r.modulo}</Link><div className="small muted">{r.tipo} · {r.contesto}</div>{r.delicato && <Badge tone="amber">firmato o fascicolo già presentato</Badge>}</td>
                  <td>{r.nel_nome.length > 0 && <Badge tone="red">nel nome: {r.nel_nome.join(', ')}</Badge>} {r.nel_contenuto.length > 0 && <Badge tone="amber">nel contenuto: {r.nel_contenuto.join(', ')}</Badge>}
                    {!r.nel_contenuto.length && r.esito !== 'OK' && <div className="small muted">contenuto: {ESITO[r.esito] || r.esito}</div>}</td>
                </tr>))}</tbody>
            </table></div>)}
        </Card>)}
      {s && !s.in_corso && s.non_analizzati.length > 0 && (
        <Card title={`Contenuto non leggibile: da controllare a mano (${s.non_analizzati.length})`} icon="alert" flush>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>File</th><th>Dove si trova</th><th>Motivo</th></tr></thead>
            <tbody>{s.non_analizzati.map((r) => (
              <tr key={chiave(r)}><td>{r.nome}<div className="small muted">{fmtBytes(r.size)}</div></td><td><Link to={r.link}>{r.modulo}</Link><div className="small muted">{r.tipo} · {r.contesto}</div></td><td>{ESITO[r.esito] || r.esito}</td></tr>))}</tbody>
          </table></div>
        </Card>)}
      {conf && (
        <Modal title={`Eliminare ${scelte.length} allegati?`} onClose={() => setConf(null)}
          footer={<><button className="btn ghost" onClick={() => setConf(null)}>Annulla</button><button className="btn danger" disabled={busy || parola !== 'ELIMINA'} onClick={elimina}>Elimina definitivamente</button></>}>
          <p>L'eliminazione è definitiva: i file spariscono dal database e dall'archivio e non si possono recuperare dalla Suite.</p>
          {scelte.some((x) => x.delicato) && <p><strong>Attenzione:</strong> {scelte.filter((x) => x.delicato).length} file sono contratti firmati o documenti di un fascicolo già presentato o autorizzato.</p>}
          <ul className="small" style={{ maxHeight: 180, overflow: 'auto' }}>{scelte.map((x) => <li key={chiave(x)}>{x.nome}</li>)}</ul>
          <Field label="Scrivi ELIMINA per confermare"><input value={parola} onChange={(e) => setParola(e.target.value)} autoFocus /></Field>
        </Modal>)}
    </div>
  );
}
