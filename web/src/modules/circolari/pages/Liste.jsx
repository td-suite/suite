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
      <PageHead title="Liste di distribuzione" icon="users" sub="A chi vanno le circolari. Service e Punti Prelievo sono automatiche: si compilano da sole dall'anagrafica a ogni invio. Interni è a scelta: i destinatari si selezionano dall'elenco del personale. Tutte accettano indirizzi aggiunti a mano. Le altre liste si compilano a mano o con le proposte dell'anagrafica." actions={<button className="btn" onClick={() => apri(null)}><Icon name="plus" />Nuova lista</button>} />
      <Card flush>
        {!data ? <Loading /> : !data.length ? <Empty icon="users" title="Nessuna lista">Crea la prima lista: i destinatari si propongono dall'anagrafica (sedi e organizzazioni con email).</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Lista</th><th>Segmento</th><th className="num">Destinatari</th><th className="num">Invii</th><th>Aggiornata</th><th></th></tr></thead>
            <tbody>{data.map((l) => <tr key={l.id} className="click" onClick={() => apri(l)}>
              <td><div className="strong">{l.nome} {l.automatica && <Badge tone="teal">{l.automatica === 'INTERNI' ? 'a scelta' : 'automatica'}</Badge>} {!l.attiva && <Badge tone="grey">disattivata</Badge>}</div><div className="small muted">{l.descrizione}</div></td>
              <td className="small">{SEGMENTO[l.segmento] || l.segmento}</td><td className="num">{l.n_destinatari}{l.automatica && l.n_manuali > 0 && <div className="small muted">{l.n_manuali} aggiunti a mano</div>}</td><td className="num">{l.n_invii}</td><td className="small">{itDateTime(l.updated_at)}</td>
              <td className="actions">{!l.automatica && <button className="iconbtn" aria-label="Elimina" onClick={(e) => { e.stopPropagation(); setDel(l); }}><Icon name="trash" /></button>}</td>
            </tr>)}</tbody>
          </table></div>)}
      </Card>
      <TestoEmail />
      {modal && <ListaModal lista={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {del && <ConfirmModal title={`Eliminare la lista "${del.nome}"?`} text="Gli invii già registrati restano in archivio." confirmText="Elimina" danger onClose={() => setDel(null)} onConfirm={async () => { try { await api.del(`/liste/${del.id}`); toast('Lista eliminata'); setDel(null); reload(); } catch (e) { toast(e, 'err'); } }} />}
    </div>
  );
}

