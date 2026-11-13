// Impostazioni (P&C e titolare): parametri generali (giorno limite, tariffa predefinita VUOTA finché P&C non la inserisce dalle tabelle
// ACI, P&C in più, promemoria, email), categorie con massimali facoltativi e giustificativo obbligatorio, eccezioni al giustificativo
// (seme del CEO abbinato per cognome solo se univoco), job dei promemoria. Nessun importo di policy precompilato.
import React, { useEffect, useState } from 'react';
import { Card, Loading, Empty, PageHead, Field, ErrorBox, Modal, Badge, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, useApi } from '../api.js';
import { ModuliCartacei } from '../components.jsx';
import { eur } from '../format.js';

const TIPI = { SPESA: 'Spesa (MOD025)', CARBURANTE: 'Carburante (MOD025)', PEDAGGIO: 'Pedaggio (MOD029)', PARCHEGGIO: 'Parcheggio (MOD029)' };

export default function Impostazioni() {
  const toast = useToast();
  const d = useApi('/impostazioni');
  const cat = useApi('/categorie');
  const ecc = useApi('/eccezioni');
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [pEcc, setPEcc] = useState('');
  useEffect(() => { if (d.data) setV({ giorno_limite: d.data.giorno_limite, tariffa_km_default: d.data.tariffa_km_default != null ? String(d.data.tariffa_km_default).replace('.', ',') : '', tariffa_km_default_fonte: d.data.tariffa_km_default_fonte || '', pc_person_ids: d.data.pc_person_ids || [], promemoria_bozza_giorni_prima: d.data.promemoria_bozza_giorni_prima, promemoria_responsabile_giorni: d.data.promemoria_responsabile_giorni, email_attiva: d.data.email_attiva !== false, risali_se_in_ferie: d.data.risali_se_in_ferie !== false, avviso_dipendenti: d.data.avviso_dipendenti || '', invio_approvazione_attivo: d.data.invio_approvazione_attivo !== false, allega_giustificativi: Boolean(d.data.allega_giustificativi), mittente_approvazione: d.data.mittente_approvazione || '', destinatari_approvazione: (d.data.destinatari_approvazione || []).map((x) => ({ nome: x.nome || '', email: x.email || '' })) }); }, [d.data]);
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data || !v) return <div className="page"><Loading /></div>;
  const s = (k, x) => setV((o) => ({ ...o, [k]: x }));
  const salva = async () => { setErr(null); try { await api.put('/impostazioni', { ...v, tariffa_km_default: v.tariffa_km_default || null, destinatari_approvazione: v.destinatari_approvazione.filter((x) => x.email.trim()) }); d.reload(); toast('Impostazioni salvate'); } catch (e) { setErr(e); window.scrollTo(0, 0); } };
  const persone = d.data.persone;
  return (
    <div className="page rs-page">
      <PageHead title="Impostazioni" icon="gear" sub="P&C e titolare. Nessun massimale e nessuna tariffa sono precompilati: si inseriscono dalle regole aziendali e dalle tabelle ACI." />
      <ErrorBox error={err} />
      <Card className="rs-gap" title="Generali" icon="gear" actions={<button className="btn sm" onClick={salva}><Icon name="check" />Salva</button>}>
        <div className="form-grid">
          <Field label="Invio entro il giorno del mese successivo" help="Oltre: invio consentito con l'avviso 'in ritardo'"><input type="number" min={1} max={28} value={v.giorno_limite} onChange={(e) => s('giorno_limite', e.target.value)} /></Field>
          <Field label="Tariffa predefinita (EUR/km)" help="Vuota: vale la tariffa del veicolo del dipendente"><input inputMode="decimal" value={v.tariffa_km_default} placeholder="vuota" onChange={(e) => s('tariffa_km_default', e.target.value.replace(/[^\d,.]/g, ''))} /></Field>
          <Field label="Fonte della tariffa predefinita"><input value={v.tariffa_km_default_fonte} placeholder="es. tabelle ACI 2026" onChange={(e) => s('tariffa_km_default_fonte', e.target.value)} /></Field>
          <Field label="Promemoria al dipendente: giorni prima del limite"><input type="number" min={0} max={20} value={v.promemoria_bozza_giorni_prima} onChange={(e) => s('promemoria_bozza_giorni_prima', e.target.value)} /></Field>
          <Field label="Promemoria al responsabile dopo giorni"><input type="number" min={1} max={60} value={v.promemoria_responsabile_giorni} onChange={(e) => s('promemoria_responsabile_giorni', e.target.value)} /></Field>
        </div>
        <div className="row rs-gap-t">
          <label className="f inline"><input type="checkbox" checked={v.email_attiva} onChange={(e) => s('email_attiva', e.target.checked)} />Email oltre alla notifica nella Suite</label>
          <label className="f inline"><input type="checkbox" checked={v.risali_se_in_ferie} onChange={(e) => s('risali_se_in_ferie', e.target.checked)} />Responsabile in ferie oggi (Piano Ferie): la nota sale al superiore successivo</label>
        </div>
        <Field label="Avviso ai dipendenti (in Le mie note spese)"><textarea rows={2} value={v.avviso_dipendenti} onChange={(e) => s('avviso_dipendenti', e.target.value)} /></Field>
      </Card>

      <Card className="rs-gap" title="Invio del PDF di approvazione (destinatari esterni)" icon="mail" actions={<button className="btn sm" onClick={salva}><Icon name="check" />Salva</button>}>
        <div className="alert warn"><Icon name="alert" /><span>A ogni approvazione (anche quella automatica del vertice) parte verso l'esterno dell'azienda un'email con il PDF della nota spese approvata: dati di spesa, chilometri e saldo del dipendente. Destinatari decisi dal CEO il 13/11/2026; ogni modifica è registrata nell'audit.</span></div>
        <div className="row rs-gap-t">
          <label className="f inline"><input type="checkbox" checked={v.invio_approvazione_attivo} onChange={(e) => s('invio_approvazione_attivo', e.target.checked)} />Invio attivo</label>
          <label className="f inline"><input type="checkbox" checked={v.allega_giustificativi} onChange={(e) => s('allega_giustificativi', e.target.checked)} />Allega anche i giustificativi (predefinito no: solo il PDF)</label>
        </div>
        <div className="form-grid rs-gap-t"><Field label="Mittente" help="Casella da cui parte l'email (deve essere autorizzata su Microsoft 365)"><input value={v.mittente_approvazione} onChange={(e) => s('mittente_approvazione', e.target.value)} /></Field></div>
        <div className="rs-ecc rs-gap-t">{v.destinatari_approvazione.map((x, i) => (
          <div key={i} className="rs-ecc-r">
            <input aria-label="Nome" placeholder="Cognome Nome" value={x.nome} onChange={(e) => s('destinatari_approvazione', v.destinatari_approvazione.map((y, j) => (j === i ? { ...y, nome: e.target.value } : y)))} style={{ flex: '1 1 180px' }} />
            <input aria-label="Email" placeholder="email" value={x.email} onChange={(e) => s('destinatari_approvazione', v.destinatari_approvazione.map((y, j) => (j === i ? { ...y, email: e.target.value } : y)))} style={{ flex: '2 1 240px' }} />
            <button className="iconbtn" aria-label="Togli il destinatario" onClick={() => s('destinatari_approvazione', v.destinatari_approvazione.filter((_, j) => j !== i))}><Icon name="trash" /></button>
          </div>))}</div>
        <div className="row rs-gap-t"><button className="btn sm ghost" onClick={() => s('destinatari_approvazione', [...v.destinatari_approvazione, { nome: '', email: '' }])}><Icon name="plus" />Aggiungi destinatario</button></div>
      </Card>

      <Card className="rs-gap" title="P&C (liquidazione)" icon="users">
        <p className="small">P&C sono i dipendenti con il profilo Amministratore di Contratti del personale e quelli scelti qui. Oggi: {d.data.pc.length ? d.data.pc.map((p) => `${p.nome}${p.da_grant ? ' (grant)' : ''}`).join(', ') : 'nessuno'}.</p>
        <div className="row">
          <select value="" onChange={(e) => e.target.value && s('pc_person_ids', [...new Set([...v.pc_person_ids, Number(e.target.value)])])} aria-label="Aggiungi P&C"><option value="">Aggiungi un dipendente come P&C</option>{persone.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
          {v.pc_person_ids.map((id) => <span key={id} className="chip">{persone.find((p) => p.id === id)?.nome || id}<button className="iconbtn" aria-label="Togli" onClick={() => s('pc_person_ids', v.pc_person_ids.filter((x) => x !== id))}><Icon name="x" /></button></span>)}
          <button className="btn sm" onClick={salva}>Salva</button>
        </div>
      </Card>

      <Card className="rs-gap" title="Categorie di spesa" icon="list" flush actions={<button className="btn sm" onClick={() => setModal({})}><Icon name="plus" />Nuova categoria</button>}>
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Categoria</th><th>Sezione</th><th className="num">Massimale per spesa</th><th className="num">Massimale al giorno</th><th>Giustificativo</th><th>Stato</th><th /></tr></thead>
          <tbody>{(cat.data || []).map((c) => <tr key={c.id}><td className="strong">{c.nome}</td><td className="small">{TIPI[c.tipo]}</td><td className="num">{c.massimale_spesa ? eur(c.massimale_spesa) : <span className="muted">nessuno</span>}</td><td className="num">{c.massimale_giorno ? eur(c.massimale_giorno) : <span className="muted">nessuno</span>}</td>
            <td>{c.giustificativo_obbligatorio ? <Badge tone="teal">obbligatorio</Badge> : <Badge tone="grey">facoltativo</Badge>}</td><td>{c.attiva ? 'attiva' : <span className="muted">disattivata</span>}</td><td className="actions"><button className="btn sm ghost" onClick={() => setModal(c)}>Modifica</button></td></tr>)}</tbody>
        </table></div>
      </Card>

      <Card className="rs-gap" title="Eccezioni al giustificativo obbligatorio" icon="shield">
        <p className="small">Per queste persone la foto dello scontrino è facoltativa (decisione del CEO del 13/11/2026). Il seme abbina i cognomi indicati solo se in anagrafica c'è un'unica persona attiva con quel cognome; le voci non abbinate restano qui e in Diagnostica (D58).</p>
        <div className="rs-ecc">{(ecc.data?.righe || []).map((e) => (
          <div key={e.id} className={`rs-ecc-r ${e.person_id ? '' : 'warn'}`}>
            <div><strong>{e.persona || e.cognome_seme}</strong> <span className="small muted">{e.origine === 'SEME' ? 'seme del CEO' : 'aggiunta a mano'}{e.nota ? ` · ${e.nota}` : ''}</span></div>
            {!e.person_id && <select value="" onChange={async (ev) => { if (!ev.target.value) return; try { await api.post('/eccezioni', { person_id: Number(ev.target.value), sostituisce_id: e.id }); ecc.reload(); } catch (x) { toast(x.message, 'err'); } }} aria-label="Abbina a"><option value="">Abbina a un dipendente</option>{persone.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>}
            <button className="iconbtn" aria-label="Elimina l'eccezione" onClick={async () => { await api.del(`/eccezioni/${e.id}`); ecc.reload(); }}><Icon name="trash" /></button>
          </div>))}</div>
        <div className="row rs-gap-t">
          <select value={pEcc} onChange={(e) => setPEcc(e.target.value)} aria-label="Dipendente"><option value="">Aggiungi un dipendente</option>{persone.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
          <button className="btn sm" disabled={!pEcc} onClick={async () => { try { await api.post('/eccezioni', { person_id: Number(pEcc) }); setPEcc(''); ecc.reload(); } catch (x) { toast(x.message, 'err'); } }}>Aggiungi</button>
          <button className="btn sm ghost" onClick={async () => { await api.post('/eccezioni/seme'); ecc.reload(); }}>Riprova il seme</button>
        </div>
      </Card>

      <Card className="rs-gap" title="Approvatori secondo l'organigramma" icon="tree" flush>
        <div className="table-wrap"><table className="t"><thead><tr><th>Dipendente</th><th>Approva</th><th>Da dove viene</th></tr></thead>
          <tbody>{persone.map((p) => <tr key={p.id}><td className="strong">{p.nome}</td><td>{p.al_pc ? <Badge tone="amber">P&C</Badge> : p.approvatore}</td><td className="small muted">{p.origine}</td></tr>)}</tbody></table></div>
      </Card>

      <Card title="Promemoria e modulistica" icon="clock">
        <div className="row"><button className="btn sm ghost" onClick={async () => { const r = await api.post('/job'); toast(`Promemoria: ${r.promemoria_bozze ?? 0} bozze, ${r.promemoria_responsabili ?? 0} responsabili, riepilogo P&C ${r.riepilogo_pc ?? 0}`); }}>Esegui adesso i promemoria</button></div>
        <ModuliCartacei />
      </Card>
      {modal && <CategoriaModal c={modal} onClose={() => setModal(null)} onOk={() => { setModal(null); cat.reload(); }} />}
    </div>
  );
}

function CategoriaModal({ c, onClose, onOk }) {
  const [x, setX] = useState({ nome: c.nome || '', tipo: c.tipo || 'SPESA', massimale_spesa: c.massimale_spesa != null ? String(c.massimale_spesa).replace('.', ',') : '', massimale_giorno: c.massimale_giorno != null ? String(c.massimale_giorno).replace('.', ',') : '', giustificativo_obbligatorio: c.giustificativo_obbligatorio !== false, attiva: c.attiva !== false, ordine: c.ordine ?? 100 });
  const [err, setErr] = useState(null);
  const s = (k, y) => setX((o) => ({ ...o, [k]: y }));
  const go = async () => { try { const b = { ...x, massimale_spesa: x.massimale_spesa || null, massimale_giorno: x.massimale_giorno || null }; if (c.id) await api.put(`/categorie/${c.id}`, b); else await api.post('/categorie', b); onOk(); } catch (e) { setErr(e); } };
  return (
    <Modal title={c.id ? `Categoria ${c.nome}` : 'Nuova categoria'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={x.nome.trim().length < 2} onClick={go}>Salva</button></>}>
      <ErrorBox error={err} />
      <div className="rs-form">
        <div className="rs-due"><Field label="Nome" required><input value={x.nome} onChange={(e) => s('nome', e.target.value)} /></Field>
          <Field label="Sezione"><select value={x.tipo} onChange={(e) => s('tipo', e.target.value)}>{Object.entries(TIPI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field></div>
        <div className="rs-tre"><Field label="Massimale per spesa (EUR)" help="Vuoto: nessuno"><input inputMode="decimal" value={x.massimale_spesa} onChange={(e) => s('massimale_spesa', e.target.value.replace(/[^\d,.]/g, ''))} /></Field>
          <Field label="Massimale al giorno (EUR)" help="Vuoto: nessuno"><input inputMode="decimal" value={x.massimale_giorno} onChange={(e) => s('massimale_giorno', e.target.value.replace(/[^\d,.]/g, ''))} /></Field>
          <Field label="Ordine"><input type="number" value={x.ordine} onChange={(e) => s('ordine', e.target.value)} /></Field></div>
        <label className="f inline"><input type="checkbox" checked={x.giustificativo_obbligatorio} onChange={(e) => s('giustificativo_obbligatorio', e.target.checked)} />Giustificativo obbligatorio per inviare</label>
        <label className="f inline"><input type="checkbox" checked={x.attiva} onChange={(e) => s('attiva', e.target.checked)} />Categoria attiva</label>
      </div>
    </Modal>
  );
}

