import React, { useMemo, useState } from 'react';
import { BASE, api } from '../api.js';
import { useAuth, canWrite } from '../auth.jsx';
import { useNavigate } from 'react-router-dom';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, KindBadge, Modal, useToast } from '../components/ui.jsx';
import { itDate, DEADLINE_STATE } from '../format.js';

const TYPES = { DOCUMENTO: 'Documenti', CONTRATTO: 'Contratti', PROVA: 'Periodo di prova', RAL: 'Scatti RAL', MBO: 'MBO', IMPEGNO: 'Lettere di impegno', MANUALE: 'Manuali', FORMAZIONE: 'Formazione', ECM: 'Crediti ECM', TIROCINIO: 'Tirocini', MDL: 'Medicina del lavoro' };

export default function Deadlines() {
  const nav = useNavigate();
  const toast = useToast();
  const writer = canWrite(useAuth().user);
  // v0.92.0 · Segnala Scadenza: selezione con il quadratino, prima email e poi sollecito ogni 7 giorni
  const [sel, setSel] = useState(() => new Set());
  const [piano, setPiano] = useState(null);
  const [err, setErr] = useState(null);
  const [invio, setInvio] = useState(false);
  const scegli = (k, on) => setSel((p) => { const n = new Set(p); if (on) n.add(k); else n.delete(k); return n; });
  const [days, setDays] = useState(365);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const list = useApi(`/stats/deadlines?days=${days}`, [days]);
  // chi non è in servizio non genera scadenze: l'elenco resta in vista in fondo alla pagina, così nessuno sparisce in silenzio
  const esclusi = useApi('/stats/deadlines/esclusi');
  const rows = useMemo(() => (list.data || []).filter((x) => (!type || x.type === type) && (!q || (x.resource_name || '').toLowerCase().includes(q.toLowerCase()) || x.title.toLowerCase().includes(q.toLowerCase()))), [list.data, type, q]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const x of rows) { const k = x.days < 0 ? 'Scadute' : x.days <= 30 ? 'Entro 30 giorni' : x.days <= 90 ? 'Entro 90 giorni' : 'Oltre 90 giorni'; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return [...m.entries()];
  }, [rows]);
  const prepara = async () => { setErr(null); try { setPiano(await api.post('/stats/deadlines/segnala', { keys: [...sel], prova: true })); } catch (e) { setErr(e); } };
  const conferma = async () => {
    setErr(null); setInvio(true);
    try {
      const r = await api.post('/stats/deadlines/segnala', { keys: piano.righe.filter((x) => x.esito === 'DA_INVIARE').map((x) => x.key) });
      const ok = r.righe.filter((x) => ['INVIATO', 'REGISTRATO'].includes(x.esito)).length, reg = r.righe.filter((x) => x.esito === 'REGISTRATO').length, ko = r.righe.length - ok;
      toast(`${ok} scadenz${ok === 1 ? 'a segnalata' : 'e segnalate'}${reg ? ` (${reg} solo nel registro email: posta non attiva)` : ''}${ko ? `, ${ko} non partit${ko === 1 ? 'a' : 'e'}` : ''}`);
      setPiano(null); setSel(new Set()); list.reload();
    } catch (e) { setErr(e); } finally { setInvio(false); }
  };
  const ferma = async (key) => { setErr(null); try { await api.post('/stats/deadlines/segnala/ferma', { key }); toast('Solleciti fermati'); list.reload(); } catch (e) { setErr(e); } };
  return (
    <div className="page">
      <div className="page-head"><div style={{ flex: '1 1 420px' }}><h1>Calendario delle scadenze</h1><div className="sub">Documenti del personale (albo, polizze, identità, formazione), fine prova e contratti, scatti di RAL, valutazioni MBO, lettere di impegno, rinnovi della formazione, crediti ECM, tirocini, visite di medicina del lavoro e scadenze manuali.</div></div>
        {writer && <button className="btn" data-testid="segnala" disabled={!sel.size} title={sel.size ? '' : 'Seleziona una o più scadenze con il quadratino a sinistra'} onClick={prepara}>Segnala Scadenza{sel.size ? ` (${sel.size})` : ''}</button>}</div>
      <div className="filters">
        <Field label="Orizzonte"><select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={90}>3 mesi</option><option value={180}>6 mesi</option><option value={365}>12 mesi</option><option value={730}>24 mesi</option></select></Field>
        <Field label="Tipo"><select value={type} onChange={(e) => setType(e.target.value)}><option value="">Tutti</option>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Risorsa o scadenza" /></Field>
      </div>
      <ErrorBox error={list.error || err} />
      {piano && <Modal wide title="Segnala Scadenza" onClose={() => setPiano(null)} footer={<><button className="btn ghost" onClick={() => setPiano(null)}>Annulla</button><button className="btn" data-testid="segnala-conferma" disabled={invio || !piano.righe.some((x) => x.esito === 'DA_INVIARE')} onClick={conferma}>Invia {piano.righe.filter((x) => x.esito === 'DA_INVIARE').length} email</button></>}>
        <p className="small">Parte subito un'email dalla casella People per ogni scadenza. Finché la scadenza resta aperta parte poi un sollecito ogni {piano.giorni_sollecito} giorni; i solleciti si fermano da soli quando la scadenza viene chiusa, oppure dal pulsante Ferma.</p>
        <div className="table-wrap"><table className="t"><thead><tr><th>Scadenza</th><th>Data</th><th>Destinatario</th><th></th></tr></thead>
          <tbody>{piano.righe.map((x) => <tr key={x.key}><td>{x.title}<div className="small muted">{x.resource_name || 'Scadenza senza persona'}</div></td><td className="nowrap">{itDate(x.due_date)}</td>
            <td className="small">{x.a || <span className="muted">{x.motivo || 'nessun destinatario'}</span>}{x.cc ? <div className="muted">copia: {x.cc}</div> : null}</td>
            <td>{x.esito === 'DA_INVIARE' ? <Badge tone="green">da inviare</Badge> : x.esito === 'GIA_SEGNALATA' ? <Badge>già segnalata</Badge> : <Badge tone="red">senza destinatario</Badge>}</td></tr>)}</tbody></table></div>
        {piano.non_trovate > 0 && <div className="small muted" style={{ marginTop: 8 }}>{piano.non_trovate} scadenze selezionate non sono più in calendario.</div>}
      </Modal>}
      {!list.data ? <Loading /> : !rows.length ? <Card><Empty>Nessuna scadenza nel periodo</Empty></Card> : groups.map(([g, items]) => (
        <Card key={g} title={`${g} · ${items.length}`} flush className="" >
          <div className="table-wrap"><table className="t">
            <thead><tr>{writer && <th style={{ width: 34 }}><input type="checkbox" title="Seleziona tutte le scadenze del gruppo" checked={items.every((x) => sel.has(x.key))} onChange={(e) => setSel((p) => { const n = new Set(p); for (const x of items) { if (e.target.checked) n.add(x.key); else n.delete(x.key); } return n; })} /></th>}<th>Data</th><th>Risorsa</th><th>Scadenza</th><th>Tipo</th><th className="num">Stato</th></tr></thead>
            <tbody>{items.map((x, i) => (
              <tr key={x.key || i} className="click" onClick={() => x.resource_id && nav(`${BASE}/risorse/${x.resource_id}`)}>
                {writer && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" data-testid="scad-sel" checked={sel.has(x.key)} onChange={(e) => scegli(x.key, e.target.checked)} /></td>}
                <td className="strong">{itDate(x.due_date)}</td>
                <td>{x.resource_name} {x.kind && <KindBadge kind={x.kind} />}</td>
                <td>{x.title}{x.detail && <div className="small muted">{x.detail}</div>}
                  {x.segnalazione && <div className="small" onClick={(e) => e.stopPropagation()} style={{ marginTop: 3 }}>
                    {x.segnalazione.ferma ? <span className="muted">Segnalata il {itDate(x.segnalazione.prima)}, solleciti fermati{x.segnalazione.motivo ? ` (${x.segnalazione.motivo})` : ''}</span>
                      : x.segnalazione.prima ? <><Badge tone="mauve">Segnalata il {itDate(x.segnalazione.prima)}</Badge> <span className="muted">{x.segnalazione.solleciti ? `${x.segnalazione.solleciti} sollecit${x.segnalazione.solleciti === 1 ? 'o' : 'i'}, ultimo il ${itDate(x.segnalazione.ultimo)} · ` : ''}prossimo sollecito il {itDate(x.segnalazione.prossimo)}{x.segnalazione.esito === 'FALLITO' ? ' · ultimo invio non riuscito' : ''}</span>{writer && <> <button className="btn ghost small" onClick={() => ferma(x.key)}>Ferma</button></>}</>
                        : <span className="muted">Segnalazione non partita: {x.segnalazione.errore || (x.segnalazione.esito === 'SENZA_DESTINATARIO' ? 'nessun destinatario' : 'invio non riuscito')}</span>}
                  </div>}</td>
                <td><Badge>{TYPES[x.type] || x.type}</Badge></td>
                <td className="num"><Badge tone={DEADLINE_STATE[x.state]}>{x.days < 0 ? `scaduta da ${-x.days} gg` : x.days === 0 ? 'oggi' : `tra ${x.days} gg`}</Badge></td>
              </tr>))}</tbody>
          </table></div>
        </Card>
      ))}
      {esclusi.data && (esclusi.data.non_in_servizio.length > 0 || esclusi.data.datore_lavoro) && <div className="small muted" style={{ marginTop: 14 }}>
        {esclusi.data.non_in_servizio.length > 0 && <div><b>{esclusi.data.non_in_servizio.length} risorse non in servizio</b> non generano scadenze né richiami: {esclusi.data.non_in_servizio.map((x) => `${x.nome} (${x.motivo})`).join('; ')}.</div>}
        {esclusi.data.datore_lavoro && <div style={{ marginTop: 4 }}>Datore di lavoro ({esclusi.data.datore_lavoro}): nessuna scadenza di medicina del lavoro, formazione ed ECM. Si cambia in Impostazioni › Scadenze.</div>}
      </div>}
    </div>
  );
}