function ListaModal({ lista, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ ...lista, destinatari: lista.destinatari || [], persone: (lista.persone || []).map(Number) });
  const [cerca, setCerca] = useState('');
  const interni = f.automatica === 'INTERNI';
  const personale = lista.personale || [];
  const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const parole = norm(cerca).split(/\s+/).filter(Boolean);
  const visibili = personale.filter((x) => { const t = norm(`${x.nome} ${x.email} ${x.sede} ${x.ruolo} ${x.tipo}`); return parole.every((w) => t.includes(w)); });
  const scelta = new Set(f.persone);
  const nScelti = personale.filter((x) => scelta.has(x.person_id)).length;
  const spunta = (ids, on) => { const s2 = new Set(f.persone); for (const id of ids) { if (on) s2.add(id); else s2.delete(id); } upd('persone', [...s2]); };
  const [nuovo, setNuovo] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const has = (email) => f.destinatari.some((d) => d.email === email);
  const aggiungi = (d) => { if (!d.email || has(d.email)) return; upd('destinatari', [...f.destinatari, { nome: '', organizzazione: '', ...d }]); };
  const proponi = async () => { setBusy(true); try { const rows = await api.get(`/liste/proposte?segmento=${f.segmento}`); let n = 0; const add = []; for (const r of rows) if (!has(r.email) && !add.some((x) => x.email === r.email)) { add.push(r); n++; } upd('destinatari', [...f.destinatari, ...add]); toast(n ? `${n} destinatari proposti dall'anagrafica` : 'Nessun destinatario nuovo nell\'anagrafica per questo segmento'); } catch (e) { toast(e, 'err'); } setBusy(false); };
  // v0.99.8: più indirizzi incollati insieme entrano TUTTI (prima ne restava solo l'ultimo: ogni aggiunta ripartiva dallo stesso elenco)
  // e quelli non validi restano nel riquadro, così si vedono e si correggono
  const leggi = (testo) => { const pezzi = testo.split(/[\s,;<>()"']+/).map((x) => x.trim().toLowerCase().replace(/^mailto:/, '').replace(/[.:]+$/, '')).filter(Boolean); const ok = [...new Set(pezzi.filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))]; return { ok, scarti: pezzi.filter((x) => x.includes('@') && !ok.includes(x)) }; };
  const unisci = (elenco, emails) => [...elenco, ...emails.filter((e) => !elenco.some((d) => d.email === e)).map((email) => ({ email, nome: '', organizzazione: '' }))];
  const incolla = () => { const { ok, scarti } = leggi(nuovo); const prima = f.destinatari.length; const dopo = unisci(f.destinatari, ok); upd('destinatari', dopo); setNuovo(scarti.join(', '));
    toast(ok.length ? `${dopo.length - prima} indirizzi aggiunti${ok.length - (dopo.length - prima) ? `, ${ok.length - (dopo.length - prima)} già presenti` : ''}${scarti.length ? `, ${scarti.length} non validi rimasti nel riquadro` : ''}` : 'Nessun indirizzo valido nel testo', ok.length ? undefined : 'err'); };
  const salva = async () => {
    setBusy(true);
    // gli indirizzi ancora nel riquadro "Aggiungi indirizzi" entrano nella lista anche se non si è premuto Aggiungi
    const { ok, scarti } = leggi(nuovo);
    if (scarti.length) { toast(`Indirizzi non validi nel riquadro: ${scarti.slice(0, 3).join(', ')}. Correggili o toglili prima di salvare`, 'err'); setBusy(false); return; }
    const dati = { ...f, destinatari: unisci(f.destinatari, ok) };
    try { if (f.id) await api.put(`/liste/${f.id}`, dati); else await api.post('/liste', dati); toast(`Lista salvata: ${dati.destinatari.length} indirizzi${interni ? ` e ${nScelti} persone scelte` : ''}`); onSaved(); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  return <Modal title={f.id ? `Lista: ${lista.nome}` : 'Nuova lista'} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button><button className="btn" disabled={busy} onClick={salva}><Icon name="check" />Salva</button></>}>
    <div className="circ-form">
      <div className="two">
        <Field label="Nome" required><input value={f.nome} onChange={(e) => upd('nome', e.target.value)} maxLength={120} /></Field>
        <Field label="Segmento"><select value={f.segmento} disabled={Boolean(f.automatica)} onChange={(e) => upd('segmento', e.target.value)}>{Object.entries(SEGMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      <Field label="Descrizione"><input value={f.descrizione} onChange={(e) => upd('descrizione', e.target.value)} maxLength={500} /></Field>
      <label className="f inline"><input type="checkbox" checked={f.attiva} onChange={(e) => upd('attiva', e.target.checked)} /> lista attiva</label>
      {interni && <>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 6 }}><b>Destinatari scelti dal personale ({nScelti} su {personale.length})</b>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm ghost" onClick={() => spunta(visibili.map((x) => x.person_id), true)}>Seleziona {cerca ? 'i trovati' : 'tutti'}</button>
            <button type="button" className="btn sm ghost" onClick={() => spunta(visibili.map((x) => x.person_id), false)}>Togli {cerca ? 'i trovati' : 'tutti'}</button>
          </span></div>
        <input type="search" value={cerca} placeholder="Cerca per nome, sede, ruolo o indirizzo" onChange={(e) => setCerca(e.target.value)} />
        <div className="circ-dest" style={{ maxHeight: 320 }}>{!personale.length ? <div className="small muted" style={{ padding: 10 }}>Nessuna persona in elenco: servono dipendenti o liberi professionisti attivi con un utente attivo della Suite.</div> : !visibili.length ? <div className="small muted" style={{ padding: 10 }}>Nessuno corrisponde alla ricerca.</div> : <table><tbody>{visibili.map((x) => <tr key={x.person_id} className="click" onClick={() => spunta([x.person_id], !scelta.has(x.person_id))}>
          <td style={{ width: 30 }}><input type="checkbox" checked={scelta.has(x.person_id)} readOnly aria-label={`Seleziona ${x.nome}`} /></td>
          <td className="small strong">{x.nome}</td><td className="small">{[x.tipo, x.sede].filter(Boolean).join(' · ')}</td><td className="small muted">{x.ruolo}</td><td className="mono small">{x.email}</td>
        </tr>)}</tbody></table>}</div>
        <div className="small muted">In elenco: dipendenti e liberi professionisti attivi con utente della Suite; l'indirizzo è quello di lavoro dell'utente. Chi cessa esce da solo dalla lista. La scelta vale dopo Salva.</div>
      </>}
      {f.automatica && !interni && <>
        <div className="row between"><b>Destinatari automatici ({(lista.automatici || []).length})</b><span className="small muted">calcolati adesso dall'anagrafica, non si modificano qui</span></div>
        <div className="circ-dest" style={{ maxHeight: 220 }}>{!(lista.automatici || []).length ? <div className="small muted" style={{ padding: 10 }}>Nessun destinatario trovato in anagrafica: mancano le email, oppure gli utenti collegati alle persone.</div> : <table><tbody>{lista.automatici.map((d) => <tr key={d.email}><td style={{ width: '38%' }} className="mono small">{d.email}</td><td className="small">{d.nome}</td><td className="small muted">{d.perche}</td></tr>)}</tbody></table>}</div>
      </>}
      <div className="row between"><b>{f.automatica ? 'Indirizzi aggiunti a mano' : 'Destinatari'} ({f.destinatari.length})</b>{!f.automatica && <button className="btn sm ghost" disabled={busy} onClick={proponi}><Icon name="import" />Proponi dall'anagrafica</button>}</div>
      <div className="circ-dest">
        {!f.destinatari.length ? <div className="small muted" style={{ padding: 10 }}>{f.automatica ? 'Nessun indirizzo aggiunto. Incolla sotto quelli che l\'anagrafica non ha.' : 'Nessun destinatario. Proponi dall\'anagrafica o incolla gli indirizzi sotto.'}</div> : <table><tbody>{f.destinatari.map((d, i) => <tr key={d.email}>
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

// Testo dell'email di invio (v0.99.4): oggetto e messaggio predefiniti di ogni invio, con i segnaposto; nell'invio si possono ritoccare
function TestoEmail() {
  const toast = useToast();
  const { data, reload } = useApi('/email-testo');
  const [f, setF] = useState(null);
  const v = f || data;
  if (!v) return null;
  const salva = async () => { try { await api.put('/email-testo', { email_oggetto: v.email_oggetto, email_testo: v.email_testo, email_mittente: v.email_mittente, email_cc: v.email_cc || '' }); toast('Testo dell\'email salvato'); setF(null); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <Card title="Email di invio: mittente, copia e testo" icon="mail" style={{ marginTop: 16 }} actions={<div className="row" style={{ gap: 6 }}>{f && <button className="btn sm ghost" onClick={() => setF({ ...v, ...data.predefinito })}>Testo predefinito</button>}<button className="btn sm" disabled={!f} onClick={salva}>Salva</button></div>}>
      <div className="circ-form">
        <div className="two">
          <Field label="Mittente" help="La casella da cui parte la circolare. La Suite deve essere autorizzata a inviare da questa casella."><input type="email" value={v.email_mittente || ''} maxLength={200} onChange={(e) => setF({ ...v, email_mittente: e.target.value })} /></Field>
          <Field label="In copia (Cc)" help="Uno o più indirizzi separati da virgola. In A vanno i firmatari della circolare; i destinatari delle liste vanno sempre in Ccn."><input value={v.email_cc || ''} maxLength={600} onChange={(e) => setF({ ...v, email_cc: e.target.value })} /></Field>
        </div>
        <Field label="Oggetto"><input value={v.email_oggetto} maxLength={200} onChange={(e) => setF({ ...v, email_oggetto: e.target.value })} /></Field>
        <Field label="Messaggio" help={`Segnaposto: ${(data.segnaposto || []).map((x) => `{${x}}`).join(', ')}. Sotto il messaggio l'email porta sempre titolo e sintesi della circolare, il collegamento alla versione digitale, il pulsante di conferma di lettura e le firme.`}><textarea rows={7} value={v.email_testo} maxLength={3000} onChange={(e) => setF({ ...v, email_testo: e.target.value })} /></Field>
      </div>
    </Card>
  );
}
