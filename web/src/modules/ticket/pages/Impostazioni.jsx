// Impostazioni (ADMIN): categorie con casella predefinita scelta dall'albero, SLA per priorità, chiusura automatica, escalation,
// limite giornaliero, testi degli avvisi, esecuzione manuale del lavoro periodico.
import React, { useEffect, useState } from 'react';
import { api, useApi } from '../api.js';
import { Card, Field, Modal, ConfirmModal, useToast, PageHead, Loading, Badge, Switch } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { UnitSelect } from '../components.jsx';
import { PRIORITA } from '../format.js';

export default function Impostazioni() {
  const toast = useToast();
  const cat = useApi('/catalogo');
  const categorie = useApi('/categorie');
  const sla = useApi('/sla');
  const imp = useApi('/impostazioni');
  const [editCat, setEditCat] = useState(null);
  const [del, setDel] = useState(null);
  const [slaForm, setSlaForm] = useState(null);
  const [impForm, setImpForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (sla.data) setSlaForm(sla.data.map((s) => ({ ...s }))); }, [sla.data]);
  useEffect(() => { if (imp.data) setImpForm({ ...imp.data }); }, [imp.data]);
  const run = async (fn, ok, after) => { setBusy(true); try { await fn(); toast(ok); after?.(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  const saveCat = () => run(async () => {
    const body = { ...editCat, unit_id: editCat.unit_id || null, sort_order: Number(editCat.sort_order) || 100 };
    if (editCat.id) await api.put(`/categorie/${editCat.id}`, body); else await api.post('/categorie', body);
  }, 'Categoria salvata', () => { setEditCat(null); categorie.reload(); });
  const units = cat.data?.unita || [];
  return (
    <div className="page">
      <PageHead title="Impostazioni" icon="gear" sub="Categorie e caselle predefinite, tempi di risposta per priorità, chiusura automatica ed escalation, testi degli avvisi." actions={<button className="btn ghost" disabled={busy} onClick={() => run(async () => { const r = await api.post('/admin/job'); toast(`Eseguito: ${r.sforati_risposta + r.sforati_risoluzione} SLA marcati, ${r.escalation} escalation, ${r.chiusi} chiusure automatiche`); }, 'Lavoro periodico eseguito')}><Icon name="refresh" />Esegui ora il controllo SLA</button>} />

      <Card title="Categorie" icon="list" flush actions={<button className="btn sm" onClick={() => setEditCat({ nome: '', descrizione: '', unit_id: null, priorita_default: 'P3', riservata: false, attiva: true, sort_order: 100 })}><Icon name="plus" />Nuova categoria</button>}>
        {!categorie.data ? <Loading /> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Categoria</th><th>Casella predefinita</th><th>Priorità</th><th>Riservata</th><th>Attiva</th><th className="num">Ticket</th><th></th></tr></thead>
            <tbody>{categorie.data.map((c) => (
              <tr key={c.id}>
                <td><div className="strong">{c.nome}</div><div className="small muted">{c.descrizione}</div></td>
                <td className="small">{c.unit_nome ? <><b>{c.unit_nome}</b><div className="muted">{c.unit_path}</div></> : <span className="muted">Nessuna: la sceglie il richiedente</span>}</td>
                <td>{PRIORITA[c.priorita_default]?.label}</td>
                <td>{c.riservata ? <Badge tone="mauve">Sì</Badge> : <span className="muted small">No</span>}</td>
                <td>{c.attiva ? <Badge tone="green">Attiva</Badge> : <Badge tone="grey">Disattiva</Badge>}</td>
                <td className="num">{c.n_tickets}</td>
                <td className="actions"><button className="btn sm ghost" onClick={() => setEditCat({ ...c })}><Icon name="edit" />Modifica</button> <button className="btn sm danger" onClick={() => setDel(c)}><Icon name="trash" /></button></td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>

      <div className="grid tk-two">
        <Card title="SLA per priorità (ore)" icon="clock" actions={<button className="btn sm" disabled={busy || !slaForm} onClick={() => run(() => api.put('/sla', slaForm.map((s) => ({ priorita: s.priorita, etichetta: s.etichetta, prima_risposta_ore: Number(s.prima_risposta_ore), risoluzione_ore: Number(s.risoluzione_ore) }))), 'SLA salvati', sla.reload)}>Salva</button>}>
          {!slaForm ? <Loading /> : (
            <table className="t tk-slatab"><thead><tr><th>Priorità</th><th>Etichetta</th><th>Prima risposta</th><th>Risoluzione</th></tr></thead>
              <tbody>{slaForm.map((s, i) => <tr key={s.priorita}><td className="strong">{s.priorita}</td><td><input value={s.etichetta} onChange={(e) => setSlaForm(slaForm.map((x, j) => (j === i ? { ...x, etichetta: e.target.value } : x)))} /></td><td><input type="number" min={1} value={s.prima_risposta_ore} onChange={(e) => setSlaForm(slaForm.map((x, j) => (j === i ? { ...x, prima_risposta_ore: e.target.value } : x)))} /></td><td><input type="number" min={1} value={s.risoluzione_ore} onChange={(e) => setSlaForm(slaForm.map((x, j) => (j === i ? { ...x, risoluzione_ore: e.target.value } : x)))} /></td></tr>)}</tbody></table>)}
          <div className="help" style={{ marginTop: 8 }}>Le nuove ore valgono per i ticket aperti da ora in poi e per quelli a cui si cambia priorità.</div>
        </Card>
        <Card title="Regole e avvisi" icon="shield" actions={<button className="btn sm" disabled={busy || !impForm} onClick={() => run(() => api.put('/impostazioni', { chiusura_automatica_giorni: Number(impForm.chiusura_automatica_giorni), escalation_attiva: Boolean(impForm.escalation_attiva), max_aperture_giorno: Number(impForm.max_aperture_giorno), avviso_privacy: impForm.avviso_privacy, avviso_riservato: impForm.avviso_riservato }), 'Impostazioni salvate', imp.reload)}>Salva</button>}>
          {!impForm ? <Loading /> : (
            <div className="tk-form">
              <div className="two">
                <Field label="Chiusura automatica dopo (giorni da Risolto)" help="0 disattiva la chiusura automatica."><input type="number" min={0} max={365} value={impForm.chiusura_automatica_giorni} onChange={(e) => setImpForm({ ...impForm, chiusura_automatica_giorni: e.target.value })} /></Field>
                <Field label="Massimo ticket al giorno per utente"><input type="number" min={1} max={500} value={impForm.max_aperture_giorno} onChange={(e) => setImpForm({ ...impForm, max_aperture_giorno: e.target.value })} /></Field>
              </div>
              <label className="tk-switch"><Switch checked={Boolean(impForm.escalation_attiva)} onChange={(v) => setImpForm({ ...impForm, escalation_attiva: v })} label="Escalation automatica alla casella superiore quando la risoluzione è sforata senza presa in carico" /><span>Escalation automatica alla casella superiore quando la risoluzione è sforata senza presa in carico</span></label>
              <Field label="Avviso privacy (pagina Nuovo ticket)"><textarea rows={3} value={impForm.avviso_privacy || ''} onChange={(e) => setImpForm({ ...impForm, avviso_privacy: e.target.value })} /></Field>
              <Field label="Nota per le segnalazioni riservate (rimando al canale whistleblowing)"><textarea rows={4} value={impForm.avviso_riservato || ''} onChange={(e) => setImpForm({ ...impForm, avviso_riservato: e.target.value })} /></Field>
            </div>)}
        </Card>
      </div>

      {editCat && (
        <Modal title={editCat.id ? 'Modifica categoria' : 'Nuova categoria'} onClose={() => setEditCat(null)} footer={<><button className="btn ghost" onClick={() => setEditCat(null)}>Annulla</button><button className="btn" disabled={busy || editCat.nome.trim().length < 2} onClick={saveCat}>Salva</button></>}>
          <div className="tk-form">
            <Field label="Nome" required><input value={editCat.nome} onChange={(e) => setEditCat({ ...editCat, nome: e.target.value })} maxLength={120} /></Field>
            <Field label="Descrizione (mostrata al richiedente)"><textarea rows={2} value={editCat.descrizione} onChange={(e) => setEditCat({ ...editCat, descrizione: e.target.value })} maxLength={600} /></Field>
            <Field label="Casella destinataria predefinita" help="Se manca, il richiedente la sceglie dall'albero."><UnitSelect units={units} value={editCat.unit_id} onChange={(v) => setEditCat({ ...editCat, unit_id: v })} emptyLabel="Nessuna (la sceglie il richiedente)" /></Field>
            <div className="two">
              <Field label="Priorità proposta"><select value={editCat.priorita_default} onChange={(e) => setEditCat({ ...editCat, priorita_default: e.target.value })}>{Object.entries(PRIORITA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
              <Field label="Ordine"><input type="number" value={editCat.sort_order} onChange={(e) => setEditCat({ ...editCat, sort_order: e.target.value })} /></Field>
            </div>
            <label className="tk-switch"><Switch checked={Boolean(editCat.riservata)} onChange={(v) => setEditCat({ ...editCat, riservata: v })} label="Riservata: i ticket sono visibili solo ai responsabili della casella e all'amministratore" /><span>Riservata: i ticket sono visibili solo ai responsabili della casella e all'amministratore</span></label>
            <label className="tk-switch"><Switch checked={Boolean(editCat.attiva)} onChange={(v) => setEditCat({ ...editCat, attiva: v })} label="Attiva (proposta nel form)" /><span>Attiva (proposta nel form)</span></label>
          </div>
        </Modal>
      )}
      {del && <ConfirmModal title="Elimina categoria" text={del.n_tickets > 0 ? `La categoria "${del.nome}" ha ${del.n_tickets} ticket: verrà disattivata, non eliminata.` : `Eliminare la categoria "${del.nome}"?`} confirmText={del.n_tickets > 0 ? 'Disattiva' : 'Elimina'} danger onClose={() => setDel(null)} onConfirm={() => run(() => api.del(`/categorie/${del.id}`), 'Fatto', () => { setDel(null); categorie.reload(); })} />}
    </div>
  );
}
