import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth, isOwner } from '../../auth.jsx';
import { useApi, Card, Badge, Skeleton, Empty, ErrorBox, PageHead, Field, useToast, Switch, Modal, ConfirmModal, Popover } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { fmtDateTime, AREA_COLORS, AREA_NAMES } from '../../format.js';

const AREA_ORDER = ['DIREZIONE', 'FINANCE', 'RETAIL_FLOW', 'OPERATIONS', 'HQS', 'PEOPLE', 'COMMUNITY'];
export const modulesByArea = (mods) => {
  const m = {};
  for (const mod of (mods || []).filter((x) => x.active !== false && x.key !== 'admin')) (m[mod.area] ||= []).push(mod);
  return Object.entries(m).sort(([a], [b]) => AREA_ORDER.indexOf(a) - AREA_ORDER.indexOf(b));
};

// ---------- Rapporto di un'applicazione (usato anche in Utenti) ----------
// Assegnazione con "Sostituisci i permessi esistenti" (richiesta del CEO dell'08/11/2026): il rapporto dice "sostituito X → Y" e la sede
// assegnata come ambito; chi non ha una sede in anagrafica ha il link ad Anagrafica > Persone.
export function ProfileReport({ report, compact }) {
  if (!report) return null;
  const n = (v, s, p) => `${v} ${v === 1 ? s : p}`;
  const sostituiti = (report.rows || []).flatMap((r) => (r.sostituiti || []).map((x) => ({ ...x, utente: r.full_name })));
  const ambiti = (report.rows || []).filter((r) => r.ambito_sede);
  const modo = { sovrascrivi: ' (permessi esistenti sostituiti)', replace: ' (sostituzione completa)', merge: ' (solo aggiunte)' }[report.mode] || '';
  return (
    <div className="col" style={{ gap: 10 }} data-testid="rapporto-profilo">
      <div className="alert ok"><Icon name="check" /><span>Profilo <b>{report.profile?.name}</b> applicato a {n(report.users, 'utente', 'utenti')}{modo}.</span></div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="green">{n(report.added, 'permesso aggiunto', 'permessi aggiunti')}</Badge>
        {report.replaced > 0 && <Badge tone="teal">{n(report.replaced, 'sostituito', 'sostituiti')}</Badge>}
        <Badge tone="blue">{n(report.updated, 'aggiornato', 'aggiornati')}</Badge>
        <Badge tone="grey">{n(report.kept, 'già uguale', 'già uguali')}</Badge>
        {report.removed > 0 && <Badge tone="red">{n(report.removed, 'rimosso', 'rimossi')}</Badge>}
        {report.warnings?.length > 0 && <Badge tone="amber">{n(report.warnings.length, 'avviso', 'avvisi')}</Badge>}
      </div>
      {sostituiti.length > 0 && <div className="small"><b>Sostituiti:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{sostituiti.slice(0, compact ? 10 : 80).map((x, i) => <li key={i}>{report.users > 1 ? `${x.utente}: ` : ''}{x.modulo}: sostituito <b>{x.da}</b> → <b>{x.a}</b>{x.ambito ? <> · ambito: {x.ambito}</> : null}</li>)}</ul></div>}
      {ambiti.length > 0 && <div className="small muted">Ambito di sede: {ambiti.slice(0, 6).map((r) => `${report.users > 1 ? `${r.full_name}: ` : ''}${r.ambito_sede.nome} (dalla ${r.ambito_sede.fonte === 'anagrafica' ? 'sede in anagrafica' : r.ambito_sede.fonte === 'contratto di lavoro' ? 'sede del contratto di lavoro' : 'sede dell\'utente'})`).join('; ')}{ambiti.length > 6 ? ` e altri ${ambiti.length - 6}` : ''}.</div>}
      {report.sede_mancante?.length > 0 && <div className="alert warn small" style={{ alignItems: 'flex-start' }} data-testid="sede-mancante"><Icon name="alert" /><span>{report.sede_mancante.length === 1 ? `${report.sede_mancante[0].nome} non ha` : `${report.sede_mancante.length} persone non hanno`} una sede in anagrafica: i permessi per sede sono nati senza ambito. Assegna la sede alla persona in <b>Anagrafica &gt; Persone</b>, poi riapplica il profilo: {report.sede_mancante.slice(0, 8).map((x, i) => <React.Fragment key={x.user_id}>{i ? ', ' : ''}<Link to={x.link}>{x.nome}</Link></React.Fragment>)}{report.sede_mancante.length > 8 ? '…' : ''}</span></div>}
      {report.warnings?.length > 0 && <div className="alert warn small" style={{ alignItems: 'flex-start' }}><Icon name="alert" /><ul style={{ margin: 0, paddingLeft: 18 }}>{report.warnings.slice(0, compact ? 8 : 60).map((w, i) => <li key={i}>{w}</li>)}{report.warnings.length > (compact ? 8 : 60) && <li>… e altri {report.warnings.length - (compact ? 8 : 60)}</li>}</ul></div>}
      {!compact && report.rows?.length > 1 && <div className="table-wrap"><table className="t"><thead><tr><th>Utente</th><th>Aggiunti</th><th>Sostituiti</th><th>Aggiornati</th><th>Già uguali</th><th>Avvisi</th></tr></thead><tbody>
        {report.rows.map((r) => <tr key={r.user_id}><td><div className="strong">{r.full_name}</div><div className="tiny muted">{r.email}</div></td><td>{r.added}</td><td>{(r.sostituiti || []).length}</td><td>{r.updated}</td><td>{r.kept}</td><td className="small">{r.warnings.length ? r.warnings.join('; ') : <span className="faint">nessuno</span>}</td></tr>)}
      </tbody></table></div>}
    </div>
  );
}

