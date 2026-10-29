import React, { useEffect, useMemo, useState } from 'react';
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
export function ProfileReport({ report, compact }) {
  if (!report) return null;
  const n = (v, s, p) => `${v} ${v === 1 ? s : p}`;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="alert ok"><Icon name="check" /><span>Profilo <b>{report.profile?.name}</b> applicato a {n(report.users, 'utente', 'utenti')}{report.mode === 'replace' ? ' (sostituzione completa)' : ''}.</span></div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="green">{n(report.added, 'permesso aggiunto', 'permessi aggiunti')}</Badge>
        <Badge tone="blue">{n(report.updated, 'aggiornato', 'aggiornati')}</Badge>
        <Badge tone="grey">{n(report.kept, 'lasciato', 'lasciati')}</Badge>
        {report.removed > 0 && <Badge tone="red">{n(report.removed, 'rimosso', 'rimossi')}</Badge>}
        {report.warnings?.length > 0 && <Badge tone="amber">{n(report.warnings.length, 'avviso', 'avvisi')}</Badge>}
      </div>
      {report.warnings?.length > 0 && <div className="alert warn small" style={{ alignItems: 'flex-start' }}><Icon name="alert" /><ul style={{ margin: 0, paddingLeft: 18 }}>{report.warnings.slice(0, compact ? 8 : 60).map((w, i) => <li key={i}>{w}</li>)}{report.warnings.length > (compact ? 8 : 60) && <li>… e altri {report.warnings.length - (compact ? 8 : 60)}</li>}</ul></div>}
      {!compact && report.rows?.length > 1 && <div className="table-wrap"><table className="t"><thead><tr><th>Utente</th><th>Aggiunti</th><th>Aggiornati</th><th>Lasciati</th><th>Avvisi</th></tr></thead><tbody>
        {report.rows.map((r) => <tr key={r.user_id}><td><div className="strong">{r.full_name}</div><div className="tiny muted">{r.email}</div></td><td>{r.added}</td><td>{r.updated}</td><td>{r.kept}</td><td className="small">{r.warnings.length ? r.warnings.join('; ') : <span className="faint">nessuno</span>}</td></tr>)}
      </tbody></table></div>}
    </div>
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
                <button className="iconbtn" aria-label={owner ? 'Modifica' : 'Apri'} title={owner ? 'Modifica' : 'Apri'} onClick={() => setEdit(p)}><Icon name={owner ? 'edit' : 'eye'} /></button>
                {owner && !p.system && <button className="iconbtn danger" aria-label="Elimina" title="Elimina" onClick={() => setDel(p)}><Icon name="trash" /></button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>}
        <div className="small muted" style={{ padding: 14 }}>Il profilo <b>Default</b> viene assegnato automaticamente a ogni nuovo account. L'assegnazione aggiunge i permessi del profilo e non toglie quelli esistenti; sui widget per sede l'ambito è la sede della persona. {!owner && 'La creazione e la modifica dei profili sono riservate al titolare.'}</div>
      </Card>
      {edit && <ProfileModal profile={edit === 'new' ? null : edit} modules={mods.data || []} readOnly={!owner} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {del && <ConfirmModal title={`Eliminare il profilo "${del.name}"?`} danger confirmText="Elimina" text={`I permessi già assegnati a ${del.users_count} utent${del.users_count === 1 ? 'e restano' : 'i restano'}: perdono solo il collegamento al profilo.`}
        onConfirm={async () => { await api.del(`/access-profiles/${del.id}`); toast('Profilo eliminato'); reload(); }} onClose={() => setDel(null)} />}
      {applyAll && <ConfirmModal title={`Applicare "${def?.name}" a tutti gli utenti?`} confirmText="Applica a tutti"
        text="A ogni utente attivo o in attesa vengono aggiunti i permessi del profilo predefinito che ancora mancano. I permessi esistenti non vengono tolti né declassati; sui widget per sede l'ambito è la sede della persona."
        onConfirm={async () => { const r = await api.post('/access-profiles/default/apply-all'); setReport(r); reload(); }} onClose={() => setApplyAll(false)} />}
      {report && <Modal title="Rapporto dell'applicazione" wide onClose={() => setReport(null)} footer={<button className="btn" onClick={() => setReport(null)}>Chiudi</button>}><ProfileReport report={report} /></Modal>}
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
        <label className="f inline" style={{ alignItems: 'center', gap: 10 }}><Switch checked={f.is_default} onChange={(v) => setF({ ...f, is_default: v })} disabled={readOnly || Boolean(profile?.system)} label="Profilo predefinito per tutti i nuovi utenti" /><span>Profilo predefinito per tutti i nuovi utenti<span className="help" style={{ display: 'block' }}>Viene applicato a ogni nuovo account. Un solo profilo può essere predefinito.</span></span></label>
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
