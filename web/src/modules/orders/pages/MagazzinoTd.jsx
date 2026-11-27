import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useApi, Loading, Empty, Card, Badge, StatusBadge, Modal, Field, Icon, useToast, ErrorBox } from '../components/ui.jsx';
import { itDate, itDateTime } from '../format.js';

// v0.99.14 · Magazzino TD (CEO, 28/11/2026): il magazzino interno gestito dall'Area Operations. Articoli interni che non saranno mai nel
// magazzino di Silva; gli ordini arrivano per email alla casella del magazzino e la giacenza scala quando la merce ESCE verso il
// destinatario (pulsante "Registra uscita"). Tre schede: ordini da evadere, giacenze e articoli, movimenti.
const SCHEDE = [['ordini', 'Ordini da evadere'], ['giacenze', 'Giacenze e articoli'], ['movimenti', 'Movimenti']];
const VIS = [['visible_all', 'Tutti'], ['visible_sedi', 'Punti Prelievo'], ['visible_poli', 'Centri Polidiagnostici'], ['visible_lab', 'Laboratorio'], ['visible_service', 'Service']];
const NUOVO = { name: '', unit: 'pezzi', pack_size: 1, pack_label: '', category_code: 'MAGAZZINO', min_stock_packs: 0, giacenza_iniziale: 0, visible_all: true, visible_sedi: false, visible_poli: false, visible_lab: false, visible_service: false, active: true };
const KIND = { CARICO: { label: 'Carico', tone: 'green' }, USCITA: { label: 'Uscita', tone: 'blue' }, RETTIFICA: { label: 'Rettifica', tone: 'amber' } };