// ---------- Conferma dell'assegnazione con la spunta "Sostituisci i permessi esistenti" (Utenti: elenco e scheda; Profili: Applica) ----------
// Spunta accesa (predefinita): per ogni widget del profilo il permesso esistente viene sostituito (ruolo e ambito di sede). Spenta:
// si aggiungono solo i permessi mancanti e quelli assegnati a mano restano. users: [{ id, full_name }] se già scelti; senza, la modale
// mostra la ricerca degli utenti (pagina Profili di accesso > Applica).
export function ApplyProfileModal({ profile, users = null, onClose, onDone }) {
  const [sostituisci, setSostituisci] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [qtext, setQtext] = useState('');
  const [scelti, setScelti] = useState([]);
  const cerca = useApi(users ? null : `/users${qtext.trim().length >= 2 ? `?qtext=${encodeURIComponent(qtext.trim())}&pageSize=20` : '?pageSize=20'}`, [qtext]);
  const elenco = users || scelti;
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post(`/access-profiles/${profile.id}/apply`, { user_ids: elenco.map((u) => u.id), mode: sostituisci ? 'sovrascrivi' : 'merge' }); onDone(r); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const nomi = elenco.slice(0, 6).map((u) => u.full_name).join(', ') + (elenco.length > 6 ? ` e altri ${elenco.length - 6}` : '');
  return (
    <Modal title={`Assegnare il profilo "${profile.name}"${elenco.length ? ` a ${elenco.length === 1 ? elenco[0].full_name : `${elenco.length} utenti`}` : ''}?`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !elenco.length} onClick={go}>{busy ? 'Assegnazione…' : 'Assegna'}</button></>}>
      <ErrorBox error={err} />
      {!users && <div className="col" style={{ gap: 6, marginBottom: 10 }}>
        <Field label="Utenti a cui assegnarlo"><input value={qtext} onChange={(e) => setQtext(e.target.value)} placeholder="Cerca per nome o email" aria-label="Cerca utenti" /></Field>
        <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          {(cerca.data?.rows || []).map((u) => { const on = scelti.some((x) => x.id === u.id); return (
            <label key={u.id} className="row small" style={{ gap: 8, padding: '6px 10px', cursor: 'pointer' }}><input type="checkbox" checked={on} onChange={() => setScelti(on ? scelti.filter((x) => x.id !== u.id) : [...scelti, { id: u.id, full_name: u.full_name }])} /><span className="strong">{u.full_name}</span><span className="muted">{u.email}</span>{u.site_name && <span className="tiny muted">· {u.site_name}</span>}</label>
          ); })}
          {cerca.data && !(cerca.data.rows || []).length && <div className="small muted" style={{ padding: 10 }}>Nessun utente trovato.</div>}
        </div>
        {scelti.length > 0 && <div className="small">Scelti: {nomi}</div>}
      </div>}
      <p className="small" style={{ marginTop: 0 }}>{users ? <>Utenti: {nomi}. </> : null}Il profilo ha {(profile.items || []).length} widget. Sui widget per sede l'ambito è la sede della persona (anagrafica, altrimenti la sede del contratto di lavoro): se la persona non ha una sede il rapporto lo segnala con il link ad Anagrafica &gt; Persone.</p>
      <label style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}><input type="checkbox" checked={sostituisci} onChange={(e) => setSostituisci(e.target.checked)} aria-label="Sostituisci i permessi esistenti" style={{ marginTop: 3, width: 16, height: 16, flex: '0 0 auto' }} />
        <span style={{ flex: 1 }}><b>Sostituisci i permessi esistenti</b><span className="small muted" style={{ display: 'block' }}>{sostituisci ? 'Per ogni widget del profilo il permesso che la persona aveva (anche assegnato a mano) viene sostituito da quello del profilo, ruolo e ambito. I permessi sugli altri widget restano.' : 'Si aggiungono solo i permessi mancanti; quelli già presenti assegnati a mano restano com\'erano.'}</span></span></label>
    </Modal>
  );
}

