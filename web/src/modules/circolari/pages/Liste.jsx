// Liste di distribuzione: destinatari esterni e interni, con proposte dall'anagrafica unica (sedi dei clienti service, punti
// prelievo, organizzazioni, utenti della Suite). Le liste si usano nell'invio delle circolari.
import React, { useState } from 'react';
import { api, useApi } from '../api.js';
import { Card, Field, Loading, Empty, Badge, Modal, ConfirmModal, useToast, PageHead } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { SEGMENTO, itDateTime } from '../format.js';

const EMPTY = { nome: '', descrizione: '', segmento: 'CLIENTI_SERVICE', destinatari: [], attiva: true };

export default function Liste() {
  const toast = useToast();
  const { data, reload } = useApi('/liste');
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const apri = async (l) => { try { setModal(l ? await api.get(`/liste/${l.id}`) : { ...EMPTY }); } catch (e) { toast(e, 'err'); } };
  return (
    <div className="page">
      <PageHead title="Liste di distribuzione" icon="users" sub="A chi vanno le circolari: clienti service, punti prelievo, medicina del lavoro, partner, personale. I destinatari si propongono dall'anagrafica unica e si correggono a mano." actions={<button className="btn" onClick={() => apri(null)}><Icon name="plus" />Nuova lista</button>} />
      <Card flush>
        {!data ? <Loading /> : !data.length ? <Empty icon="users" title="Nessuna lista">Crea la prima lista: i destinatari si propongono dall'anagrafica (sedi e organizzazioni con email).</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Lista</th><th>Segmento</th><th className="num">Destinatari</th><th className="num">Invii</th><th>Aggiornata</th><th></th></tr></thead>
            <tbody>{data.map((l) => <tr key={l.id} className="click" onClick={() => apri(l)}>
              <td><div className="strong">{l.nome} {!l.attiva && <Badge tone="grey">disattivata</Badge>}</div><div className="small muted">{l.descrizione}</div></td>
              <td className="small">{SEGMENTO[l.segmento] || l.segmento}</td><td className="num">{l.n_destinatari}</td><td className="num">{l.n_invii}</td><td className="small">{itDateTime(l.updated_at)}</td>
              <td className="actions"><button className="iconbtn" aria-label="Elimina" onClick={(e) => { e.stopPropagation(); setDel(l); }}><Icon name="trash" /></button></td>
            </tr>)}</tbody>
          </table></div>)}
      </Card>
      {modal && <ListaModal lista={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {del && <ConfirmModal title={`Eliminare la lista "${del.nome}"?`} text="Gli invii già registrati restano in archivio." confirmText="Elimina" danger onClose={() => setDel(null)} onConfirm={async () => { try { await api.del(`/liste/${del.id}`); toast('Lista eliminata'); setDel(null); reload(); } catch (e) { toast(e, 'err'); } }} />}
    </div>
  );
}

function ListaModal({ lista, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ ...lista, destinatari: lista.destinatari || [] });
  const [nuovo, setNuovo] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const has = (email) => f.destinatari.some((d) => d.email === email);
  const aggiungi = (d) => { if (!d.email || has(d.email)) return; upd('destinatari', [...f.destinatari, { nome: '', organizzazione: '', ...d }]); };
  const proponi = async () => { setBusy(true); try { const rows = await api.get(`/liste/proposte?segmento=${f.segmento}`); let n = 0; const add = []; for (const r of rows) if (!has(r.email) && !add.some((x) => x.email === r.email)) { add.push(r); n++; } upd('destinatari', [...f.destinatari, ...add]); toast(n ? `${n} destinatari proposti dall'anagrafica` : 'Nessun destinatario nuovo nell\'anagrafica per questo segmento'); } catch (e) { toast(e, 'err'); } setBusy(false); };
  const incolla = () => { const list = nuovo.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)); for (const email of list) aggiungi({ email }); setNuovo(''); };
  const salva = async () => {
    setBusy(true);
    try { if (f.id) await api.put(`/liste/${f.id}`, f); else await api.post('/liste', f); toast('Lista salvata'); onSaved(); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  return <Modal title={f.id ? `Lista: ${lista.nome}` : 'Nuova lista'} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button><button className="btn" disabled={busy} onClick={salva}><Icon name="check" />Salva</button></>}>
    <div className="circ-form">
      <div className="two">
        <Field label="Nome" required><input value={f.nome} onChange={(e) => upd('nome', e.target.value)} maxLength={120} /></Field>
        <Field label="Segmento"><select value={f.segmento} onChange={(e) => upd('segmento', e.target.value)}>{Object.entries(SEGMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      <Field label="Descrizione"><input value={f.descrizione} onChange={(e) => upd('descrizione', e.target.value)} maxLength={500} /></Field>
      <label className="f inline"><input type="checkbox" checked={f.attiva} onChange={(e) => upd('attiva', e.target.checked)} /> lista attiva</label>
      <div className="row between"><b>Destinatari ({f.destinatari.length})</b><button className="btn sm ghost" disabled={busy} onClick={proponi}><Icon name="import" />Proponi dall'anagrafica</button></div>
      <div className="circ-dest">
        {!f.destinatari.length ? <div className="small muted" style={{ padding: 10 }}>Nessun destinatario. Proponi dall'anagrafica o incolla gli indirizzi sotto.</div> : <table><tbody>{f.destinatari.map((d, i) => <tr key={d.email}>
          <td style={{ width: '38%' }} className="mono small">{d.email}</td>
          <td><input type="text" value={d.nome || ''} placeholder="Nome" onChange={(e) => upd('destinatari', f.destinatari.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} /></td>
          <td><input type="text" value={d.organizzazione || ''} placeholder="Organizzazione" onChange={(e) => upd('destinatari', f.destinatari.map((x, j) => (j === i ? { ...x, organizzazione: e.target.value } : x)))} /></td>
          <td style={{ width: 34 }}><button className="iconbtn" aria-label="Togli" onClick={() => upd('destinatari', f.destinatari.filter((_, j) => j !== i))}><Icon name="x" /></button></td>
        </tr>)}</tbody></table>}
      </div>
      <Field label="Aggiungi indirizzi" help="Separati da virgola, spazio o a capo"><div className="row"><textarea style={{ flex: 1 }} rows={2} value={nuovo} onChange={(e) => setNuovo(e.target.value)} /><button className="btn ghost" onClick={incolla}><Icon name="plus" />Aggiungi</button></div></Field>
    </div>
  </Modal>;
}