export default function MagazzinoTd() {
  const nav = useNavigate();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const scheda = SCHEDE.some(([k]) => k === sp.get('scheda')) ? sp.get('scheda') : 'ordini';
  const { data, reload } = useApi('/td');
  const mov = useApi('/td/movimenti', [scheda]);
  const [err, setErr] = useState(null);
  const [art, setArt] = useState(null);       // articolo in modifica (o NUOVO)
  const [mv, setMv] = useState(null);         // carico o rettifica
  const [uscita, setUscita] = useState(null); // ordine in uscita con le quantità
  const [busy, setBusy] = useState(false);
  const fai = async (fn, msg, chiudi) => { setBusy(true); setErr(null); try { await fn(); toast(msg); chiudi?.(); reload(); mov.reload?.(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  if (!data) return <div className="page"><Loading /></div>;
  const daEvadere = data.ordini.filter((o) => o.status !== 'SPEDITO'); const usciti = data.ordini.filter((o) => o.status === 'SPEDITO');
  const disponibile = (a) => a.giacenza - a.impegnate;

  const salvaArticolo = () => {
    const { id, code, giacenza, impegnate, category_name, ultimo_movimento, giacenza_iniziale, ...c } = art;
    return fai(() => (id ? api.put(`/td/articoli/${id}`, c) : api.post('/td/articoli', { ...c, giacenza_iniziale })), id ? 'Articolo aggiornato' : 'Articolo creato', () => setArt(null));
  };
  const apriUscita = (o) => setUscita({ o, ddt: '', q: Object.fromEntries(o.lines.map((l) => [l.id, Math.min(l.qty_approved || 0, Math.max(0, l.giacenza))])) });
  const confermaUscita = () => fai(() => api.post(`/td/ordini/${uscita.o.id}/uscita`, { ddt: uscita.ddt || null, lines: uscita.o.lines.map((l) => ({ line_id: l.id, qty: Number(uscita.q[l.id]) || 0 })) }), 'Uscita registrata: giacenza scalata, ordine in consegna', () => setUscita(null));

  const Ordini = ({ righe, usciti: fatti }) => (!righe.length ? <Empty>{fatti ? 'Nessun ordine in viaggio' : 'Nessun ordine da evadere'}</Empty> : (
    <div className="table-wrap"><table className="t">
      <thead><tr><th>Ordine</th><th>Destinatario</th><th>Articoli</th><th>{fatti ? 'Uscito' : 'Approvato'}</th><th /></tr></thead>
      <tbody>{righe.map((o) => {
        const manca = o.lines.some((l) => !fatti && (l.qty_approved || 0) > l.giacenza);
        return (<tr key={o.id}>
          <td><span className="mono strong" style={{ cursor: 'pointer' }} onClick={() => nav(`${BASE}/ordini/${o.id}`)}>{o.number}</span>{o.urgent && <> <Badge tone="red">Urgente</Badge></>}
            {o.parent_number && <div className="small muted">diviso da {o.parent_number}</div>}<div><StatusBadge status={o.status} /></div></td>
          <td>{o.struttura_label}<div className="small muted">{o.city}</div></td>
          <td className="small">{o.lines.filter((l) => (l.qty_approved || 0) > 0).map((l) => <div key={l.id}>{fatti ? l.uscite : l.qty_approved} × {l.article_name}{!fatti && (l.qty_approved || 0) > l.giacenza && <> <Badge tone="red">in giacenza {l.giacenza}</Badge></>}{fatti && l.uscite < (l.qty_approved || 0) && <span className="muted"> (approvate {l.qty_approved})</span>}</div>)}</td>
          <td className="small muted">{itDateTime(fatti ? o.shipped_at : o.approved_at)}{!fatti && <div>{o.td_email_at ? `email inviata ${itDateTime(o.td_email_at)}` : 'email non inviata'}</div>}</td>
          <td className="num" style={{ whiteSpace: 'nowrap' }}>
            {!fatti && <><button className="btn sm ghost" title={`Invia di nuovo l'ordine a ${data.email}`} disabled={busy} onClick={() => fai(async () => { const r = await api.post(`/td/ordini/${o.id}/email`, {}); if (!r.ok) throw new Error(`Email non inviata: ${r.error || r.status}`); }, `Ordine inviato a ${data.email}`)}><Icon name="mail" size={14} /></button>{' '}
              <button className="btn sm" onClick={() => apriUscita(o)}>{manca ? 'Registra uscita parziale…' : 'Registra uscita…'}</button></>}
            {fatti && <button className="btn sm ghost" disabled={busy} title="La merce è arrivata al destinatario" onClick={() => fai(() => api.post(`/orders/${o.id}/delivered`, {}), 'Consegna registrata')}>Consegnato</button>}
          </td></tr>);
      })}</tbody>
    </table></div>
  ));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Magazzino TD</h1><div className="sub">Magazzino interno dell'Area Operations: articoli che non passano da Silva. Gli ordini arrivano a {data.email}; la giacenza scala quando la merce esce verso il destinatario.</div></div>
        <div className="row"><button className="btn" onClick={() => setArt({ ...NUOVO })}><Icon name="plus" size={16} />Nuovo articolo interno</button></div>
      </div>
      <div className="tabs" role="tablist">{SCHEDE.map(([k, l]) => <button key={k} role="tab" aria-selected={scheda === k} className={scheda === k ? 'on' : ''} onClick={() => setSp(k === 'ordini' ? {} : { scheda: k })}>{l}{k === 'ordini' && daEvadere.length > 0 ? ` (${daEvadere.length})` : ''}{k === 'giacenze' && data.sotto_scorta > 0 ? ` · ${data.sotto_scorta} sotto scorta` : ''}</button>)}</div>
      <ErrorBox error={!art && !mv && !uscita ? err : null} />

      {scheda === 'ordini' && <>
        <Card title={`Da evadere (${daEvadere.length})`} flush className="mb"><Ordini righe={daEvadere} /></Card>
        <Card title={`Usciti, in attesa di consegna (${usciti.length})`} flush><Ordini righe={usciti} usciti /></Card>
        <div className="small muted mt">Un ordine con articoli Silva e articoli interni si divide da solo all'approvazione: la parte interna arriva qui con il numero dell'ordine e il suffisso -TD. L'uscita si registra una volta sola; ciò che non esce non viene più evaso da quell'ordine.</div>
      </>}

      {scheda === 'giacenze' && (
        <Card title={`Articoli interni (${data.articoli.length})`} flush>
          {!data.articoli.length ? <Empty>Nessun articolo interno. Crea il primo con "Nuovo articolo interno": da quel momento è ordinabile dalle strutture a cui è visibile.</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Codice</th><th>Articolo</th><th className="num">Giacenza</th><th className="num">Impegnate</th><th className="num">Disponibili</th><th className="num">Scorta minima</th><th>Visibile a</th><th /></tr></thead>
              <tbody>{data.articoli.map((a) => (
                <tr key={a.id} className={!a.active ? 'muted' : ''}>
                  <td className="mono">{a.code}</td>
                  <td><div className="strong">{a.name}{!a.active && <> <Badge tone="grey">disattivo</Badge></>}</div><div className="small muted">{a.pack_label} · {a.category_name}</div></td>
                  <td className="num strong">{a.giacenza}</td><td className="num">{a.impegnate || <span className="muted">–</span>}</td>
                  <td className="num">{disponibile(a)}{a.active && a.min_stock_packs > 0 && disponibile(a) < a.min_stock_packs && <> <Badge tone="red">sotto scorta</Badge></>}</td>
                  <td className="num">{a.min_stock_packs || <span className="muted">–</span>}</td>
                  <td className="small">{VIS.filter(([k]) => a[k]).map(([, l]) => l).join(', ') || <span className="muted">nessuno: non ordinabile</span>}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => setMv({ a, kind: 'CARICO', qty: '', lot: '', expiry: '', note: '' })}>Carico</button>{' '}
                    <button className="btn sm ghost" onClick={() => setMv({ a, kind: 'RETTIFICA', qty: '', note: '' })}>Rettifica</button>{' '}
                    <button className="btn sm ghost" onClick={() => setArt({ ...a })}><Icon name="edit" size={14} /></button>
                  </td></tr>))}</tbody>
            </table></div>
          )}
          <div className="small muted" style={{ padding: '8px 12px' }}>Quantità in confezioni. Impegnate = approvate negli ordini non ancora usciti. Disponibili = giacenza meno impegnate.</div>
        </Card>
      )}

      {scheda === 'movimenti' && (
        <Card title="Ultimi movimenti" flush>
          {!mov.data ? <Loading /> : !mov.data.length ? <Empty>Nessun movimento</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Articolo</th><th className="num">Confezioni</th><th>Ordine, lotto, nota</th><th>Chi</th></tr></thead>
              <tbody>{mov.data.map((m) => (<tr key={m.id}>
                <td className="small muted">{itDateTime(m.created_at)}</td><td><Badge tone={KIND[m.kind].tone}>{KIND[m.kind].label}</Badge></td>
                <td>{m.name}<div className="small muted mono">{m.code}</div></td><td className="num strong">{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                <td className="small">{[m.order_number, m.lot && `lotto ${m.lot}`, m.expiry && `scad. ${itDate(m.expiry)}`, m.note !== `Ordine ${m.order_number}` && m.note].filter(Boolean).join(' · ') || <span className="muted">–</span>}</td>
                <td className="small muted">{m.user_name || '–'}</td></tr>))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {art && (
        <Modal title={art.id ? `Articolo ${art.code}` : 'Nuovo articolo interno'} onClose={() => setArt(null)} footer={<><button className="btn ghost" onClick={() => setArt(null)}>Annulla</button><button className="btn" disabled={busy || art.name.trim().length < 2 || !art.pack_label.trim() || !art.unit.trim()} onClick={salvaArticolo}>{art.id ? 'Salva' : 'Crea articolo'}</button></>}>
          <ErrorBox error={err} />
          <Field label="Nome"><input autoFocus value={art.name} onChange={(e) => setArt({ ...art, name: e.target.value })} /></Field>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Confezione" help='Come si ordina, per esempio "Risma da 500 fogli"' style={{ flex: 2 }}><input value={art.pack_label} onChange={(e) => setArt({ ...art, pack_label: e.target.value })} /></Field>
            <Field label="Pezzi per confezione" style={{ flex: 1 }}><input type="number" min="1" value={art.pack_size} onChange={(e) => setArt({ ...art, pack_size: e.target.value })} /></Field>
            <Field label="Unità" style={{ flex: 1 }}><input value={art.unit} onChange={(e) => setArt({ ...art, unit: e.target.value })} /></Field>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Categoria" style={{ flex: 2 }}><select value={art.category_code} onChange={(e) => setArt({ ...art, category_code: e.target.value })}>{data.categorie.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
            <Field label="Scorta minima (confezioni)" style={{ flex: 1 }}><input type="number" min="0" value={art.min_stock_packs} onChange={(e) => setArt({ ...art, min_stock_packs: e.target.value })} /></Field>
            {!art.id && <Field label="Giacenza iniziale" style={{ flex: 1 }}><input type="number" min="0" value={art.giacenza_iniziale} onChange={(e) => setArt({ ...art, giacenza_iniziale: e.target.value })} /></Field>}
          </div>
          <Field label="Chi può ordinarlo"><div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>{VIS.map(([k, l]) => <label key={k} className="row" style={{ gap: 6 }}><input type="checkbox" checked={Boolean(art[k])} onChange={(e) => setArt({ ...art, [k]: e.target.checked })} />{l}</label>)}</div></Field>
          {art.id && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={Boolean(art.active)} onChange={(e) => setArt({ ...art, active: e.target.checked })} />Attivo (un articolo disattivo non si ordina più)</label>}
          {!art.id && <div className="small muted">Il codice si assegna da solo (TD-0001, TD-0002, …). L'articolo non ha codice Silva e non verrà mai trasmesso a Silva.</div>}
        </Modal>
      )}

      {mv && (
        <Modal title={`${mv.kind === 'CARICO' ? 'Carico' : 'Rettifica'} · ${mv.a.name}`} onClose={() => setMv(null)} footer={<><button className="btn ghost" onClick={() => setMv(null)}>Annulla</button><button className="btn" disabled={busy || !Number(mv.qty) || (mv.kind === 'RETTIFICA' && mv.note.trim().length < 3)} onClick={() => fai(() => api.post('/td/movimenti', { article_id: mv.a.id, kind: mv.kind, qty: Number(mv.qty), lot: mv.lot || null, expiry: mv.expiry || null, note: mv.note || null }), mv.kind === 'CARICO' ? 'Carico registrato' : 'Rettifica registrata', () => setMv(null))}>Registra</button></>}>
          <ErrorBox error={err} />
          <p className="small muted">In giacenza: {mv.a.giacenza} confezioni ({mv.a.pack_label}).</p>
          <Field label={mv.kind === 'CARICO' ? 'Confezioni entrate' : 'Correzione in confezioni'} help={mv.kind === 'RETTIFICA' ? 'Con il segno: -2 toglie due confezioni, 3 ne aggiunge tre' : null}><input autoFocus type="number" min={mv.kind === 'CARICO' ? 1 : undefined} value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} /></Field>
          {mv.kind === 'CARICO' && <div className="row" style={{ gap: 12 }}><Field label="Lotto (facoltativo)" style={{ flex: 1 }}><input value={mv.lot} onChange={(e) => setMv({ ...mv, lot: e.target.value })} /></Field><Field label="Scadenza (facoltativa)" style={{ flex: 1 }}><input type="date" value={mv.expiry} onChange={(e) => setMv({ ...mv, expiry: e.target.value })} /></Field></div>}
          <Field label={mv.kind === 'RETTIFICA' ? 'Motivo' : 'Nota (facoltativa)'}><input value={mv.note} onChange={(e) => setMv({ ...mv, note: e.target.value })} /></Field>
        </Modal>
      )}

      {uscita && (
        <Modal wide title={`Uscita dell'ordine ${uscita.o.number}`} onClose={() => setUscita(null)} footer={<><button className="btn ghost" onClick={() => setUscita(null)}>Annulla</button><button className="btn" disabled={busy || !uscita.o.lines.some((l) => Number(uscita.q[l.id]) > 0)} onClick={confermaUscita}>Registra uscita e scala la giacenza</button></>}>
          <ErrorBox error={err} />
          <p>Destinatario: <b>{uscita.o.struttura_label}</b>. Indica le confezioni che escono adesso: la giacenza scala di queste quantità e l'ordine passa in consegna.</p>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Articolo</th><th className="num">Approvate</th><th className="num">In giacenza</th><th className="num">Escono</th></tr></thead>
            <tbody>{uscita.o.lines.filter((l) => (l.qty_approved || 0) > 0).map((l) => (<tr key={l.id}>
              <td>{l.article_name}<div className="small muted">{l.pack_label}</div></td><td className="num">{l.qty_approved}</td>
              <td className="num">{l.giacenza}{l.giacenza < l.qty_approved && <> <Badge tone="red">insufficiente</Badge></>}</td>
              <td className="num"><input type="number" min="0" max={Math.min(l.qty_approved, l.giacenza)} style={{ width: 90, textAlign: 'right' }} value={uscita.q[l.id]} onChange={(e) => setUscita({ ...uscita, q: { ...uscita.q, [l.id]: e.target.value } })} /></td></tr>))}</tbody>
          </table></div>
          <Field label="Numero DDT (facoltativo)"><input value={uscita.ddt} onChange={(e) => setUscita({ ...uscita, ddt: e.target.value })} /></Field>
          <div className="small muted">L'uscita si registra una volta sola. Se una riga esce in parte, il resto non viene più evaso da questo ordine: serve un nuovo ordine.</div>
        </Modal>
      )}
    </div>
  );
}