// ---------- Tendina "Assegna profilo" (usata in Utenti: elenco e scheda) ----------
export function ProfilePicker({ label = 'Assegna profilo', onPick, className = 'btn sm', disabled }) {
  const [open, setOpen] = useState(false);
  const profiles = useApi('/access-profiles');
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className={className} disabled={disabled} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}><Icon name="shield" />{label}<Icon name="chevronDown" /></button>
      <Popover open={open} onClose={() => setOpen(false)} className="profile-pop">
        {profiles.loading && <div style={{ padding: 12 }}><Skeleton lines={2} /></div>}
        {profiles.data && !profiles.data.length && <div className="small muted" style={{ padding: 12 }}>Nessun profilo di accesso definito.</div>}
        {(profiles.data || []).map((p) => (
          <button key={p.id} type="button" className="item" role="menuitem" onClick={() => { setOpen(false); onPick(p); }}>
            <Icon name="shield" /><span style={{ flex: 1 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{p.name}{p.is_default && <Badge tone="teal">Default</Badge>}</span><div className="tiny muted" style={{ fontWeight: 500 }}>{(p.items || []).length} widget</div></span>
          </button>
        ))}
      </Popover>
    </div>
  );
}

// ---------- Elenco ----------
export function AccessProfiles() {
  const { user: me } = useAuth();
  const owner = isOwner(me);
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/access-profiles');
  const mods = useApi('/modules');
  const [edit, setEdit] = useState(null);      // profilo in modifica, o 'new'
  const [del, setDel] = useState(null);
  const [applyAll, setApplyAll] = useState(false);
  const [applica, setApplica] = useState(null);   // profilo da assegnare a utenti scelti qui
  const [report, setReport] = useState(null);
  const def = (data || []).find((p) => p.is_default);
  const modName = (k) => (mods.data || []).find((m) => m.key === k)?.name || k;
  const profLabel = (k, pk) => (mods.data || []).find((m) => m.key === k)?.profiles?.find((p) => p.key === pk)?.label || pk;
  return (
    <div className="page">
      <PageHead title="Profili di accesso" icon="shield" sub="Pacchetti di permessi sui widget: si assegnano con un clic a uno o più utenti, dall'elenco Utenti o dalla scheda"
        actions={<>
          <button className="btn ghost" disabled={!def} title={!def ? 'Nessun profilo predefinito' : undefined} onClick={() => setApplyAll(true)}><Icon name="users" />Applica il Default a tutti gli utenti</button>
          {owner && <button className="btn" onClick={() => setEdit('new')}><Icon name="plus" />Nuovo profilo</button>}
        </>} />
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !data.length && <Empty icon="shield" title="Nessun profilo di accesso">Crea il primo profilo: un insieme di widget con il profilo di ciascuno.</Empty>}
        {data?.length > 0 && <div className="table-wrap"><table className="t profiles-t">
          <thead><tr><th>Profilo</th><th>Widget inclusi</th><th>Utenti</th><th>Aggiornato</th><th></th></tr></thead>
          <tbody>{data.map((p) => (
            <tr key={p.id} className="click" onClick={() => setEdit(p)}>
              <td><div className="strong" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{p.name}{p.is_default && <Badge tone="teal" title="Applicato automaticamente a ogni nuovo utente">Default</Badge>}{p.system && <Badge tone="amber" title="Profilo di sistema per gli accessi esterni (scheda Legal entity): nome fisso, non eliminabile; gli ambiti si risolvono dalla Legal entity">Di sistema · esterni</Badge>}</div>{p.description && <div className="small muted">{p.description}</div>}</td>
              <td><div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{(p.items || []).map((it) => <span key={it.module_key} className="chip" title={profLabel(it.module_key, it.profile)}>{modName(it.module_key)} · {profLabel(it.module_key, it.profile)}</span>)}{!(p.items || []).length && <span className="faint">nessun widget</span>}</div></td>
              <td className="small nowrap">{p.users_count} utent{p.users_count === 1 ? 'e' : 'i'}</td>
              <td className="small nowrap">{fmtDateTime(p.updated_at)}</td>
              <td className="actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn sm ghost" onClick={() => setApplica(p)}><Icon name="users" />Applica</button>
                <button className="iconbtn" aria-label={owner ? 'Modifica' : 'Apri'} title={owner ? 'Modifica' : 'Apri'} onClick={() => setEdit(p)}><Icon name={owner ? 'edit' : 'eye'} /></button>
                {owner && !p.system && <button className="iconbtn danger" aria-label="Elimina" title="Elimina" onClick={() => setDel(p)}><Icon name="trash" /></button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>}
        <div className="small muted" style={{ padding: 14 }}>Il profilo <b>Default</b> viene assegnato automaticamente a ogni nuovo account. L'assegnazione (Applica, oppure Utenti > Assegna profilo) sostituisce, per i widget del profilo, i permessi che la persona aveva (spunta "Sostituisci i permessi esistenti", accesa di base); sui widget per sede l'ambito è la sede della persona. L'applicazione automatica del Default ai nuovi account aggiunge soltanto. {!owner && 'La creazione e la modifica dei profili sono riservate al titolare.'}</div>
      </Card>
      {edit && <ProfileModal profile={edit === 'new' ? null : edit} modules={mods.data || []} readOnly={!owner} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {del && <ConfirmModal title={`Eliminare il profilo "${del.name}"?`} danger confirmText="Elimina" text={`I permessi già assegnati a ${del.users_count} utent${del.users_count === 1 ? 'e restano' : 'i restano'}: perdono solo il collegamento al profilo.`}
        onConfirm={async () => { await api.del(`/access-profiles/${del.id}`); toast('Profilo eliminato'); reload(); }} onClose={() => setDel(null)} />}
      {applyAll && <ConfirmModal title={`Applicare "${def?.name}" a tutti gli utenti?`} confirmText="Applica a tutti"
        text="A ogni utente attivo o in attesa vengono aggiunti i permessi del profilo predefinito che ancora mancano. I permessi esistenti non vengono tolti né declassati; sui widget per sede l'ambito è la sede della persona."
        onConfirm={async () => { const r = await api.post('/access-profiles/default/apply-all'); setReport(r); reload(); }} onClose={() => setApplyAll(false)} />}
      {applica && <ApplyProfileModal profile={applica} onClose={() => setApplica(null)} onDone={(r) => { setApplica(null); setReport(r); toast(`Profilo applicato: ${r.added} aggiunti, ${r.replaced || 0} sostituiti`); reload(); }} />}
      {report && <Modal title="Rapporto dell'assegnazione" wide onClose={() => setReport(null)} footer={<button className="btn" onClick={() => setReport(null)}>Chiudi</button>}><ProfileReport report={report} /></Modal>}
    </div>
  );
}

// ---------- Modifica / creazione ----------
function ProfileModal({ profile, modules, readOnly, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !profile;
  const [f, setF] = useState({ name: '', description: '', is_default: false });
  const [items, setItems] = useState({});   // module_key → profile
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF({ name: profile?.name || '', description: profile?.description || '', is_default: Boolean(profile?.is_default) });
    setItems(Object.fromEntries((profile?.items || []).map((it) => [it.module_key, it.profile])));
  }, [profile]);
  const byArea = useMemo(() => modulesByArea(modules), [modules]);
  const n = Object.keys(items).length;
  const save = async (e) => {
    e?.preventDefault(); setBusy(true);
    try {
      const body = { name: f.name.trim(), description: f.description.trim() || null, is_default: f.is_default, items: Object.entries(items).map(([module_key, profile]) => ({ module_key, profile })) };
      if (isNew) await api.post('/access-profiles', body); else await api.put(`/access-profiles/${profile.id}`, body);
      toast(isNew ? 'Profilo creato' : 'Profilo aggiornato'); onSaved();
    } catch (e2) { toast(e2, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={isNew ? 'Nuovo profilo di accesso' : readOnly ? profile.name : `Modifica ${profile.name}`} wide onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{readOnly ? 'Chiudi' : 'Annulla'}</button>{!readOnly && <button className="btn" form="pform" disabled={busy || !f.name.trim()}>{isNew ? 'Crea profilo' : 'Salva'}</button>}</>}>
      <form id="pform" onSubmit={save} className="col">
        <div className="form-grid">
          <Field label="Nome" required help={profile?.system ? 'Profilo di sistema per gli accessi esterni: il nome non si cambia' : undefined}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} disabled={readOnly || Boolean(profile?.system)} autoFocus={isNew} /></Field>
          <Field label="Descrizione"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={400} disabled={readOnly} /></Field>
        </div>
        <label className="f inline" style={{ alignItems: 'center', gap: 10 }}><Switch checked={f.is_default} onChange={(v) => setF({ ...f, is_default: v })} disabled={readOnly || Boolean(profile?.system)} label="Profilo predefinito per tutti i nuovi utenti" /><span>Profilo predefinito per tutti i nuovi utenti<span className="help" style={{ display: 'block' }}>{profile?.system ? 'Non disponibile per i profili di sistema degli accessi esterni: il predefinito vale per ogni nuovo account, anche del personale TD, e darebbe a tutti i permessi di un cliente o di un partner. Si applicano dalla scheda Legal entity o da Utenti > Applica profilo.' : 'Viene applicato a ogni nuovo account. Un solo profilo può essere predefinito.'}</span></span></label>
        <div className="small muted">{n} widget inclus{n === 1 ? 'o' : 'i'}. "Nessuno" toglie il widget dal profilo.</div>
        <div className="profile-items">
          {byArea.map(([area, list]) => (
            <div key={area}>
              <div className="grant-area" style={{ '--area': AREA_COLORS[area] }}><i /><h2>{AREA_NAMES[area] || area}</h2></div>
              {list.map((m) => {
                const on = Boolean(items[m.key]);
                return (
                  <div key={m.key} className={`grant-row pi ${on ? '' : 'off'}`} role="row">
                    <div className="wi" style={{ color: AREA_COLORS[m.area] || 'var(--teal)' }}><Icon name={m.icon} /></div>
                    <div className="mod" style={{ minWidth: 0 }}><div className="nm">{m.restricted && <Icon name="lock" title="Modulo riservato: lo assegna solo il titolare" />}{m.name}</div><div className="tg">{m.tagline}</div></div>
                    <div className="pr"><select value={items[m.key] || ''} disabled={readOnly} aria-label={`Profilo ${m.name}`} onChange={(e) => setItems((x) => { const nx = { ...x }; if (e.target.value) nx[m.key] = e.target.value; else delete nx[m.key]; return nx; })}>
                      <option value="">Nessuno</option>
                      {(m.profiles || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select></div>
                    <div className="sc small muted">{on && m.scope_type === 'SITE' ? 'Ambito: sede della persona' : on ? 'Tutte le sedi' : ''}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </form>
    </Modal>
  );
}
