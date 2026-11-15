// Business Hub · "Completa dal sito": legge il sito della struttura e propone i dati di anagrafica mancanti e le persone chiave, ognuno
// con la pagina da cui è stato letto. Nulla si scrive senza scelta: i campi già presenti non si toccano, i referenti si spuntano.
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Badge, Field, Loading, useToast } from './ui.jsx';

const TONO = { MANCANTE: 'teal', UGUALE: 'grey', DIVERSO: 'amber' };
const STATO = { MANCANTE: 'manca in anagrafica', UGUALE: 'già uguale', DIVERSO: 'diverso da quello in anagrafica' };
export const origine = (url) => { try { const u = new URL(url); return u.pathname === '/' ? u.hostname : `${u.hostname}${decodeURIComponent(u.pathname)}`.slice(0, 60); } catch { return ''; } };

export function CompletaDalSito({ a, onChange }) {
  const d = useApi(`/scouting/account/${a.id}`, [a.id]);
  const toast = useToast();
  const [sito, setSito] = useState('');
  const [busy, setBusy] = useState(false);
  const [dati, setDati] = useState(null);
  const [campi, setCampi] = useState({});
  const [persone, setPersone] = useState({});
  useEffect(() => { if (d.data) { setDati(d.data); setSito((s) => s || d.data.sito || ''); } }, [d.data]);
  useEffect(() => {
    if (!dati) return;
    setCampi(Object.fromEntries(dati.campi.filter((c) => c.stato === 'MANCANTE').map((c) => [c.campo, true])));
    setPersone(Object.fromEntries(dati.persone.filter((p) => !p.gia_referente).map((p) => [p.id, true])));
  }, [dati]);
  if (!dati) return <Card title="Completa dal sito">{d.error ? <div className="alert err">{d.error.message}</div> : <Loading />}</Card>;
  const leggi = async () => {
    setBusy(true);
    try { const r = await api.post(`/scouting/account/${a.id}/profila`, { sito }); setDati({ ...dati, ...r }); toast(r.ok ? 'Sito letto' : r.errore || 'Sito non letto', r.ok ? undefined : 'err'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const applica = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/scouting/account/${a.id}/applica`, { campi: Object.keys(campi).filter((k) => campi[k]), persone: Object.keys(persone).filter((k) => persone[k]).map(Number) });
      setDati({ ...dati, ...r }); toast(`Aggiunti ${r.applicati.campi} dati di anagrafica e ${r.applicati.referenti} referenti`); onChange?.();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const nuoviCampi = dati.campi.filter((c) => c.stato === 'MANCANTE');
  const nScelti = Object.values(campi).filter(Boolean).length + Object.values(persone).filter(Boolean).length;
  return (
    <Card title="Completa dal sito" actions={dati.candidato && dati.puo_scrivere && <button className="btn sm" disabled={busy || !nScelti} onClick={applica}>Aggiungi i {nScelti} scelti</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>La Suite legge il sito della struttura (pagina iniziale, contatti, chi siamo, direzione) e propone ciò che manca. Ogni dato riporta la pagina di provenienza. Un dato già presente in anagrafica non viene sostituito.</p>
      {dati.puo_scrivere && <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <Field label="Sito della struttura" className="scout-grow"><input value={sito} onChange={(e) => setSito(e.target.value)} placeholder="www.nomestruttura.it" /></Field>
        <button className="btn ghost" style={{ marginBottom: 10 }} disabled={busy || sito.trim().length < 4} onClick={leggi}>{busy ? 'Lettura in corso…' : dati.candidato ? 'Rileggi' : 'Leggi il sito'}</button>
      </div>}
      {dati.candidato?.errore_profilo && <div className="alert info">{dati.candidato.errore_profilo}</div>}
      {dati.candidato && !dati.candidato.errore_profilo && <>
        <div className="small muted" style={{ margin: '6px 0' }}>Pagine lette: {(dati.candidato.pagine || []).length}{dati.candidato.email?.schema ? ` · schema degli indirizzi: ${dati.candidato.email.schema}@${dati.candidato.email.dominio}` : ''}</div>
        <div className="strong small" style={{ marginTop: 10 }}>Anagrafica</div>
        {dati.campi.length ? <table className="t small"><tbody>{dati.campi.map((c) => <tr key={c.campo}>
          <td style={{ width: 28 }}>{c.stato === 'MANCANTE' && dati.puo_scrivere && <input type="checkbox" aria-label={`Aggiungi ${c.etichetta}`} checked={Boolean(campi[c.campo])} onChange={(e) => setCampi((o) => ({ ...o, [c.campo]: e.target.checked }))} />}</td>
          <td><span className="muted">{c.etichetta}</span> <strong>{c.proposto}</strong>{c.stato === 'DIVERSO' && <div className="muted">in anagrafica: {c.attuale}</div>}</td>
          <td><Badge tone={TONO[c.stato]}>{STATO[c.stato]}</Badge></td>
          <td className="muted">{c.url && <a href={c.url} target="_blank" rel="noreferrer noopener">{origine(c.url)}</a>}</td></tr>)}</tbody></table> : <div className="small muted">Nessun dato di anagrafica trovato sul sito.</div>}
        {!nuoviCampi.length && dati.campi.length > 0 && <div className="small muted">L'anagrafica ha già tutti i dati che il sito pubblica.</div>}
        <div className="strong small" style={{ marginTop: 14 }}>Persone chiave</div>
        {dati.persone.length ? <table className="t small"><tbody>{dati.persone.map((p) => <tr key={p.id}>
          <td style={{ width: 28 }}>{!p.gia_referente && dati.puo_scrivere && <input type="checkbox" aria-label={`Aggiungi ${p.nome}`} checked={Boolean(persone[p.id])} onChange={(e) => setPersone((o) => ({ ...o, [p.id]: e.target.checked }))} />}</td>
          <td><strong>{p.nome}</strong><div className="muted">{p.titolo}</div></td>
          <td>{p.email ? <>{p.email} <Badge tone={p.email_stato === 'PUBBLICATA' ? 'teal' : 'amber'}>{p.email_stato === 'PUBBLICATA' ? 'pubblicata' : 'ipotesi, da verificare'}</Badge></> : <span className="muted">nessun indirizzo</span>}</td>
          <td className="muted">{p.gia_referente ? <Badge>già tra i referenti</Badge> : p.url && <a href={p.url} target="_blank" rel="noreferrer noopener" title={p.evidenza || ''}>{origine(p.url)}</a>}</td></tr>)}</tbody></table>
          : <div className="small muted">Il sito non nomina persone con un ruolo di direzione.</div>}
      </>}
    </Card>
  );
}
