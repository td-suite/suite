// Sedi invianti sull'anagrafica unica della Suite: l'elenco viene da Amministrazione > Sedi (public.sites); qui si impostano
// solo le impostazioni NC della sede (codice StudioLAB, canale ed email di notifica, SLA, attiva per NC). Niente creazione,
// rinomina o eliminazione di sedi: pulsante "Apri in Amministrazione".
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, base } from '../api.js';
import { useAuth, isQualita } from '../auth.jsx';
import { useApi, Card, Field, Loading, Empty, Badge, Modal, ErrorBox, useToast, Icon } from '../components/ui.jsx';
import { SEDE_TIPO, SEDE_CANALE, itDateTime } from '../format.js';

const EMPTY = { codice_lis: '', canale: 'EMAIL', email_nc: '', pec: '', email_cc: '', sla_ore: '', attiva: true, note: '' };

export default function Sedi() {
  const { user } = useAuth();
  const toast = useToast();
  const [tutte, setTutte] = useState(false);
  const [soloConfigurate, setSoloConfigurate] = useState(false);
  const { data, reload } = useApi(`/sedi${tutte ? '?tutte=1' : ''}`);
  const [modal, setModal] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const q2 = isQualita(user);
  const openEdit = (s) => { setF({ ...EMPTY, ...Object.fromEntries(Object.entries(s).filter(([k]) => k in EMPTY).map(([k, v]) => [k, v ?? ''])) }); setErr(null); setModal(s); };
  const save = async () => {
    setErr(null);
    try {
      const body = { ...f, sla_ore: f.sla_ore === '' ? null : Number(f.sla_ore) };
      await api.put(`/sedi/${modal.id}`, body);
      setModal(null); toast('Impostazioni NC della sede salvate'); reload();
    } catch (e) { setErr(e); }
  };
  const rows = (data || []).filter((s) => (!soloConfigurate || s.configurata) && (!q || `${s.nome} ${s.codice} ${s.suite_code || ''} ${s.citta || ''}`.toLowerCase().includes(q.toLowerCase())));
  const nConf = (data || []).filter((s) => s.configurata).length;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sedi invianti</h1><div className="sub">Le sedi sono quelle dell'anagrafica unica della Suite (Amministrazione, Sedi). Qui si impostano solo i dati che servono alle non conformità: codice cliente StudioLAB, canale ed email di notifica, SLA di risposta, sede attiva per le NC.</div></div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn ghost" href="/admin/sites" title="Creare, rinominare o disattivare una sede si fa in Amministrazione"><Icon name="building" /> Apri in Amministrazione</a>
        </div>
      </div>
      {data && !nConf && <div className="alert info" style={{ marginBottom: 14 }}><div>Nessuna sede ha ancora le impostazioni NC: scegli <b>Modifica</b> sulle sedi invianti e indica almeno l'email che riceve le non conformità (se vuota si usa l'email della sede in Amministrazione).</div></div>}
      <div className="filters">
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome, codice, città" /></Field>
        <label className="f inline"><input type="checkbox" checked={soloConfigurate} onChange={(e) => setSoloConfigurate(e.target.checked)} /> solo sedi con impostazioni NC</label>
        <label className="f inline"><input type="checkbox" checked={tutte} onChange={(e) => setTutte(e.target.checked)} /> mostra anche le sedi disattivate</label>
      </div>
      <Card flush>
        {!data ? <Loading /> : !rows.length ? <Empty>Nessuna sede{!data.length && <>: le sedi si caricano in <a href="/admin/sites">Amministrazione</a></>}</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Sede</th><th>Tipo</th><th>Codice StudioLAB</th><th>Notifiche NC</th><th className="num">SLA</th><th className="num" title="NC aperte / NC negli ultimi 90 giorni">NC aperte / 90 gg</th><th></th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td style={{ minWidth: 210 }}><div className="strong">{s.nome}</div><div className="small muted" style={{ whiteSpace: 'normal' }}><span className="mono" style={{ whiteSpace: 'normal' }}>{s.suite_code}</span>{s.citta ? ` · ${s.citta}` : ''} {!s.attiva_suite ? <Badge tone="grey">disattivata in Suite</Badge> : !s.attiva ? <Badge tone="grey">non riceve NC</Badge> : null}</div></td>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>{SEDE_TIPO[s.tipo] || s.tipo}</td>
                <td className="small mono">{s.codice_lis || s.studiolab_code || <span className="muted" title="Nessun codice StudioLAB: si usa il codice della sede in Amministrazione">{s.suite_code}</span>}{s.lis_synced_at && <div className="muted">LIS {itDateTime(s.lis_synced_at)}</div>}</td>
                <td className="small" style={{ wordBreak: 'break-word', maxWidth: 260 }}>{s.canale === 'NESSUNO' ? <span className="muted">nessuna notifica</span> : s.canale === 'PORTALE' ? <span>solo utenti di sede ({s.n_utenti})</span> : s.email_effettiva ? <span>{s.email_effettiva}{s.canale === 'PEC' && <span className="muted"> (PEC)</span>}{!s.email_nc && !s.pec && <span className="muted" title="Email della sede in Amministrazione: qui non è stata impostata una casella NC"> (Suite)</span>}</span> : <span className="red">email mancante</span>}{s.email_cc && <div className="muted">cc {s.email_cc}</div>}{s.n_utenti > 0 && s.canale !== 'PORTALE' && <div className="muted">+ {s.n_utenti} {s.n_utenti === 1 ? 'utente di sede' : 'utenti di sede'}</div>}</td>
                <td className="num small">{s.sla_ore ? `${s.sla_ore} h` : <span className="muted">default</span>}</td>
                <td className="num"><Link to={`${base}/nc?sede=${s.id}`} title="Apri le non conformità della sede" style={{ textDecoration: 'none', color: 'inherit' }}>{s.nc_aperte > 0 ? <Badge tone="yellow">{s.nc_aperte}</Badge> : <span className="muted">0</span>} <span className="muted small">/ {s.nc_90gg}</span></Link></td>
                <td style={{ whiteSpace: 'nowrap' }}><div className="row end" style={{ gap: 6, flexWrap: 'nowrap' }}>{q2 && <button className="btn sm ghost" onClick={() => openEdit(s)}>Modifica</button>}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {modal && <Modal title={`Impostazioni NC · ${modal.nome}`} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
        <ErrorBox error={err} />
        <div className="small muted" style={{ marginBottom: 10 }}>Nome, tipo, indirizzo e contatti della sede si modificano in <a href="/admin/sites">Amministrazione</a> ({modal.suite_code}{modal.telefono ? ` · ${modal.telefono}` : ''}{modal.email_suite ? ` · ${modal.email_suite}` : ''}).</div>
        <div className="form-grid">
          <Field label="Codice cliente StudioLAB" help={modal.studiolab_code ? `In Amministrazione: ${modal.studiolab_code}. Compila solo se il LIS usa un codice diverso.` : 'Codice con cui StudioLAB identifica la sede (HL7 ORC-13); vuoto = codice della sede in Amministrazione'}><input value={f.codice_lis} onChange={(e) => setF({ ...f, codice_lis: e.target.value })} placeholder={modal.studiolab_code || modal.suite_code} /></Field>
          <Field label="Canale di invio"><select value={f.canale} onChange={(e) => setF({ ...f, canale: e.target.value })}>{Object.entries(SEDE_CANALE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Email NC" help={modal.email_suite ? `Se vuota si usa l'email della sede in Amministrazione: ${modal.email_suite}` : 'Casella che riceve le non conformità'}><input value={f.email_nc} onChange={(e) => setF({ ...f, email_nc: e.target.value })} placeholder="qualita@sede.it" disabled={f.canale === 'NESSUNO' || f.canale === 'PORTALE'} /></Field>
          <Field label="PEC" help="Usata quando il canale è PEC"><input value={f.pec} onChange={(e) => setF({ ...f, pec: e.target.value })} placeholder="sede@pec.it" disabled={f.canale !== 'PEC'} /></Field>
          <Field label="In copia (CC)" help="Più indirizzi separati da virgola"><input value={f.email_cc} onChange={(e) => setF({ ...f, email_cc: e.target.value })} disabled={f.canale === 'NESSUNO' || f.canale === 'PORTALE'} /></Field>
          <Field label="SLA risposta (ore lavorative)" help="Vuoto = valore globale delle impostazioni"><input type="number" min="1" max="240" value={f.sla_ore} onChange={(e) => setF({ ...f, sla_ore: e.target.value })} /></Field>
          <Field label="Riceve non conformità"><select value={f.attiva ? '1' : '0'} onChange={(e) => setF({ ...f, attiva: e.target.value === '1' })}><option value="1">Sì, sede attiva per le NC</option><option value="0">No, non si aprono NC su questa sede</option></select></Field>
        </div>
        <Field label="Note" className="mt"><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </Modal>}
    </div>
  );
}
