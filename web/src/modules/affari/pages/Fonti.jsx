// Fonti monitorate: pagine (si confrontano i collegamenti) e feed RSS. Prima di aggiungerne una si prova la lettura: la Suite dice quante
// voci vede e mostra le prime. Una fonte in errore è segnalata qui e, dopo tre letture fallite, con una notifica.
import React, { useState } from 'react';
import { Card, Loading, Empty, PageHead, Badge, Modal, Field, ErrorBox, Switch, useToast, ConfirmModal } from '../../../components/ui.jsx';
import { api, useApi } from '../api.js';
import { useStato } from '../index.jsx';

const itDataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'mai');

function Scheda({ f, onClose, onFatto }) {
  const st = useStato(); const nuova = !f.id;
  const [v, setV] = useState({ nome: f.nome || '', url: f.url || '', tipo: f.tipo || 'PAGINA', categoria: f.categoria || 'BANDI', filtro: f.filtro || '' });
  const [prova, setProva] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.value }); setProva(null); };
  const provaOra = async () => { setBusy(true); setErr(null); try { setProva(await api.post('/fonti/prova', v)); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const salva = async () => { setBusy(true); setErr(null); try { const r = nuova ? await api.post('/fonti', v) : await api.put(`/fonti/${f.id}`, v); await onFatto(r); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal wide title={nuova ? 'Aggiungi una fonte' : `Modifica: ${f.nome}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn ghost" disabled={busy || !v.url} onClick={provaOra}>Prova la lettura</button><button className="btn" disabled={busy || !v.url || !v.nome || (nuova && !prova?.ok)} onClick={salva}>{nuova ? 'Aggiungi' : 'Salva'}</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Nome" required><input value={v.nome} onChange={set('nome')} placeholder="Ente e sezione" /></Field>
        <Field label="Categoria" required><select value={v.categoria} onChange={set('categoria')}>{Object.entries(st.categorie).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Indirizzo" required className="span2" help="L'indirizzo della pagina che elenca avvisi o atti, oppure di un feed RSS."><input value={v.url} onChange={set('url')} placeholder="https://" /></Field>
        <Field label="Tipo"><select value={v.tipo} onChange={set('tipo')}><option value="PAGINA">Pagina (collegamenti)</option><option value="RSS">Feed RSS o Atom</option></select></Field>
        <Field label="Considera solo i collegamenti che contengono" help="Facoltativo. Utile nelle pagine con molti collegamenti di servizio: per esempio /documents/ oppure /avvisi/."><input value={v.filtro} onChange={set('filtro')} /></Field>
      </div>
      {nuova && !prova && <p className="small muted">Prima di aggiungere la fonte prova la lettura: ciò che la pagina contiene in questo momento verrà registrato come già presente, e saranno novità solo le voci che compaiono dopo.</p>}
      {!nuova && <p className="small muted">Se cambi indirizzo, tipo o filtro la fonte riparte dalla prima lettura: ciò che contiene in quel momento non verrà segnalato.</p>}
      {prova && (prova.ok ? <div className="alert ok"><div><strong>Lettura riuscita: {prova.trovate} voci ({prova.tipo === 'RSS' ? 'feed' : 'collegamenti della pagina'}).</strong><ul className="small" style={{ margin: '6px 0 0' }}>{prova.esempi.map((e, i) => <li key={i}>{e.titolo}</li>)}</ul>{prova.tipo !== 'RSS' && <div className="small" style={{ marginTop: 6 }}>Se fra le prime voci vedi menu e collegamenti di servizio non è un problema: sono già presenti e non diventeranno novità. Il filtro serve solo a ridurre il rumore.</div>}</div></div> : <div className="alert warn"><span>Lettura non riuscita: {prova.errore}</span></div>)}
    </Modal>
  );
}

export default function Fonti() {
  const st = useStato(); const d = useApi('/fonti'); const toast = useToast(); const [m, setM] = useState(null); const [busy, setBusy] = useState(false);
  const fai = async (fn, ok) => { setBusy(true); try { const r = await fn(); toast(typeof ok === 'function' ? ok(r) : ok, r?.errore ? 'err' : 'ok'); window.dispatchEvent(new Event('suite:badges')); await d.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  return (
    <div className="page">
      <PageHead title="Fonti monitorate" icon="list" sub="Solo pagine pubbliche di enti. La Suite le legge più volte al giorno con un lettore prudente: nessun accesso riservato, nessun aggiramento di controlli anti-robot."
        actions={st.user.gestisce && <button className="btn" onClick={() => setM({ t: 'scheda', f: {} })}>Aggiungi una fonte</button>} />
      {Object.entries(st.categorie).map(([k, l]) => { const righe = d.data.righe.filter((f) => f.categoria === k); if (!righe.length) return null; return (
        <Card key={k} title={l} flush className="pa-gap"><div className="table-wrap"><table className="t"><thead><tr><th>Fonte</th><th>Stato</th><th>Ultima lettura</th><th className="num">Novità</th><th></th></tr></thead>
          <tbody>{righe.map((f) => (
            <tr key={f.id}>
              <td><span className="strong">{f.nome}</span><div className="small"><a href={f.url} target="_blank" rel="noreferrer">{f.url.replace(/^https?:\/\//, '').slice(0, 80)}</a></div><div className="small muted">{f.tipo === 'RSS' ? 'Feed' : 'Pagina'}{f.filtro ? ` · solo collegamenti con "${f.filtro}"` : ''}{f.seme ? ' · proposta dalla Suite' : ''}</div></td>
              <td>{!f.attiva ? <Badge tone="grey">Sospesa</Badge> : f.errore ? <Badge tone="red">Da controllare</Badge> : f.inizializzata ? <Badge tone="green">Attiva</Badge> : <Badge tone="amber">Prima lettura da fare</Badge>}{f.errore && <div className="small pa-rosso">{f.errore}</div>}</td>
              <td className="small">{itDataOra(f.letta_ok_at)}{f.trovate != null && <div className="muted">{f.trovate} voci nella fonte</div>}</td>
              <td className="num">{f.novita}</td>
              <td>{st.user.gestisce && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn sm ghost" disabled={busy} onClick={() => fai(() => api.post(`/fonti/${f.id}/leggi`, {}), (r) => (r.errore ? `Lettura non riuscita: ${r.errore}` : r.prima ? `Prima lettura: ${r.viste} voci registrate come già presenti` : `${r.viste} voci lette, ${r.nuove} novità`))}>Leggi ora</button>
                <button className="btn sm ghost" onClick={() => setM({ t: 'scheda', f })}>Modifica</button>
                <Switch checked={f.attiva} disabled={busy} label="Attiva" onChange={(c) => fai(() => api.put(`/fonti/${f.id}`, { attiva: c }), c ? 'Fonte riattivata' : 'Fonte sospesa')} />
                <button className="btn sm ghost" onClick={() => setM({ t: 'elimina', f })}>Elimina</button>
              </div>}</td>
            </tr>))}</tbody></table></div></Card>); })}
      {!d.data.righe.length && <Card><Empty icon="list" title="Nessuna fonte">Aggiungi la prima fonte.</Empty></Card>}
      {m?.t === 'scheda' && <Scheda f={m.f} onClose={() => setM(null)} onFatto={async (r) => { toast(r?.prima_lettura ? (r.prima_lettura.errore ? `Fonte aggiunta, ma la prima lettura non è riuscita: ${r.prima_lettura.errore}` : `Fonte aggiunta: ${r.prima_lettura.viste} voci registrate come già presenti`) : 'Fonte salvata'); await d.reload(); }} />}
      {m?.t === 'elimina' && <ConfirmModal title={`Elimina ${m.f.nome}`} danger confirmText="Elimina" text="La fonte e tutte le sue voci, con sintesi e note, vengono eliminate in modo definitivo. Per smettere di leggerla senza perdere lo storico basta sospenderla." onClose={() => setM(null)} onConfirm={async () => { await api.del(`/fonti/${m.f.id}`); await d.reload(); }} />}
    </div>
  );
}
